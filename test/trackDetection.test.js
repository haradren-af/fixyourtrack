import assert from 'node:assert/strict'
import test from 'node:test'
import { getSuspiciousSegments } from '../src/trackDetection.js'
import { finalizeTrack } from '../src/trackCore.js'

function point(lat, lon, time, extra = {}) {
  return {
    lat,
    lon,
    time,
    speed: 5,
    ...extra,
  }
}

test('detects a short GPS-loss gap using missing source samples', () => {
  const track = finalizeTrack({
    samples: [
      point(55, 37, '2026-01-01T00:00:00Z'),
      point(null, null, '2026-01-01T00:00:05Z', { heartRate: 130 }),
      point(55.0002, 37.0002, '2026-01-01T00:00:10Z'),
    ],
  })

  const segments = getSuspiciousSegments(track.points)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].missingGpsSamples, 1)
  assert.equal(segments[0].startSampleIndex, 0)
  assert.equal(segments[0].endSampleIndex, 2)
})

test('detects a large jump when timestamps stop advancing', () => {
  const track = finalizeTrack({
    samples: [
      point(55, 37, '2026-01-01T00:00:00Z'),
      point(55.01, 37.01, '2026-01-01T00:00:00Z'),
    ],
  })

  const segments = getSuspiciousSegments(track.points)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].seconds, 0)
})

test('does not flag a normal nearby pair', () => {
  const track = finalizeTrack({
    samples: [
      point(55, 37, '2026-01-01T00:00:00Z'),
      point(55.0001, 37.0001, '2026-01-01T00:00:05Z'),
    ],
  })

  assert.deepEqual(getSuspiciousSegments(track.points), [])
})

test('does not flag an already accepted repaired pair', () => {
  const track = finalizeTrack({
    samples: [
      point(55, 37, '2026-01-01T00:00:00Z', { repairAccepted: true }),
      point(55.01, 37.01, '2026-01-01T00:00:00Z', { repairAccepted: true }),
    ],
  })

  assert.deepEqual(getSuspiciousSegments(track.points), [])
})
