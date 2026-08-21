import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendSegmentGeometry,
  buildDirectSegment,
  buildRouteDisplayPreview,
  buildRoutePreview,
  emptyRoutePreview,
  getRouteLegFingerprint,
  hydrateRouteLegCache,
  RouteBuildError,
  RouteResourceLimitError,
  trimRouteLegCache,
  waitForRoutingProviderSlot,
} from '../src/routeBuilder.js'

const start = { id: 'start', lat: 55.75, lon: 37.61 }
const waypoint = { id: 'via-1', lat: 55.751, lon: 37.62 }
const finish = { id: 'finish', lat: 55.752, lon: 37.63 }

test('returns an empty preview until two control points exist', async () => {
  assert.deepEqual(await buildRoutePreview([start], {}, 'cycling'), emptyRoutePreview)
})

test('builds direct legs without a network request', async () => {
  const preview = await buildRoutePreview(
    [start, waypoint, finish],
    { start: 'direct', 'via-1': 'direct' },
    'cycling',
    { fetchImpl: () => assert.fail('direct legs must not fetch') },
  )

  assert.equal(preview.status, 'ready')
  assert.equal(preview.segments.length, 2)
  assert.deepEqual(preview.segments.map(({ mode }) => mode), ['direct', 'direct'])
  assert.deepEqual(preview.geometry, [start, waypoint, finish].map(({ lat, lon }) => ({ lat, lon })))
  assert.ok(preview.distanceMeters > 0)
})

test('reports provider-snapped controls while keeping preview geometry on requested boundaries', async () => {
  const snappedStart = { lat: start.lat + 0.00002, lon: start.lon + 0.00005 }
  const snappedFinish = { lat: finish.lat + 0.00002, lon: finish.lon + 0.00004 }
  const preview = await buildRoutePreview([start, finish], {}, 'cycling', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        features: [{
          geometry: {
            type: 'LineString',
            coordinates: [
              [snappedStart.lon, snappedStart.lat],
              [37.62, 55.751],
              [snappedFinish.lon, snappedFinish.lat],
            ],
          },
          properties: { 'track-length': 100 },
        }],
      }),
    }),
  })

  assert.deepEqual(preview.geometry[0], { lat: start.lat, lon: start.lon })
  assert.deepEqual(preview.geometry.at(-1), { lat: finish.lat, lon: finish.lon })
  assert.deepEqual(preview.snappedControls, [
    { id: start.id, ...snappedStart },
    { id: finish.id, ...snappedFinish },
  ])
})

test('joins adjacent segment geometry without duplicating the shared point', () => {
  assert.deepEqual(
    appendSegmentGeometry(
      [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }],
      [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }],
    ),
    [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }],
  )
})

test('keeps the current route editable with unresolved display legs after routing fails', () => {
  const cachedSegment = {
    mode: 'routed',
    geometry: [start, waypoint].map(({ lat, lon }) => ({ lat, lon })),
    distanceMeters: 100,
  }
  const cache = new Map([
    [JSON.stringify(['cycling', 'routed', start.lat, start.lon, waypoint.lat, waypoint.lon]), cachedSegment],
  ])
  const preview = buildRouteDisplayPreview([start, waypoint, finish], {}, 'cycling', {
    cache,
    status: 'error',
    error: 'No route found',
    failedLegId: 'via-1',
  })

  assert.equal(preview.status, 'error')
  assert.deepEqual(preview.segments.map(({ mode }) => mode), ['routed', 'unresolved'])
  assert.deepEqual(preview.segments.map(({ id }) => id), ['start-via-1', 'via-1-finish'])
  assert.equal(preview.segments[1].insertAfterId, 'via-1')
  assert.deepEqual(preview.geometry.at(-1), { lat: finish.lat, lon: finish.lon })
})

test('rejects invalid direct coordinates', () => {
  assert.throws(
    () => buildDirectSegment({ lat: 1000, lon: 0 }, finish),
    /invalid coordinates/i,
  )
})

