import assert from 'node:assert/strict'
import test from 'node:test'

import { getRouteControlSnapUpdates } from '../src/routeSnapping.js'

const controls = [
  { id: 'anchor', lat: 55.75, lon: 37.61 },
  { id: 'via', lat: 55.751, lon: 37.62 },
  { id: 'endpoint', lat: 55.752, lon: 37.63 },
]
const snappedControls = controls.map((point) => ({
  ...point,
  lat: point.lat + 0.00003,
}))

test('snaps routed user controls but never moves a fixed track anchor', () => {
  assert.deepEqual(
    getRouteControlSnapUpdates(controls, snappedControls, {}, {
      fixedControlIds: ['anchor'],
    }).map(({ id }) => id),
    ['via', 'endpoint'],
  )
})

test('protects both recorded track boundaries during a middle repair', () => {
  assert.deepEqual(
    getRouteControlSnapUpdates(controls, snappedControls, {}, {
      fixedControlIds: ['anchor', 'endpoint'],
    }).map(({ id }) => id),
    ['via'],
  )
})

test('does not snap a point touching a manually traced leg', () => {
  assert.deepEqual(
    getRouteControlSnapUpdates(controls, snappedControls, { anchor: 'direct' }, {
      fixedControlIds: ['anchor'],
    }).map(({ id }) => id),
    ['endpoint'],
  )
})

test('rejects implausibly distant provider snapping', () => {
  const farSnaps = snappedControls.map((point) => (
    point.id === 'via' ? { ...point, lat: point.lat + 0.01 } : point
  ))
  assert.deepEqual(
    getRouteControlSnapUpdates(controls, farSnaps, {}, {
      fixedControlIds: ['anchor', 'endpoint'],
    }),
    [],
  )
})
