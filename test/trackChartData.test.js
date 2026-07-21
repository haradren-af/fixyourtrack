import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSelectedProfilePoints,
  MAXIMUM_HIGHLIGHTED_PROFILE_POINTS,
} from '../src/trackChartData.js'

test('large chart selections are deterministically capped while retaining endpoints', () => {
  const profile = Array.from({ length: 250_001 }, (_, index) => ({
    distance: index,
    lat: 50 + index / 1_000_000,
    lon: 30 + index / 1_000_000,
  }))
  const selection = { start: 100.4, end: 249_900.6 }

  const selected = getSelectedProfilePoints(profile, 'distance', selection)
  const repeated = getSelectedProfilePoints(profile, 'distance', selection)

  assert.equal(selected.length, MAXIMUM_HIGHLIGHTED_PROFILE_POINTS)
  assert.deepEqual(selected[0], { lat: profile[100].lat, lon: profile[100].lon })
  assert.deepEqual(selected.at(-1), { lat: profile[249_901].lat, lon: profile[249_901].lon })
  assert.deepEqual(repeated, selected)
})

test('selection preserves nearest-index and valid-coordinate semantics', () => {
  const profile = [
    { distance: 0, lat: null, lon: null },
    { distance: 10, lat: 50.1, lon: 30.1 },
    { distance: Number.NaN, lat: 50.2, lon: 30.2 },
    { distance: 30, lat: 50.3, lon: 30.3 },
    { distance: 40, lat: null, lon: null },
  ]

  assert.deepEqual(
    getSelectedProfilePoints(profile, 'distance', { start: 100, end: -100 }, 2),
    [
      { lat: 50.1, lon: 30.1 },
      { lat: 50.3, lon: 30.3 },
    ],
  )
  assert.deepEqual(
    getSelectedProfilePoints(profile, 'time', { start: 0, end: 1 }),
    [],
  )
})