test('does not disguise a failed routed geometry as a routed straight line', async () => {
  const spikeStart = { id: 'start', lat: 55, lon: 37 }
  const spikeFinish = { id: 'finish', lat: 55.0004, lon: 37 }
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        type: 'Feature',
        properties: { 'track-length': 130 },
        geometry: {
          type: 'LineString',
          coordinates: [[37, 55], [36.9991, 55.00005], [37, 55.0004]],
        },
      }],
    }),
  })

  await assert.rejects(
    buildRoutePreview([spikeStart, spikeFinish], {}, 'cycling', { fetchImpl, timeoutMs: 100 }),
    (error) => error.name === 'RouteBuildError' && error.fromControlId === 'start',
  )
})

test('reuses unchanged routed legs and refetches only legs adjacent to a moved control', async () => {
  const cache = new Map()
  let fetchCount = 0
  const fetchImpl = async (resource) => {
    fetchCount += 1
    const request = new URL(resource)
    const controls = request.searchParams.get('lonlats')
      .split('|')
      .map((value) => value.split(',').map(Number))
    return {
      ok: true,
      json: async () => ({
        features: [{
          geometry: { type: 'LineString', coordinates: controls },
          properties: { 'track-length': 100 },
        }],
      }),
    }
  }

  await buildRoutePreview([start, waypoint, finish], {}, 'cycling', { cache, fetchImpl })
  assert.equal(fetchCount, 1)
  await buildRoutePreview([start, waypoint, finish], {}, 'cycling', { cache, fetchImpl })
  assert.equal(fetchCount, 1)
  await buildRoutePreview([
    start,
    { ...waypoint, lat: waypoint.lat + 0.001 },
    finish,
  ], {}, 'cycling', { cache, fetchImpl })
  assert.equal(fetchCount, 2)
})

test('batches only consecutive uncached routed legs across direct boundaries', async () => {
  const extra = { id: 'extra', lat: 55.753, lon: 37.64 }
  let fetchCount = 0
  const fetchImpl = async (resource) => {
    fetchCount += 1
    const controls = new URL(resource).searchParams.get('lonlats')
      .split('|')
      .map((value) => value.split(',').map(Number))
    return {
      ok: true,
      json: async () => ({
        features: [{
          geometry: { type: 'LineString', coordinates: controls },
          properties: { 'track-length': 100 },
        }],
      }),
    }
  }

  const preview = await buildRoutePreview(
    [start, waypoint, finish, extra],
    { 'via-1': 'direct' },
    'cycling',
    { fetchImpl },
  )

  assert.equal(fetchCount, 2)
  assert.deepEqual(preview.segments.map(({ mode }) => mode), ['routed', 'direct', 'routed'])
})

test('splits a failed waypoint batch and preserves road routing for every valid leg', async () => {
  const controls = [
    start,
    waypoint,
    finish,
    { id: 'extra', lat: 55.753, lon: 37.64 },
  ]
  let fetchCount = 0
  const fetchImpl = async (resource) => {
    fetchCount += 1
    const coordinates = new URL(resource).pathname
      .split('/driving/')[1]
      .split(';')
      .map((value) => value.split(',').map(Number))
    if (coordinates.length > 2) {
      return { ok: false, status: 400 }
    }
    return {
      ok: true,
      json: async () => ({
        routes: [{ geometry: { coordinates }, distance: 100 }],
      }),
    }
  }

  const preview = await buildRoutePreview(controls, {}, 'driving', { fetchImpl })

  assert.equal(preview.status, 'ready')
  assert.deepEqual(preview.segments.map(({ mode }) => mode), ['routed', 'routed', 'routed'])
  assert.equal(fetchCount, 5)
})

