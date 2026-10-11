import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import { createFitSummary, normalizeFitSummary, resolveFitSummary } from '../src/fitSummary.js'
import { buildGpx, finalizeTrack } from '../src/trackCore.js'
import { parseGpxDocument } from '../src/gpx.js'
import { normalizeRepairDraft, assertTrackCanBeSaved } from '../src/draftStore.js'
import { shiftTrackTime } from '../src/trackTime.js'

const samples = [0, 100, 200, 300].map((distance, index) => ({
  lat: 55 + index * 0.001, lon: 37, distance,
  time: new Date(Date.UTC(2026, 9, 9, 8, 13, index * 10)).toISOString(),
  speed: 10, cadence: 80, segmentStart: index === 0,
}))
const session = {
  total_distance: 300, total_elapsed_time: 50, total_timer_time: 35, total_moving_time: 30, avg_speed: 9.95,
  start_time: '2026-10-09T08:12:55Z', timestamp: '2026-10-09T08:13:45Z',
}
function original() {
  return finalizeTrack({ name: 'ride', format: 'fit', samples, fitSummary: createFitSummary([session], samples) })
}
function roundTrip(track) {
  return finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(buildGpx(track), 'application/xml')))
}

test('FIT summary survives coordinate repair, GPX repeat round trips and draft normalization', () => {
  const track = original()
  const repaired = finalizeTrack({ ...track, samples: track.samples.map(sample => ({ ...sample, lat: sample.lat + 0.2, repairAccepted: true })) })
  const imported = roundTrip(roundTrip(repaired))
  assert.deepEqual(imported.fitSummary, track.fitSummary)
  assert.equal(imported.statistics.distanceMeters, 300)
  assert.equal(imported.statistics.movingSeconds, 30)
  assert.equal(imported.statistics.timerSeconds, 35)
  assert.equal(imported.statistics.elapsedSeconds, 50)
  assert.equal(imported.statistics.averageSpeedMps, 9.95)
  assert.equal(imported.statistics.sources.averageSpeed, 'device')
  assert.deepEqual(imported.samples.map(({ time, distance }) => ({ time, distance })), samples.map(({ time, distance }) => ({ time, distance })))
  const draft = normalizeRepairDraft({ schemaVersion: 3, savedAt: '2026-10-09T12:00:00Z', sourceTrack: { name: 'source', format: 'fit', samples, fitSummary: track.fitSummary }, workingTrack: { name: imported.name, format: imported.format, samples: imported.samples, fitSummary: imported.fitSummary } })
  assert.deepEqual(draft.sourceTrack.fitSummary, track.fitSummary)
  assert.equal(finalizeTrack(draft.workingTrack).statistics.movingSeconds, 30)
})

test('trim/addition retain original summary but invalidate statistics instead of rebinding at export', () => {
  const track = original()
  for (const editedSamples of [samples.slice(1), [...samples, { ...samples.at(-1), time: '2026-10-09T08:14:00Z', distance: 500 }]]) {
    const edited = roundTrip(finalizeTrack({ ...track, samples: editedSamples }))
    assert.deepEqual(edited.fitSummary, track.fitSummary)
    assert.equal(edited.statistics.sources.averageSpeed, 'estimate')
    assert.equal(resolveFitSummary(edited.fitSummary, edited.samples).totalMovingSeconds, null)
  }
})

test('duration changes invalidate time and average, distance changes invalidate distance and average', () => {
  const track = original()
  const durationEdit = samples.map((sample, index) => ({ ...sample, time: new Date(Date.parse(sample.time) + index * 1000).toISOString() }))
  const changedTime = resolveFitSummary(track.fitSummary, durationEdit)
  assert.equal(changedTime.totalMovingSeconds, null)
  assert.equal(changedTime.totalTimerSeconds, null)
  assert.equal(changedTime.averageSpeedMps, null)
  assert.equal(changedTime.totalDistanceMeters, 300)
  const changedDistance = resolveFitSummary(track.fitSummary, samples.map((sample, index) => ({ ...sample, distance: sample.distance + index })))
  assert.equal(changedDistance.totalMovingSeconds, 30)
  assert.equal(changedDistance.totalDistanceMeters, null)
  assert.equal(changedDistance.averageSpeedMps, null)
})

