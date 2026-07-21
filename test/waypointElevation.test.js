import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWaypointElevationReference,
  maximumWaypointElevationReferencePoints,
} from '../src/waypointElevation.js'

test('caps waypoint elevation lookup while preserving deterministic endpoints', () => {
  const points = Array.from({ length: 25_000 }, (_, index) => ({
    lat: 50 + index / 100_000,
    lon: 30 + index / 100_000,
    ele: index,
  }))
  const reference = buildWaypointElevationReference(points)

  assert.equal(reference.length, maximumWaypointElevationReferencePoints)
  assert.equal(reference[0], points[0])
  assert.equal(reference.at(-1), points.at(-1))
  assert.deepEqual(reference, buildWaypointElevationReference(points))
})

test('excludes unusable elevation points before applying the lookup cap', () => {
  const points = [
    { lat: 55, lon: 37, ele: 120 },
    { lat: 55.1, lon: 37.1, ele: null },
    { lat: null, lon: 37.2, ele: 140 },
    { lat: 55.3, lon: 37.3, ele: 150 },
  ]

  assert.deepEqual(buildWaypointElevationReference(points), [points[0], points[3]])
})