test('hydrates valid saved road geometry into the route-leg cache', () => {
  const controls = [start, waypoint, finish]
  const preview = {
    status: 'error',
    segments: [
      {
        id: 'start-via-1',
        insertAfterId: 'start',
        mode: 'routed',
        geometry: [start, waypoint].map(({ lat, lon }) => ({ lat, lon })),
        distanceMeters: 100,
      },
      {
        id: 'via-1-finish',
        insertAfterId: 'via-1',
        mode: 'unresolved',
        geometry: [waypoint, finish].map(({ lat, lon }) => ({ lat, lon })),
        distanceMeters: 100,
      },
    ],
  }
  const cache = new Map()

  assert.equal(hydrateRouteLegCache(cache, controls, {}, 'cycling', preview), 1)
  assert.equal(cache.size, 1)
  assert.deepEqual(
    cache.get(getRouteLegFingerprint(start, waypoint, 'cycling', 'routed')).geometry,
    preview.segments[0].geometry,
  )
})

test('falls back to mapped pedestrian paths when cycling providers find no route', async () => {
  const requestedUrls = []
  const fetchImpl = async (resource) => {
    requestedUrls.push(resource)
    if (resource.includes('profile=hiking-beta')) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            type: 'Feature',
            properties: { 'track-length': 150 },
            geometry: {
              type: 'LineString',
              coordinates: [[start.lon, start.lat], [finish.lon, finish.lat]],
            },
          }],
        }),
      }
    }
    return { ok: true, json: async () => ({}) }
  }

  const preview = await buildRoutePreview([start, finish], {}, 'cycling', { fetchImpl })

  assert.equal(preview.status, 'ready')
  assert.equal(preview.segments[0].mode, 'routed')
  assert.equal(requestedUrls.length, 3)
  assert.match(requestedUrls[0], /profile=trekking/)
  assert.match(requestedUrls[1], /routed-bike/)
  assert.match(requestedUrls[2], /profile=hiking-beta/)
})

test('rejects a negative provider distance instead of publishing it', async () => {
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return {
      ok: true,
      json: async () => ({
        routes: [{
          geometry: { coordinates: [[37.61, 55.75], [37.63, 55.752]] },
          distance: -1,
        }],
      }),
    }
  }

  await assert.rejects(
    buildRoutePreview([start, finish], {}, 'driving', { fetchImpl }),
    (error) => error instanceof RouteBuildError && /invalid distance/i.test(error.cause?.message),
  )
  assert.equal(fetchCount, 1, 'invalid provider data must not be retried')
})

test('rejects provider geometry that exceeds the per-leg point budget', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      routes: [{
        geometry: {
          coordinates: [
            [37.61, 55.75],
            [37.615, 55.7505],
            [37.62, 55.751],
            [37.63, 55.752],
          ],
        },
        distance: 100,
      }],
    }),
  })

  await assert.rejects(
    buildRoutePreview([start, finish], {}, 'driving', {
      fetchImpl,
      maxSegmentGeometryPoints: 3,
    }),
    (error) => error instanceof RouteBuildError &&
      error.cause instanceof RouteResourceLimitError &&
      /3-point geometry limit/i.test(error.cause.message),
  )
})

test('rejects a provider response whose declared size exceeds the byte budget', async () => {
  let readAttempted = false
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => '513' },
    json: async () => {
      readAttempted = true
      return {}
    },
  })

  await assert.rejects(
    buildRoutePreview([start, finish], {}, 'driving', {
      fetchImpl,
      maxResponseBytes: 512,
    }),
    (error) => error instanceof RouteBuildError &&
      error.cause instanceof RouteResourceLimitError &&
      /512-byte limit/i.test(error.cause.message),
  )
  assert.equal(readAttempted, false)
})

test('enforces one deadline across an entire route build', async () => {
  let fetchCount = 0
  const startedAt = Date.now()
  const fetchImpl = () => {
    fetchCount += 1
    return new Promise(() => {})
  }

  await assert.rejects(
    buildRoutePreview([start, finish], {}, 'driving', {
      fetchImpl,
      timeoutMs: 1000,
      buildTimeoutMs: 25,
    }),
    (error) => error instanceof RouteBuildError &&
      error.cause?.name === 'RouteBuildDeadlineError',
  )

  assert.equal(fetchCount, 1, 'the deadline must stop retries and provider fallbacks')
  assert.ok(Date.now() - startedAt < 500, 'the build should stop close to its global deadline')
})

