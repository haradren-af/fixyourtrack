import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import { buildEmergencyRepairTrack, getEmergencyLegModes, getEmergencyRecordingAnchors } from '../src/emergencyRepair.js'
import { buildMiddleRepairTrack } from '../src/middleRepair.js'
import { buildGpx, finalizeTrack, getPolylineLength, getTrackStatistics } from '../src/trackCore.js'
import { createFitSummary } from '../src/fitSummary.js'
import { parseGpxDocument } from '../src/gpx.js'
import { normalizeRepairDraft } from '../src/draftStore.js'

const samples = [
  [55, 37, 0, 0], [55, 37.001, 100, 10],
  [55.005, 37.005, 110, 1800], [55.005, 37.006, 135, 1805],
  [55.01, 37.01, 145, 4600], [55.01, 37.011, 245, 4610],
].map(([lat, lon, distance, seconds]) => ({ lat, lon, distance, time: new Date(Date.UTC(2026, 9, 11) + seconds * 1000).toISOString(), cadence: 80, speed: 5, heartRate: 130, power: 150, ele: 120, temperature: 10 }))
const original = finalizeTrack({ name: 'ride', format: 'fit', samples, fitSummary: createFitSummary([{ total_distance: 245, total_timer_time: 30, total_moving_time: 30, total_elapsed_time: 4610, avg_speed: 245 / 30 }], samples) })
const route = [samples[1], { lat: 55.002, lon: 37.005 }, samples[2], samples[3], { lat: 55.008, lon: 37.006 }, samples[4]]
const range = { startSampleIndex: 1, endSampleIndex: 4, emergency: true }

test('seeds routing with both ends of the surviving short recording', () => {
  assert.deepEqual(getEmergencyRecordingAnchors(samples, range).map(point => [point.lat, point.lon]), [samples[2], samples[3]].map(point => [point.lat, point.lon]))
  assert.deepEqual(getEmergencyLegModes(samples, range, getEmergencyRecordingAnchors(samples, range)), { 'recording-2': 'direct' })
})

test('fills two recording gaps while retaining the short recording and wheel distance', () => {
  const repaired = buildEmergencyRepairTrack(original, route, range)
  const expected = 100 + getPolylineLength(route.slice(0, 3)) + 25 + getPolylineLength(route.slice(3)) + 100
  assert.ok(Math.abs(repaired.distanceMeters - expected) < 0.01, `${repaired.distanceMeters} != ${expected}`)
  assert.equal(repaired.statistics.sources.distance, 'estimate')
  assert.equal(repaired.statistics.sources.averageSpeed, 'estimate')
  assert.equal(repaired.statistics.averageSpeedBasis, 'elapsed')
  assert.equal(repaired.statistics.movingSeconds, null)
  assert.equal(repaired.statistics.sources.movingTime, 'unavailable')
  assert.equal(repaired.statistics.averageSpeedMps, repaired.distanceMeters / 4610)
  assert.equal(repaired.statistics.timerSeconds, null)
  assert.deepEqual(repaired.samples[0], original.samples[0])
  assert.deepEqual(repaired.samples.at(-1), original.samples.at(-1))
  for (const sample of original.samples) {
    const retained = repaired.samples.find(point => !point.reconstructed && point.time === sample.time)
    for (const field of ['lat', 'lon', 'time', 'distance', 'cadence', 'speed', 'heartRate', 'power', 'temperature', 'ele']) assert.equal(retained[field], sample[field])
  }
  const generated = repaired.samples.filter(point => point.reconstructed)
  assert.ok(generated.length > 2)
  for (const point of generated) {
    for (const field of ['distance', 'speed', 'cadence', 'heartRate', 'power', 'temperature', 'ele']) assert.equal(point[field], null)
  }
  for (let index = 1; index < repaired.samples.length; index += 1) {
    assert.ok(Date.parse(repaired.samples[index].time) >= Date.parse(repaired.samples[index - 1].time))
  }
  assert.equal(original.distanceMeters, 245)
})

test('export, reimport and local drafts preserve reconstruction provenance and distance', () => {
  const repaired = buildEmergencyRepairTrack(original, route, range)
  const exported = buildGpx(repaired)
  assert.match(exported, /<fixtrack:reconstructed>true/)
  assert.match(exported, /<fixtrack:excludeFromAverageSpeed>true<\/fixtrack:excludeFromAverageSpeed>/)
  const restored = finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(exported, 'text/xml')))
  assert.ok(Math.abs(restored.distanceMeters - repaired.distanceMeters) < 0.1)
  assert.equal(restored.statistics.averageSpeedBasis, 'elapsed')
  assert.equal(restored.excludeFromAverageSpeed, true)
  assert.equal(restored.statistics.movingSeconds, null)
  assert.equal(restored.statistics.averageSpeedMps, restored.distanceMeters / 4610)
  assert.deepEqual(restored.samples.filter(point => point.reconstructed).map(point => [point.time, point.cadence, point.speed]), repaired.samples.filter(point => point.reconstructed).map(point => [point.time, point.cadence, point.speed]))
  const stored = ({ name, format, samples, fitSummary, excludeFromAverageSpeed }) => ({ name, format, samples, fitSummary, ...(excludeFromAverageSpeed ? { excludeFromAverageSpeed } : {}) })
  const draft = normalizeRepairDraft({ schemaVersion: 3, savedAt: '2026-10-11T12:00:00Z', sourceTrack: stored(original), workingTrack: stored(repaired) })
  assert.ok(draft)
  assert.equal(draft.workingTrack.excludeFromAverageSpeed, true)
  assert.ok(Math.abs(finalizeTrack(draft.workingTrack).distanceMeters - repaired.distanceMeters) < 0.001)
})

