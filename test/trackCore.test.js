import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchorRouteGeometry,
  buildExportTrack,
  buildGpx,
  finalizeTrack,
  isValidCoordinate,
} from '../src/trackCore.js'

function sample(lat, lon, distance, time, extra = {}) {
  return {
    lat,
    lon,
    distance,
    time,
    ele: 100,
    speed: 5,
    heartRate: 130,
    cadence: 80,
    power: 200,
    temperature: 18,
    ...extra,
  }
}

test('middle repair preserves exact border coordinates and sensor fields', () => {
  const original = finalizeTrack({
    name: 'ride',
    format: 'fit',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z'),
      sample(55.001, 37.001, 100, '2026-01-01T00:00:10Z'),
      sample(56, 38, 200, '2026-01-01T00:00:20Z'),
      sample(55.003, 37.003, 300, '2026-01-01T00:00:30Z'),
      sample(55.004, 37.004, 400, '2026-01-01T00:00:40Z'),
    ],
  })

  const repaired = buildExportTrack(
    original,
    original.samples.slice(1, 4),
    [
      { lat: 54, lon: 36 },
      { lat: 55.002, lon: 37.002 },
      { lat: 57, lon: 39 },
    ],
    'middle',
    { startSampleIndex: 1, endSampleIndex: 3 },
  )

  assert.deepEqual(
    { lat: repaired.samples[1].lat, lon: repaired.samples[1].lon },
    { lat: original.samples[1].lat, lon: original.samples[1].lon },
  )
  assert.deepEqual(
    { lat: repaired.samples[3].lat, lon: repaired.samples[3].lon },
    { lat: original.samples[3].lat, lon: original.samples[3].lon },
  )
  assert.equal(repaired.samples[2].heartRate, original.samples[2].heartRate)
  assert.equal(repaired.samples[2].speed, original.samples[2].speed)
  assert.equal(repaired.samples[2].cadence, original.samples[2].cadence)
  assert.equal(repaired.samples[2].power, original.samples[2].power)
  assert.equal(repaired.samples[2].repairAccepted, true)
})

test('routed geometry is anchored to exact requested control points', () => {
  const from = { lat: 55, lon: 37 }
  const to = { lat: 55.01, lon: 37.01 }
  const geometry = anchorRouteGeometry([
    { lat: 55.0002, lon: 37.0002 },
    { lat: 55.005, lon: 37.005 },
    { lat: 55.0098, lon: 37.0098 },
  ], from, to)

  assert.deepEqual(geometry[0], from)
  assert.deepEqual(geometry.at(-1), to)
})

test('tail repair restores removed records and marks them accepted', () => {
  const kept = finalizeTrack({
    name: 'ride',
    format: 'fit',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z'),
      sample(55.001, 37.001, 100, '2026-01-01T00:00:10Z'),
    ],
  })
  const removed = [
    sample(null, null, 200, '2026-01-01T00:00:20Z'),
    sample(null, null, 300, '2026-01-01T00:00:30Z'),
  ]

  const repaired = buildExportTrack(
    kept,
    removed,
    [
      { lat: 55.001, lon: 37.001 },
      { lat: 55.003, lon: 37.003 },
    ],
    'after',
  )

  assert.equal(repaired.samples.length, 4)
  assert.equal(repaired.samples[2].heartRate, 130)
  assert.equal(repaired.samples[3].repairAccepted, true)
  assert.deepEqual(
    { lat: repaired.samples[3].lat, lon: repaired.samples[3].lon },
    { lat: 55.003, lon: 37.003 },
  )
})

test('invalid coordinates are excluded from geometry but retained as samples', () => {
  const track = finalizeTrack({
    name: 'ride',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z'),
      sample(999, 37, 100, '2026-01-01T00:00:10Z'),
      sample(55.002, 37.002, 200, '2026-01-01T00:00:20Z'),
    ],
  })

  assert.equal(track.samples.length, 3)
  assert.equal(track.points.length, 2)
  assert.equal(isValidCoordinate(track.samples[1]), false)
})

test('GPX uses TrackPointExtension v2 for speed and escapes names', () => {
  const track = finalizeTrack({
    name: 'A&B',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z'),
      sample(55.001, 37.001, 100, '2026-01-01T00:00:10Z'),
    ],
  })

  const gpx = buildGpx(track)
  assert.match(gpx, /TrackPointExtension\/v2/)
  assert.match(gpx, /<gpxtpx:speed>5<\/gpxtpx:speed>/)
  assert.match(gpx, /<fixtrack:distance>0<\/fixtrack:distance>/)
  assert.match(gpx, /<name>A&amp;B<\/name>/)
  assert.doesNotMatch(gpx, /NaN|null|undefined/)
})

test('GPX preserves internal sensor-only samples by interpolating coordinates', () => {
  const track = finalizeTrack({
    name: 'sensor-gap',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z', { segmentStart: true }),
      sample(null, null, 50, '2026-01-01T00:00:05Z', { heartRate: 141 }),
      sample(55.002, 37.002, 100, '2026-01-01T00:00:10Z'),
    ],
  })

  const gpx = buildGpx(track)
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 3)
  assert.match(gpx, /<gpxtpx:hr>141<\/gpxtpx:hr>/)
  assert.match(gpx, /lat="55.001" lon="37.001"/)
})

test('GPX does not interpolate across track-segment boundaries', () => {
  const track = finalizeTrack({
    name: 'segments',
    samples: [
      sample(55, 37, 0, '2026-01-01T00:00:00Z', { segmentStart: true }),
      sample(null, null, 10, '2026-01-01T00:00:01Z'),
      sample(56, 38, 20, '2026-01-01T00:00:02Z', { segmentStart: true }),
      sample(56.001, 38.001, 30, '2026-01-01T00:00:03Z'),
    ],
  })

  const gpx = buildGpx(track)
  assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 2)
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 3)
})
