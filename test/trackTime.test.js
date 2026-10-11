import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeTrack, buildGpx } from '../src/trackCore.js'
import { getTrackTimeBounds, localDateTime, shiftTrackTime } from '../src/trackTime.js'
import { normalizeRepairDraft } from '../src/draftStore.js'

const track = finalizeTrack({
  name: 'MAGENE_C606_2025-07-15_50574475_1789115290940',
  originalFilename: 'MAGENE_C606_2025-07-15_50574475_1789115290940.fit',
  format: 'fit',
  samples: [
    { lat: 55, lon: 37, time: '2025-07-15T20:59:00.125Z', heartRate: 120, power: 210 },
    { lat: null, lon: null, time: '2025-07-15T21:00:00.125Z', heartRate: 130 },
    { lat: 55.01, lon: 37.01, time: '2025-07-15T21:02:00.125Z', speed: 5 },
    { lat: 55.02, lon: 37.02, time: null },
  ],
})

for (const anchor of ['start', 'end']) {
  test(`shifts all records using ${anchor}, preserving intervals and sensors across midnight`, () => {
    const updated = shiftTrackTime(track, { anchor, date: '2026-09-11', time: '00:01:00' })
    assert.equal(getTrackTimeBounds(updated)[anchor], new Date('2026-09-11T00:01:00').getTime())
    assert.equal(getTrackTimeBounds(updated).end - getTrackTimeBounds(updated).start, 180000)
    assert.equal(Date.parse(updated.samples[1].time) - Date.parse(updated.samples[0].time), 60000)
    updated.samples.forEach((sample, index) => {
      const { time: ignored, ...rest } = sample
      const { time: originalTime, ...originalRest } = track.samples[index]
      assert.deepEqual(rest, originalRest)
      assert.ok(ignored === null || ignored !== originalTime)
    })
    const start = getTrackTimeBounds(updated).start
    assert.equal(updated.name, `MAGENE_C606_${localDateTime(start).date}_50574475_${start}`)
    assert.ok(buildGpx(updated).includes(updated.samples[0].time))
    assert.equal(track.samples[0].time, '2025-07-15T20:59:00.125Z')
  })
}

test('repeated changes and saved drafts retain the imported filename template', () => {
  const first = shiftTrackTime({ ...track, name: 'Custom name', originalFilename: 'ride.gpx' }, { date: '2026-09-11', time: '10:00' })
  const stored = ({ name, format, originalFilename, samples }) => ({ name, format, originalFilename, samples })
  const restored = normalizeRepairDraft({ id: 'active', savedAt: new Date().toISOString(), sourceTrack: stored(track), workingTrack: stored(first) })
  assert.equal(restored.workingTrack.originalFilename, 'ride.gpx')
  const next = shiftTrackTime(restored.workingTrack, { date: '2026-09-12', time: '11:00' })
  assert.equal(next.name, 'ride_2026-09-12_11-00-00')
})

test('missing or invalid timestamps and impossible dates are rejected', () => {
  assert.equal(getTrackTimeBounds({ samples: [{ time: null }] }), null)
  assert.equal(getTrackTimeBounds({ samples: [{ time: 'bad' }] }), null)
  for (const date of ['2026-02-30', '', '2026-13-01']) {
    assert.throws(() => shiftTrackTime(track, { date, time: '10:00' }))
  }
})