test('reconstruction flags require the documented namespace and work with another prefix', () => {
  const xml = buildGpx(buildEmergencyRepairTrack(original, route, range))
  const parse = value => finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(value, 'text/xml')))
  assert.ok(parse(xml.replaceAll('fixtrack:', 'recovery:').replace('xmlns:fixtrack=', 'xmlns:recovery=')).samples.some(sample => sample.reconstructed))
  assert.ok(parse(xml.replaceAll('https://fixyourtrack.local/extensions/v1', 'https://unrelated.example/v1')).samples.every(sample => !sample.reconstructed && !sample.routeDistance))
})

test('ordinary GPS repair still preserves authoritative FIT distance and sensor records', () => {
  const repaired = buildMiddleRepairTrack(original, route, range)
  assert.equal(repaired.distanceMeters, 245)
  assert.equal(repaired.samples.length, samples.length)
  assert.equal(repaired.statistics.sources.distance, 'device')
  assert.doesNotMatch(buildGpx(repaired), /excludeFromAverageSpeed/)
  assert.equal(repaired.statistics.movingSeconds, 30)
  assert.equal(repaired.statistics.averageSpeedMps, 245 / 30)
})

test('track exclusion marker survives round trips and drafts without per-point flags', () => {
  const xml = buildGpx({ ...original, excludeFromAverageSpeed: true })
  const parsed = finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(xml, 'text/xml')))
  assert.equal(parsed.excludeFromAverageSpeed, true)
  assert.match(buildGpx(parsed), /excludeFromAverageSpeed>true/)
  assert.equal(parsed.statistics.averageSpeedMps, original.statistics.averageSpeedMps)
  const stored = { name: parsed.name, format: parsed.format, samples: parsed.samples, fitSummary: parsed.fitSummary, excludeFromAverageSpeed: true }
  assert.equal(normalizeRepairDraft({ schemaVersion: 3, savedAt: '2026-10-11T12:00:00Z', sourceTrack: stored, workingTrack: stored }).workingTrack.excludeFromAverageSpeed, true)
  const foreign = xml.replace('https://fixyourtrack.local/extensions/v1', 'https://other.example')
  assert.equal(parseGpxDocument(new DOMParser().parseFromString(foreign, 'text/xml')).excludeFromAverageSpeed, undefined)
  assert.doesNotMatch(buildGpx(original), /excludeFromAverageSpeed/, 'undo uses the unmarked original track')
})

test('interpolated timestamps never invent moving time even for slow or stationary gaps', () => {
  const slow = buildEmergencyRepairTrack(original, route, range)
  assert.equal(slow.statistics.movingSeconds, null)
  const withoutTime = getTrackStatistics(slow.samples.map(sample => ({ ...sample, time: null })))
  assert.equal(withoutTime.movingSeconds, null)
  assert.equal(withoutTime.averageSpeedMps, null)
  const recordedPart = getTrackStatistics(slow.samples.slice(0, 2))
  assert.equal(recordedPart.movingSeconds, 10)
  assert.equal(recordedPart.averageSpeedBasis, undefined)
})

test('keeps the authoritative FIT baseline when its total differs from the sampled counter', () => {
  const track = finalizeTrack({ ...original, fitSummary: createFitSummary([{ total_distance: 1000 }], samples) })
  const repaired = buildEmergencyRepairTrack(track, route, range)
  const reference = buildEmergencyRepairTrack(original, route, range)
  assert.ok(Math.abs(repaired.distanceMeters - reference.distanceMeters - 755) < 0.001)
  const restored = finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(buildGpx(repaired), 'text/xml')))
  assert.ok(Math.abs(restored.distanceMeters - repaired.distanceMeters) < 0.1)
})

test('does not invent a missing recording when only GPS coordinates need repair', () => {
  const continuous = finalizeTrack({ name: 'continuous', samples: samples.map((sample, index) => ({ ...sample, time: new Date(Date.UTC(2026, 9, 11) + index * 1000).toISOString() })) })
  assert.throws(() => buildEmergencyRepairTrack(continuous, route, range), /emergencyNoGaps/)
})

test('joins recording segments explicitly and counts the complete drawn gap', () => {
  const track = finalizeTrack({ name: 'segments', samples: [samples[1], { ...samples[4], segmentStart: true }] })
  const reconstructed = buildEmergencyRepairTrack(track, route, { startSampleIndex: 0, endSampleIndex: 1 })
  assert.ok(Math.abs(reconstructed.distanceMeters - getPolylineLength(route)) < 0.01)
  assert.equal(reconstructed.samples.at(-1).segmentStart, false)
})

test('rejects a route that visits the preserved recording in reverse order', () => {
  assert.throws(() => buildEmergencyRepairTrack(original, [samples[1], samples[3], samples[2], samples[4]], range), /emergencyRouteOrder/)
})

test('requires the drawn route to pass through the surviving recording rather than adding long connectors', () => {
  assert.throws(() => buildEmergencyRepairTrack(original, [samples[1], { lat: 55, lon: 37.01 }, samples[4]], range), /emergencyRouteMissesRecording/)
})
