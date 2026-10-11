import test from 'node:test'
import assert from 'node:assert/strict'
import { moveRepairBorder, repairRangeAtPoint } from '../src/repairBorders.js'
import { finalizeTrack } from '../src/trackCore.js'
import { buildMiddleRepairTrack } from '../src/middleRepair.js'

const points = [0, 2, 5, 7, 11].map((sampleIndex, index) => ({ lat: 55, lon: 37 + index * 0.001, sampleIndex }))
const range = { startSampleIndex: 2, endSampleIndex: 7 }

test('moving either border can expand or contract using recorded sample indices', () => {
  assert.deepEqual(moveRepairBorder(points, range, 'start', points[0]).range, { startSampleIndex: 0, endSampleIndex: 7 })
  assert.deepEqual(moveRepairBorder(points, range, 'start', points[2]).range, { startSampleIndex: 5, endSampleIndex: 7 })
  assert.deepEqual(moveRepairBorder(points, range, 'end', points[4]).range, { startSampleIndex: 2, endSampleIndex: 11 })
  assert.deepEqual(moveRepairBorder(points, range, 'end', points[2]).range, { startSampleIndex: 2, endSampleIndex: 5 })
  assert.deepEqual(range, { startSampleIndex: 2, endSampleIndex: 7 })
})

test('a drop on or beyond the opposite border is rejected rather than changing another boundary', () => {
  for (const index of [3, 4]) assert.equal(moveRepairBorder(points, range, 'start', points[index]), null)
  for (const index of [0, 1]) assert.equal(moveRepairBorder(points, range, 'end', points[index]), null)
  assert.equal(repairRangeAtPoint(points, range, 'end', -1), null)
})

test('distant or invalid drops are rejected and repeated coordinates keep the current boundary', () => {
  assert.equal(moveRepairBorder(points, range, 'start', { lat: 56, lon: 38 }), null)
  assert.equal(moveRepairBorder(points, range, 'start', { lat: NaN, lon: 37 }), null)
  const repeated = [points[0], { ...points[1], lat: points[0].lat, lon: points[0].lon }, ...points.slice(2)]
  assert.equal(moveRepairBorder(repeated, range, 'start', repeated[0]).pointIndex, 1)
  const twoPasses = [...points, ...points.map((point) => ({ ...point, sampleIndex: point.sampleIndex + 20 }))]
  const laterPass = { startSampleIndex: 22, endSampleIndex: 31 }
  assert.equal(moveRepairBorder(twoPasses, laterPass, 'start', points[2]).point.sampleIndex, 25)
})

test('applying shifted borders preserves records outside the new range and all recorded telemetry', () => {
  const original = finalizeTrack({ name: 'border test', samples: Array.from({ length: 9 }, (_, index) => ({
    lat: index === 2 ? null : 55, lon: index === 2 ? null : 37 + index * 0.001,
    time: new Date(Date.UTC(2026, 9, 3, 9, 0, index * 10)).toISOString(),
    heartRate: 120 + index, cadence: 80 + index, power: 180 + index, speed: 5, ele: 100, temperature: 18,
  })) })
  const originalSnapshot = structuredClone(original)
  const expanded = moveRepairBorder(original.points, { startSampleIndex: 1, endSampleIndex: 7 }, 'start', original.points[0])
  const contracted = moveRepairBorder(original.points, expanded.range, 'end', original.points.find((point) => point.sampleIndex === 6))
  const repaired = buildMiddleRepairTrack(original, [original.points[0], { lat: 55.001, lon: 37.003 }, contracted.point], contracted.range)
  assert.deepEqual(repaired.samples.slice(7), original.samples.slice(7))
  for (const index of [0, 6]) {
    assert.equal(repaired.samples[index].lat, original.samples[index].lat)
    assert.equal(repaired.samples[index].lon, original.samples[index].lon)
  }
  assert.equal(repaired.samples.length, original.samples.length)
  original.samples.forEach((sample, index) => {
    for (const field of ['time', 'heartRate', 'cadence', 'power', 'speed', 'ele', 'temperature']) {
      assert.equal(repaired.samples[index][field], sample[field])
    }
  })
  assert.notEqual(repaired.samples[3].lat, original.samples[3].lat)
  assert.deepEqual(original, originalSnapshot)
})
