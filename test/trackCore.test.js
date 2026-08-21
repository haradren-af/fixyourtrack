import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchorRouteGeometry,
  buildExportTrack,
  buildGpx,
  finalizeTrack,
  haversineDistance,
  isValidCoordinate,
} from '../src/trackCore.js'
import { buildMiddleRepairTrack } from '../src/middleRepair.js'

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

test('distance calculation remains finite at antipodal coordinates', () => {
  const distance = haversineDistance(
    { lat: 0, lon: 0 },
    { lat: 0, lon: 180 },
  )

  assert.equal(Number.isFinite(distance), true)
  assert.ok(distance > 20_000_000)
})

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

  const repaired = buildMiddleRepairTrack(
    original,
    [
      { lat: 54, lon: 36 },
      { lat: 55.002, lon: 37.002 },
      { lat: 57, lon: 39 },
    ],
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

test('middle repair changes only the selected pass when the same road is ridden in reverse later', () => {
  const start = { lat: 55, lon: 37 }
  const finish = { lat: 55.003, lon: 37.003 }
  const routeMiddle = { lat: 55.0015, lon: 37.0015 }
  const original = finalizeTrack({
    name: 'out-and-back',
    format: 'fit',
    samples: [
      sample(54.999, 36.999, 0, '2026-01-01T00:00:00Z'),
      sample(start.lat, start.lon, 100, '2026-01-01T00:00:10Z'),
      sample(56, 38, 200, '2026-01-01T00:00:20Z'),
      sample(finish.lat, finish.lon, 300, '2026-01-01T00:00:30Z'),
      sample(55.004, 37.004, 400, '2026-01-01T00:00:40Z'),
      sample(finish.lat, finish.lon, 500, '2026-01-01T01:00:00Z'),
      sample(routeMiddle.lat, routeMiddle.lon, 600, '2026-01-01T01:00:10Z'),
      sample(start.lat, start.lon, 700, '2026-01-01T01:00:20Z'),
      sample(54.999, 36.999, 800, '2026-01-01T01:00:30Z'),
    ],
  })

  const repaired = buildMiddleRepairTrack(
    original,
    [start, routeMiddle, finish],
    { startSampleIndex: 1, endSampleIndex: 3 },
  )

  assert.ok(haversineDistance(repaired.samples[2], routeMiddle) < 0.01)
  assert.deepEqual(repaired.samples.slice(4), original.samples.slice(4))
})

test('middle repair ignores a frozen distance counter followed by a catch-up jump', () => {
  const start = { lat: 55, lon: 37 }
  const corner = { lat: 55, lon: 37.004 }
  const finish = { lat: 55.004, lon: 37.004 }
  const distances = [100, 110, 120, 120, 120, 120, 120, 120, 380, 385, 392, 400]
  const selectedPass = distances.map((distance, index) => sample(
    index === 0 ? start.lat : (index === distances.length - 1 ? finish.lat : null),
    index === 0 ? start.lon : (index === distances.length - 1 ? finish.lon : null),
    distance,
    new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString(),
    { speed: index >= 3 && index <= 7 ? null : 5 },
  ))
  const reversePass = [
    sample(finish.lat, finish.lon, 900, '2026-01-01T01:00:00Z'),
    sample(corner.lat, corner.lon, 1200, '2026-01-01T01:01:00Z'),
    sample(start.lat, start.lon, 1500, '2026-01-01T01:02:00Z'),
  ]
  const original = finalizeTrack({
    name: 'distance-catch-up',
    format: 'fit',
    samples: [
      sample(54.999, 36.999, 90, '2026-01-01T00:00:00Z'),
      ...selectedPass,
      ...reversePass,
    ],
  })

  const repaired = buildMiddleRepairTrack(
    original,
    [start, corner, finish],
    { startSampleIndex: 1, endSampleIndex: selectedPass.length },
  )
  const repairedPass = repaired.samples.slice(1, selectedPass.length + 1)
  const routeLength = haversineDistance(start, corner) + haversineDistance(corner, finish)
  const largestRepairedStep = Math.max(...repairedPass.slice(1).map((point, index) => (
    haversineDistance(repairedPass[index], point)
  )))

  assert.ok(largestRepairedStep < routeLength * 0.2)
  assert.deepEqual(
    repairedPass.map(({ distance, speed }) => ({ distance, speed })),
    selectedPass.map(({ distance, speed }) => ({ distance, speed })),
  )
  assert.deepEqual(repaired.samples.slice(selectedPass.length + 1), reversePass)
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

test('rebuilt beginning and later middle repair compose into one export with sensors intact', () => {
  const sourceSamples = [
    sample(null, null, 0, '2026-01-01T00:00:00Z', { heartRate: 120, segmentStart: true }),
    sample(null, null, 100, '2026-01-01T00:00:10Z', { heartRate: 121 }),
    sample(null, null, 200, '2026-01-01T00:00:20Z', { heartRate: 122 }),
    sample(55.003, 37.003, 300, '2026-01-01T00:00:30Z', { heartRate: 123 }),
    sample(55.004, 37.004, 400, '2026-01-01T00:00:40Z', { heartRate: 124 }),
    sample(55.005, 37.005, 500, '2026-01-01T00:00:50Z', { heartRate: 125 }),
    sample(56, 38, 600, '2026-01-01T00:01:00Z', { heartRate: 126 }),
    sample(55.007, 37.007, 700, '2026-01-01T00:01:10Z', { heartRate: 127 }),
    sample(55.008, 37.008, 800, '2026-01-01T00:01:20Z', { heartRate: 128 }),
  ]
  const trimmed = finalizeTrack({
    name: 'composed-repair',
    format: 'fit',
    samples: sourceSamples.slice(3),
  })
  const rebuilt = buildExportTrack(
    trimmed,
    sourceSamples.slice(0, 3),
    [
      { lat: 55, lon: 37 },
      { lat: 55.0015, lon: 37.0015 },
      { lat: 55.003, lon: 37.003 },
    ],
    'before',
  )
  const repaired = buildMiddleRepairTrack(
    rebuilt,
    [
      { lat: 55.005, lon: 37.005 },
      { lat: 55.006, lon: 37.006 },
      { lat: 55.007, lon: 37.007 },
    ],
    { startSampleIndex: 5, endSampleIndex: 7 },
  )
  const gpx = buildGpx(repaired)

  assert.equal(repaired.samples.length, sourceSamples.length)
  assert.deepEqual(
    repaired.samples.map(({ heartRate }) => heartRate),
    sourceSamples.map(({ heartRate }) => heartRate),
  )
  assert.deepEqual(
    { lat: repaired.samples[0].lat, lon: repaired.samples[0].lon },
    { lat: 55, lon: 37 },
  )
  assert.ok(haversineDistance(repaired.samples[6], { lat: 55.006, lon: 37.006 }) < 0.01)
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, sourceSamples.length)
  assert.equal((gpx.match(/<gpxtpx:hr>/g) ?? []).length, sourceSamples.length)
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

test('GPX elevation values use bounded fixed decimal notation', () => {
  const gpx = buildGpx({
    name: 'Elevation',
    samples: [
      { lat: 1, lon: 2, ele: 1e-7, segmentStart: true },
      { lat: 1.1, lon: 2.1, ele: 123.456 },
    ],
  })
  assert.match(gpx, /<ele>0<\/ele>/)
  assert.match(gpx, /<ele>123\.46<\/ele>/)
  assert.doesNotMatch(gpx, /<ele>[^<]*e[+-]?\d/i)
})

test('GPX coordinates remain valid fixed-decimal values near zero', () => {
  const gpx = buildGpx({
    name: 'Prime meridian crossing',
    samples: [
      { lat: 1e-7, lon: -1e-7, segmentStart: true },
      { lat: -2e-7, lon: 2e-7 },
    ],
  })

  assert.match(gpx, /lat="0\.0000001" lon="-0\.0000001"/)
  assert.match(gpx, /lat="-0\.0000002" lon="0\.0000002"/)
  assert.doesNotMatch(gpx, /(?:lat|lon)="[^"]*e[+-]?\d/i)
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
