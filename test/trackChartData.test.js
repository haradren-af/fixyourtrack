import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCadenceStats,
  getProfileStatistics,
  getRecordedCadenceAverage,
  getSelectedProfilePoints,
  MAXIMUM_HIGHLIGHTED_PROFILE_POINTS,
} from '../src/trackChartData.js'

test('chart selections with reconstructed time use elapsed average and leave moving time unknown', () => {
  const profile = [
    { lat: 55, lon: 37, time: 0, distance: 0, speed: 18 },
    { lat: 55, lon: 37.001, time: 60, distance: 100, speed: null, reconstructed: true, routeDistance: true },
    { lat: 55, lon: 37.002, time: 120, distance: 200, speed: 18, routeDistance: true },
    { lat: 55, lon: 37.003, time: 130, distance: 300, speed: 36 },
  ]
  const selected = getProfileStatistics(profile, 'time', { start: 0, end: 120 })
  assert.equal(selected.movingSeconds, null)
  assert.equal(selected.averageSpeedBasis, 'elapsed')
  assert.equal(selected.averageSpeedMps, selected.distanceMeters / 120)
  const recorded = getProfileStatistics(profile, 'time', { start: 120, end: 130 })
  assert.equal(recorded.movingSeconds, 10)
  assert.equal(recorded.averageSpeedBasis, undefined)
})

test('cadence averages pedaling samples while retaining zero in the minimum', () => {
  const profile = [0, 78, null, 82, 0, Number.NaN].map((cadence, time) => ({ cadence, time }))
  assert.deepEqual(getCadenceStats(profile, 'time', null), {
    average: 80, minimum: 0, maximum: 82, usesRecordedAverage: false,
  })
  assert.equal(getCadenceStats(profile, 'time', null, 79).average, 79)
  assert.equal(getCadenceStats(profile, 'time', { start: 3, end: 4 }, 79).average, 82)
  assert.equal(getCadenceStats(profile, 'time', { start: 0, end: 0 }).average, 0)
  assert.equal(getCadenceStats(profile, 'time', { start: 2, end: 2 }).average, null)
})

test('cadence selection obeys distance and excludes missing axis values', () => {
  const profile = [
    { cadence: 10, distance: null },
    { cadence: 60, distance: 100 },
    { cadence: 0, distance: 200 },
    { cadence: 90, distance: 300 },
  ]
  assert.equal(getCadenceStats(profile, 'distance', { start: 100, end: 200 }, 79).average, 60)
})

test('recorded cadence summary survives uniform time shifts but not sample edits or trimming', () => {
  const samples = [0, 70, 90].map((cadence, index) => ({
    cadence, time: new Date(Date.UTC(2026, 9, 4) + index * 1000).toISOString(),
  }))
  const source = { recordedAverageCadence: 79, samples }
  assert.equal(getRecordedCadenceAverage(samples, source), 79)
  const shifted = samples.map((sample) => ({ ...sample, time: new Date(Date.parse(sample.time) + 3600_000).toISOString() }))
  assert.equal(getRecordedCadenceAverage(shifted, source), 79)
  assert.equal(getRecordedCadenceAverage(samples.slice(1), source), null)
  assert.equal(getRecordedCadenceAverage(samples.map((sample) => ({ ...sample, cadence: 80 })), source), null)
  assert.equal(getRecordedCadenceAverage([shifted[0], ...samples.slice(1)], source), null)
  assert.equal(getRecordedCadenceAverage(samples, { samples }), null)
  assert.equal(getRecordedCadenceAverage(samples, { ...source, recordedAverageCadence: Number.NaN }), null)
})

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