test('uniform time shifts preserve durations and shift applicable session bounds without altering originals', () => {
  const track = original()
  const shifted = roundTrip(shiftTrackTime(track, { date: '2026-10-10', time: '12:00:00', anchor: 'start' }))
  const offset = Date.parse(shifted.samples[0].time) - Date.parse(samples[0].time)
  assert.deepEqual(shifted.fitSummary, track.fitSummary)
  assert.equal(shifted.statistics.movingSeconds, 30)
  assert.equal(shifted.statistics.averageSpeedMps, 9.95)
  assert.equal(Date.parse(shifted.statistics.startTime), Date.parse(session.start_time) + offset)
})

test('missing FIT fields stay null, recorded timer supports derived average without masquerading as moving time', () => {
  const track = finalizeTrack({ name: 'partial', format: 'fit', samples, fitSummary: createFitSummary([{ total_distance: 300, total_timer_time: 35 }], samples) })
  assert.equal(track.fitSummary.sessions[0].totalMovingSeconds, null)
  assert.equal(track.fitSummary.sessions[0].totalElapsedSeconds, null)
  assert.equal(track.fitSummary.sessions[0].startTime, null)
  assert.equal(track.statistics.timerSeconds, 35)
  assert.equal(track.statistics.movingSeconds, 30)
  assert.equal(track.statistics.sources.movingTime, 'estimate')
  assert.equal(track.statistics.averageSpeedMps, 300 / 35)
  assert.equal(track.statistics.sources.averageSpeed, 'recorded-derived')
})

test('multi-session files have explicit record mapping and never select the first session blindly', () => {
  const preceding = { ...session, start_time: '2026-10-08T08:12:55Z', timestamp: '2026-10-08T08:13:45Z', total_distance: 999 }
  const matched = createFitSummary([preceding, session], samples)
  assert.equal(matched.binding.sessionIndex, 1)
  assert.deepEqual(matched.binding.sessionRanges, [{ sessionIndex: 1, firstSampleIndex: 0, lastSampleIndex: 3 }])
  assert.equal(resolveFitSummary(matched, samples).totalDistanceMeters, 300)
  const mixedSamples = [...samples.map(sample => ({ ...sample, time: sample.time.replace('2026-10-09', '2026-10-08') })), ...samples]
  const mixed = createFitSummary([preceding, session], mixedSamples)
  assert.equal(mixed.binding.mappingStatus, 'multi-session')
  assert.equal(mixed.binding.sessionRanges.length, 2)
  assert.equal(resolveFitSummary(mixed, mixedSamples).averageSpeedMps, null)
  const ambiguous = createFitSummary([session, session], samples)
  assert.equal(ambiguous.binding.mappingStatus, 'ambiguous')
  assert.equal(resolveFitSummary(ambiguous, samples).totalMovingSeconds, null)
})

test('invalid summaries, unknown versions and wrong namespaces cannot override estimates', () => {
  const track = original()
  for (const value of [
    { ...track.fitSummary, version: 2 },
    { ...track.fitSummary, sessions: [{ ...track.fitSummary.sessions[0], totalMovingSeconds: '30' }] },
    { ...track.fitSummary, sessions: [{ ...track.fitSummary.sessions[0], totalTimerSeconds: -1 }] },
    { ...track.fitSummary, binding: { ...track.fitSummary.binding, sampleCount: 0 } },
  ]) {
    assert.equal(normalizeFitSummary(value), null)
    assert.throws(() => assertTrackCanBeSaved({ ...track, fitSummary: value }), /summary is invalid/)
  }
  for (const xml of [buildGpx(track).replace('activitySummary version="1"', 'activitySummary version="2"'), buildGpx(track).replace('https://fixyourtrack.local/extensions/v1', 'https://unrelated.example/extensions')]) {
    const parsed = finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(xml, 'application/xml')))
    assert.equal(parsed.fitSummary, undefined)
    assert.equal(parsed.statistics.sources.averageSpeed, 'estimate')
  }
  const plain = roundTrip({ ...track, fitSummary: undefined })
  assert.equal(plain.statistics.sources.movingTime, 'estimate')
  assert.equal(plain.samples.length, samples.length)
})

test('dropping unrepairable GPS-only edges at export does not falsely claim the full session', () => {
  const track = original()
  const exported = roundTrip({ ...track, samples: track.samples.map((sample, index) => index ? sample : { ...sample, lat: null, lon: null }) })
  assert.equal(exported.samples.length, 3)
  assert.equal(exported.statistics.sources.averageSpeed, 'estimate')
  assert.deepEqual(exported.fitSummary, track.fitSummary)
})