test('retries transient failures but not permanent HTTP failures', async () => {
  let transientFetchCount = 0
  const transientFetch = async () => {
    transientFetchCount += 1
    if (transientFetchCount === 1) {
      return { ok: false, status: 503 }
    }
    return {
      ok: true,
      json: async () => ({
        routes: [{
          geometry: { coordinates: [[37.61, 55.75], [37.63, 55.752]] },
          distance: 100,
        }],
      }),
    }
  }

  const preview = await buildRoutePreview([start, finish], {}, 'driving', {
    fetchImpl: transientFetch,
  })
  assert.equal(preview.status, 'ready')
  assert.equal(transientFetchCount, 2)

  let permanentFetchCount = 0
  await assert.rejects(
    buildRoutePreview([start, finish], {}, 'driving', {
      fetchImpl: async () => {
        permanentFetchCount += 1
        return { ok: false, status: 400 }
      },
    }),
    RouteBuildError,
  )
  assert.equal(permanentFetchCount, 1)
})

test('preflights the batched routing-request budget before making any request', async () => {
  const controls = Array.from({ length: 26 }, (_, index) => ({
    id: `point-${index}`,
    lat: 55 + index / 10000,
    lon: 37,
  }))
  await assert.rejects(
    buildRoutePreview(controls, {}, 'cycling', {
      fetchImpl: () => assert.fail('request budget must fail before fetching'),
      maxRoutingRequests: 1,
    }),
    (error) => error instanceof RouteResourceLimitError && /needs 2 routing requests/i.test(error.message),
  )
})

test('allows routes beyond the request budget when all routed legs are cached', async () => {
  const controls = Array.from({ length: 102 }, (_, index) => ({
    id: `point-${index}`,
    lat: 55 + index / 10000,
    lon: 37,
  }))
  const cache = new Map()
  for (let index = 0; index < controls.length - 1; index += 1) {
    const from = controls[index]
    const to = controls[index + 1]
    cache.set(getRouteLegFingerprint(from, to, 'cycling', 'routed'), {
      mode: 'routed',
      geometry: [from, to].map(({ lat, lon }) => ({ lat, lon })),
      distanceMeters: 10,
    })
  }

  const preview = await buildRoutePreview(controls, {}, 'cycling', {
    cache,
    fetchImpl: () => assert.fail('cached route must not fetch'),
    maxRoutingRequests: 1,
  })

  assert.equal(preview.status, 'ready')
  assert.equal(preview.segments.length, 101)
})

test('bounds the route cache by total geometry points as well as entry count', () => {
  const cache = new Map([
    ['oldest', { geometry: Array.from({ length: 4 }, () => start) }],
    ['middle', { geometry: Array.from({ length: 4 }, () => waypoint) }],
    ['newest', { geometry: Array.from({ length: 4 }, () => finish) }],
  ])
  trimRouteLegCache(cache, 10, 8)
  assert.deepEqual([...cache.keys()], ['middle', 'newest'])
})

test('serializes provider slots at the declared per-origin interval', async () => {
  const state = new Map()
  let currentTime = 1000
  const waits = []
  const request = {
    url: 'https://routing.example/route',
    minimumIntervalMs: 1000,
  }
  const wait = async (milliseconds) => {
    waits.push(milliseconds)
    currentTime += milliseconds
  }
  await waitForRoutingProviderSlot(request, {
    state,
    now: () => currentTime,
    wait,
  })
  await waitForRoutingProviderSlot(request, {
    state,
    now: () => currentTime,
    wait,
  })
  assert.deepEqual(waits, [1000])
})
