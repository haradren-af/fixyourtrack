import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import { parseGpxDocument } from '../src/gpx.js'
import { buildGpx, finalizeTrack, getSampleDistances, haversineDistance } from '../src/trackCore.js'

test('recorded distance includes missing GPS at the start and inside the ride', () => {
  const samples = [
    { lat: null, lon: null, distance: 0 },
    { lat: null, lon: null, distance: 1272.18 },
    { lat: 56.3, lon: 38.13, distance: 1282.31 },
    { lat: null, lon: null, distance: 12000 },
    { lat: 56.31, lon: 38.14, distance: 16778.22 },
  ]
  const track = finalizeTrack({ format: 'fit', samples })
  assert.equal(track.distanceMeters, 16778.22)
  assert.deepEqual(getSampleDistances(track.samples), samples.map(sample => sample.distance))
  assert.equal(track.samples[0].lat, null)
  assert.equal(track.points.length, 2)
  const trimmed = finalizeTrack({ ...track, samples: track.samples.slice(2) })
  assert.equal(trimmed.distanceMeters, 16778.22 - 1282.31)
})

test('sparse recorded counters are interpolated without counting GPS distance twice', () => {
  const samples = [
    { lat: 55, lon: 37, distance: 100, time: '2026-10-09T00:00:00Z' },
    { lat: 55.001, lon: 37.001, distance: null, time: '2026-10-09T00:00:01Z' },
    { lat: 55.002, lon: 37.002, distance: 600, time: '2026-10-09T00:00:05Z' },
  ]
  assert.deepEqual(getSampleDistances(samples), [0, 100, 500])
  assert.deepEqual(getSampleDistances(samples.map(sample => ({ ...sample, time: null }))), [0, 250, 500])
})

test('segment boundaries never add a GPS jump or a counter gap between segments', () => {
  const samples = [
    { lat: 55, lon: 37, distance: 0 },
    { lat: 55.001, lon: 37.001, distance: 100 },
    { lat: 56, lon: 38, distance: 700, segmentStart: true },
    { lat: 56.001, lon: 38.001, distance: 950 },
  ]
  assert.deepEqual(getSampleDistances(samples), [0, 100, 100, 350])
})

test('missing, reset, or frozen counters fall back to geometry', () => {
  const samples = [
    { lat: 55, lon: 37 },
    { lat: null, lon: null },
    { lat: 55.001, lon: 37.001 },
  ]
  const length = haversineDistance(samples[0], samples[2])
  assert.deepEqual(getSampleDistances(samples), [0, 0, length])
  assert.equal(getSampleDistances(samples.map((sample, index) => ({ ...sample, distance: [100, 200, 50][index] }))).at(-1), length)
  assert.equal(getSampleDistances(samples.map(sample => ({ ...sample, distance: 0 }))).at(-1), length)
  assert.deepEqual(getSampleDistances([]), [])
})

test('repaired geometry replaces stale counter distance and survives GPX round trips', () => {
  const samples = [
    { lat: 55, lon: 37, distance: 0 },
    { lat: 55.001, lon: 37.001, distance: 100 },
    { lat: 55.002, lon: 37.003, distance: 200, repairAccepted: true },
    { lat: 55.003, lon: 37.003, distance: 300, repairAccepted: true },
    { lat: 55.004, lon: 37.004, distance: 400 },
    { lat: 55.005, lon: 37.005, distance: 500 },
  ]
  const track = finalizeTrack({ name: 'repaired', format: 'fit', samples })
  const expected = 200 + haversineDistance(samples[1], samples[2]) + haversineDistance(samples[2], samples[3]) + haversineDistance(samples[3], samples[4])
  assert.ok(Math.abs(track.distanceMeters - expected) < 1e-8)
  assert.deepEqual(track.samples.map(sample => sample.distance), [0, 100, 200, 300, 400, 500])
  const restored = finalizeTrack(parseGpxDocument(new DOMParser().parseFromString(buildGpx(track), 'application/xml')))
  assert.ok(Math.abs(restored.distanceMeters - expected) < 1e-8)
  assert.equal(restored.samples[2].repairAccepted, true)
})
