import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRouteControlSnapUpdates, getRouteControlSnapUpdates } from '../src/routeSnapping.js'
import { buildRoutePreview, hydrateRouteLegCache } from '../src/routeBuilder.js'
import { getPolylineLength } from '../src/trackCore.js'

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

test('reuses the routed geometry after snapping without a second request or another snap', async () => {
  const cache = new Map()
  let requests = 0
  const fetchImpl = async () => {
    requests += 1
    return {
      ok: true,
      json: async () => ({ features: [{ geometry: {
        type: 'LineString',
        coordinates: snappedControls.map(({ lat, lon }) => [lon, lat]),
      } }] }),
    }
  }
  const original = await buildRoutePreview(controls, {}, 'cycling', { cache, fetchImpl })
  const originalGeometry = structuredClone(original.geometry)
  const updates = getRouteControlSnapUpdates(controls, original.snappedControls, {}, {
    fixedControlIds: ['anchor'],
  })
  const snapped = applyRouteControlSnapUpdates(controls, original, updates)
  assert.equal(hydrateRouteLegCache(cache, snapped.controls, {}, 'cycling', snapped.preview), 2)

  const reused = await buildRoutePreview(snapped.controls, {}, 'cycling', { cache, fetchImpl })
  assert.equal(requests, 1)
  assert.deepEqual(reused.geometry, snapped.preview.geometry)
  assert.deepEqual(reused.geometry[0], { lat: controls[0].lat, lon: controls[0].lon })
  assert.deepEqual(reused.geometry.at(-1), { lat: snappedControls[2].lat, lon: snappedControls[2].lon })
  assert.equal(reused.distanceMeters, getPolylineLength(reused.geometry))
  assert.deepEqual(getRouteControlSnapUpdates(snapped.controls, reused.snappedControls, {}), [])
  assert.deepEqual(original.geometry, originalGeometry, 'the original cached route stays unchanged')
})
