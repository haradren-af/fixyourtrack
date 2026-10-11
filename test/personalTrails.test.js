import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersonalNetwork, indexPersonalNetwork, routePersonalNetwork, personalNetworkGeoJson } from '../src/personalTrails.js'
import { buildRoutePreview } from '../src/routeBuilder.js'
import { resetPersonalTrails } from '../src/personalTrailStore.js'

const point = (x, y, second = x) => ({ lat: 55 + y / 111320, lon: 37 + x / (111320 * Math.cos(55 * Math.PI / 180)), time: new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString() })
const line = (y) => ({ samples: Array.from({ length: 31 }, (_, index) => point(index * 10, y)) })

test('nearby repeat rides form a narrower median corridor, counting rides not sample frequency', () => {
  const tracks = [line(-3), line(0), line(3)]
  const network = buildPersonalNetwork(tracks)
  const repeated = network.nodes.filter((node) => node[2] === 3)
  assert.ok(repeated.length > 15)
  assert.ok(repeated.every((node) => Math.abs(node[1] - 55) * 111320 < 1))
  assert.ok(network.edges.some((edge) => edge[2] === 3))
  assert.equal(network.summary.tracks, 3)
  const route = routePersonalNetwork(indexPersonalNetwork(network), point(0, 0), point(300, 0))
  assert.ok(route.distanceMeters > 290 && route.distanceMeters < 320)
  assert.deepEqual(route.geometry[0], { lat: 55, lon: 37 })
})

test('unobserved crossings and separate parallel trails do not create connections', () => {
  const horizontal = line(0)
  const crossing = { samples: Array.from({ length: 31 }, (_, i) => point(150, i * 10 - 150, i * 10)) }
  const network = indexPersonalNetwork(buildPersonalNetwork([horizontal, crossing, line(35)]))
  assert.throws(() => routePersonalNetwork(network, point(0, 0), point(150, 150)), /No recorded connection/)
  assert.throws(() => routePersonalNetwork(network, point(0, 0), point(300, 35)), /No recorded connection/)
  assert.throws(() => routePersonalNetwork(network, point(0, 200), point(300, 0)), /within 25 m/)
})

test('GPS jumps, missing coordinates and segment boundaries are never bridged', () => {
  const samples = [point(0, 0), point(10, 0), point(1000, 0), point(1010, 0), { lat: null, lon: null }, point(2000, 0), point(2010, 0)]
  const network = buildPersonalNetwork([{ samples }])
  assert.equal(network.summary.rejectedLinks, 1)
  assert.throws(() => routePersonalNetwork(indexPersonalNetwork(network), point(0, 0), point(1010, 0)), /No recorded connection/)
  const segmented = line(0)
  segmented.samples[15].segmentStart = true
  const split = buildPersonalNetwork([segmented], { mergeRadius: 4 })
  assert.throws(() => routePersonalNetwork(indexPersonalNetwork(split), point(0, 0), point(300, 0)), /No recorded connection/)
})

test('personal repair uses the local network without public routing and preserves control anchors', async () => {
  resetPersonalTrails()
  const network = buildPersonalNetwork([line(0), line(2)])
  const requests = []
  const fetchImpl = async (url) => { requests.push(url); return new Response(JSON.stringify(network)) }
  const controls = [{ ...point(0, 0), id: 'anchor' }, { ...point(300, 0), id: 'endpoint' }]
  const preview = await buildRoutePreview(controls, {}, 'personal', { fetchImpl })
  assert.equal(preview.status, 'ready')
  assert.deepEqual(requests, ['/local-trails/network.json'])
  assert.deepEqual(preview.geometry.at(-1), { lat: controls[1].lat, lon: controls[1].lon })
  assert.equal(personalNetworkGeoJson(network).features.length, 2)
  resetPersonalTrails()
})
