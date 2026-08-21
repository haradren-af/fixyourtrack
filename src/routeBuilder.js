import { directLegMode, getLegMode } from './routeLegs.js'
import { shouldUseDirectGeometryFallback } from './routeQuality.js'
import { getRoutingRequestsForControls, parseRoutingResponse } from './routing.js'
import {
  anchorRouteGeometry,
  getPolylineLength,
  isValidCoordinate,
} from './trackCore.js'

export const defaultRouteBuildTimeoutMs = 15000
export const maximumRouteBuildTimeoutMs = 60000
export const maximumRouteControlPoints = 2000
export const maximumRoutingRequestsPerBuild = 100
export const maximumRoutingResponseBytes = 2 * 1024 * 1024
export const maximumRoutedSegmentPoints = 25000
export const maximumRoutePreviewPoints = 50000
export const maximumRouteLegCacheEntries = 500
export const maximumRouteLegCachePoints = 100000

const defaultRequestTimeoutMs = 7000
const maximumRequestTimeoutMs = 12000
const defaultRouteLegCacheEntries = 200
const maximumRoutedLegsPerRequest = 24
const providerRateLimitState = new Map()

export const emptyRoutePreview = Object.freeze({
  status: 'empty',
  error: '',
  segments: [],
  geometry: [],
  distanceMeters: 0,
})

export class RouteBuildError extends Error {
  constructor(from, to, cause) {
    super(`Could not build the route section from ${from.id} to ${to.id}.`, { cause })
    this.name = 'RouteBuildError'
    this.fromControlId = from.id
    this.toControlId = to.id
  }
}

export class RouteResourceLimitError extends Error {
  constructor(message, { providerSpecific = false } = {}) {
    super(message)
    this.name = 'RouteResourceLimitError'
    this.providerSpecific = providerSpecific
  }
}

class RouteBuildDeadlineError extends Error {
  constructor() {
    super('The route build exceeded its time limit.')
    this.name = 'RouteBuildDeadlineError'
  }
}

class RoutingRequestError extends Error {
  constructor(message, { cause, transient = false } = {}) {
    super(message, { cause })
    this.name = 'RoutingRequestError'
    this.transient = transient
  }
}

class RoutingRequestTimeoutError extends RoutingRequestError {
  constructor(timeoutMs) {
    super(`Request timed out after ${formatSeconds(timeoutMs)} seconds.`, { transient: true })
    this.name = 'RoutingRequestTimeoutError'
  }
}

export async function buildRoutePreview(
  controlPoints,
  legModes,
  profile,
  {
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = defaultRequestTimeoutMs,
    buildTimeoutMs = defaultRouteBuildTimeoutMs,
    maxRoutingRequests = maximumRoutingRequestsPerBuild,
    maxResponseBytes = maximumRoutingResponseBytes,
    maxSegmentGeometryPoints = maximumRoutedSegmentPoints,
    maxPreviewGeometryPoints = maximumRoutePreviewPoints,
    cache = null,
    cacheLimit = defaultRouteLegCacheEntries,
    cachePointLimit = maximumRouteLegCachePoints,
  } = {},
) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    return { ...emptyRoutePreview }
  }
  if (controlPoints.length > maximumRouteControlPoints) {
    throw new RouteResourceLimitError(
      `A route build cannot contain more than ${maximumRouteControlPoints} control points.`,
    )
  }

  const requestTimeoutMs = normalizeLimit(
    timeoutMs,
    defaultRequestTimeoutMs,
    maximumRequestTimeoutMs,
  )
  const deadlineAt = Date.now() + normalizeLimit(
    buildTimeoutMs,
    defaultRouteBuildTimeoutMs,
    maximumRouteBuildTimeoutMs,
  )
  const requestBudget = {
    remaining: normalizeLimit(
      maxRoutingRequests,
      maximumRoutingRequestsPerBuild,
      maximumRoutingRequestsPerBuild,
    ),
  }
  const responseByteLimit = normalizeLimit(
    maxResponseBytes,
    maximumRoutingResponseBytes,
    maximumRoutingResponseBytes,
  )
  const segmentPointLimit = normalizeLimit(
    maxSegmentGeometryPoints,
    maximumRoutedSegmentPoints,
    maximumRoutedSegmentPoints,
  )
  const previewPointLimit = normalizeLimit(
    maxPreviewGeometryPoints,
    maximumRoutePreviewPoints,
    maximumRoutePreviewPoints,
  )
  if (cache) {
    trimRouteLegCache(cache, cacheLimit, cachePointLimit)
  }

  const descriptors = controlPoints.slice(0, -1).map((from, index) => {
    const to = controlPoints[index + 1]
    const forceDirect = getLegMode(legModes, from.id) === directLegMode
    const mode = forceDirect ? directLegMode : 'routed'
    const cacheKey = getRouteLegFingerprint(from, to, profile, mode)
    return {
      from,
      to,
      forceDirect,
      cacheKey,
      segment: cache?.get(cacheKey) ?? null,
    }
  })

  for (const descriptor of descriptors) {
    if (!descriptor.segment && descriptor.forceDirect) {
      descriptor.segment = buildDirectSegment(descriptor.from, descriptor.to)
      cacheRouteSegment(cache, descriptor.cacheKey, descriptor.segment, cacheLimit, cachePointLimit)
    }
  }

  const requiredRoutingRequests = countRequiredRoutingRequests(descriptors)
  if (requiredRoutingRequests > requestBudget.remaining) {
    throw new RouteResourceLimitError(
      `This route needs ${requiredRoutingRequests} routing requests, but one build is limited to ${requestBudget.remaining}. Convert some sections to direct lines, reuse cached sections, or use fewer route points.`,
    )
  }

  for (let index = 0; index < descriptors.length;) {
    assertBuildCanContinue(signal, deadlineAt)
    if (descriptors[index].segment || descriptors[index].forceDirect) {
      index += 1
      continue
    }

    const runStart = index
    while (
      index < descriptors.length &&
      index - runStart < maximumRoutedLegsPerRequest &&
      !descriptors[index].segment &&
      !descriptors[index].forceDirect
    ) {
      index += 1
    }
    const run = descriptors.slice(runStart, index)

    await resolveRoutedRun(run, profile, {
      signal,
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      deadlineAt,
      requestBudget,
      maxResponseBytes: responseByteLimit,
      maxSegmentGeometryPoints: segmentPointLimit,
      maxPreviewGeometryPoints: previewPointLimit,
      cache,
      cacheLimit,
      cachePointLimit,
    })
  }

  const segments = []
  let geometry = []
  let distanceMeters = 0
  for (const descriptor of descriptors) {
    const segment = descriptor.segment
    try {
      validateBuiltSegment(segment, segmentPointLimit)
      const nextPointCount = geometry.length + segment.geometry.length - (geometry.length ? 1 : 0)
      if (nextPointCount > previewPointLimit) {
        throw new RouteResourceLimitError(
          `The route preview exceeds the ${previewPointLimit}-point geometry limit.`,
        )
      }
      if (!Number.isFinite(distanceMeters + segment.distanceMeters)) {
        throw new RouteResourceLimitError('The route distance exceeds the supported numeric range.')
      }
    }
    catch (error) {
      throw new RouteBuildError(descriptor.from, descriptor.to, error)
    }

    segments.push({
      ...segment,
      id: `${descriptor.from.id}-${descriptor.to.id}`,
      insertAfterId: descriptor.from.id,
    })
    if (!geometry.length) {
      geometry = [...segment.geometry]
    }
    else {
      for (let index = 1; index < segment.geometry.length; index += 1) {
        geometry.push(segment.geometry[index])
      }
    }
    distanceMeters += segment.distanceMeters
  }

  return {
    status: 'ready',
    error: '',
    segments,
    geometry,
    distanceMeters,
    snappedControls: buildSnappedControls(controlPoints, segments),
  }
}

async function resolveRoutedRun(run, profile, options) {
  const {
    signal,
    fetchImpl,
    timeoutMs,
    deadlineAt,
    requestBudget,
    maxResponseBytes,
    maxSegmentGeometryPoints,
    maxPreviewGeometryPoints,
    cache,
    cacheLimit,
    cachePointLimit,
  } = options
  const controls = [run[0].from, ...run.map(({ to }) => to)]

  try {
    const segments = await fetchRouteSegments(controls, profile, {
      signal,
      fetchImpl,
      timeoutMs,
      deadlineAt,
      requestBudget,
      maxResponseBytes,
      maxGeometryPoints: Math.min(
        maxPreviewGeometryPoints,
        maxSegmentGeometryPoints * run.length,
      ),
      maxSegmentGeometryPoints,
    })
    for (let index = 0; index < run.length; index += 1) {
      run[index].segment = segments[index]
      cacheRouteSegment(
        cache,
        run[index].cacheKey,
        segments[index],
        cacheLimit,
        cachePointLimit,
      )
    }
    return
  }
  catch (error) {
    if (signal?.aborted) throw error
    if (run.length === 1 || !canSplitFailedRun(error)) {
      throw new RouteBuildError(run[0].from, run.at(-1).to, error)
    }
  }

  const middle = Math.ceil(run.length / 2)
  await resolveRoutedRun(run.slice(0, middle), profile, options)
  await resolveRoutedRun(run.slice(middle), profile, options)
}

function canSplitFailedRun(error) {
  return error?.name !== 'RouteBuildDeadlineError' &&
    !(error instanceof RouteResourceLimitError && !error.providerSpecific)
}

function countRequiredRoutingRequests(descriptors) {
  let requests = 0
  let uncachedRunLength = 0

  for (const descriptor of descriptors) {
    if (!descriptor.segment && !descriptor.forceDirect) {
      uncachedRunLength += 1
      continue
    }
    requests += Math.ceil(uncachedRunLength / maximumRoutedLegsPerRequest)
    uncachedRunLength = 0
  }

  return requests + Math.ceil(uncachedRunLength / maximumRoutedLegsPerRequest)
}

export function getRouteLegFingerprint(from, to, profile, mode) {
  return JSON.stringify([
    profile,
    mode,
    from.lat,
    from.lon,
    to.lat,
    to.lon,
  ])
}

export async function fetchRouteSegment(
  from,
  to,
  profile,
  {
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = defaultRequestTimeoutMs,
    deadlineAt = Date.now() + defaultRouteBuildTimeoutMs,
    requestBudget = { remaining: maximumRoutingRequestsPerBuild },
    maxResponseBytes = maximumRoutingResponseBytes,
    maxGeometryPoints = maximumRoutedSegmentPoints,
  } = {},
) {
  const segments = await fetchRouteSegments([from, to], profile, {
    signal,
    fetchImpl,
    timeoutMs,
    deadlineAt,
    requestBudget,
    maxResponseBytes,
    maxGeometryPoints,
    maxSegmentGeometryPoints: maxGeometryPoints,
  })
  return segments[0]
}

export async function fetchRouteSegments(
  controls,
  profile,
  {
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = defaultRequestTimeoutMs,
    deadlineAt = Date.now() + defaultRouteBuildTimeoutMs,
    requestBudget = { remaining: maximumRoutingRequestsPerBuild },
    maxResponseBytes = maximumRoutingResponseBytes,
    maxGeometryPoints = maximumRoutePreviewPoints,
    maxSegmentGeometryPoints = maximumRoutedSegmentPoints,
  } = {},
) {
  if (!Array.isArray(controls) || controls.length < 2 || !controls.every(isValidCoordinate)) {
    throw new Error('Route section contains invalid coordinates.')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Routing is unavailable in this environment.')
  }

  const requestTimeoutLimit = normalizeLimit(
    timeoutMs,
    defaultRequestTimeoutMs,
    maximumRequestTimeoutMs,
  )
  const responseByteLimit = normalizeLimit(
    maxResponseBytes,
    maximumRoutingResponseBytes,
    maximumRoutingResponseBytes,
  )
  const geometryPointLimit = normalizeLimit(
    maxGeometryPoints,
    maximumRoutePreviewPoints,
    maximumRoutePreviewPoints,
  )
  const segmentPointLimit = normalizeLimit(
    maxSegmentGeometryPoints,
    maximumRoutedSegmentPoints,
    maximumRoutedSegmentPoints,
  )
  const failures = []
  let lastFailure = null
  const requests = getRoutingRequestsForControls(controls, profile)

  for (const [requestIndex, request] of requests.entries()) {
    const attempts = requestIndex === 0 ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      assertBuildCanContinue(signal, deadlineAt)
      await waitForRoutingProviderSlot(request, { signal, deadlineAt })
      consumeRequestBudget(requestBudget)
      const remainingBuildMs = Math.max(1, deadlineAt - Date.now())
      const effectiveTimeoutMs = Math.min(requestTimeoutLimit, remainingBuildMs)

      try {
        const segments = await runWithTimeout(async (requestSignal) => {
          const response = await fetchImpl(request.url, { signal: requestSignal })
          if (!response?.ok) {
            const status = Number(response?.status) || 0
            throw new RoutingRequestError(`HTTP ${status || 'error'}`, {
              transient: isTransientHttpStatus(status),
            })
          }

          const data = await readBoundedJson(response, responseByteLimit)
          const route = parseRoutingResponse(data, request.provider)
          const geometry = normalizeProviderGeometry(route.coordinates, geometryPointLimit)

          if (route.distanceMeters !== null && (
            !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0
          )) {
            throw new RoutingRequestError('routing result contains an invalid distance')
          }

          return splitProviderGeometry(geometry, controls, segmentPointLimit)
        }, {
          signal,
          timeoutMs: effectiveTimeoutMs,
        })
        assertBuildCanContinue(signal, deadlineAt)
        return segments
      }
      catch (error) {
        if (signal?.aborted) {
          throw error
        }
        if (error instanceof RouteResourceLimitError && !error.providerSpecific) {
          throw error
        }
        if (error instanceof RoutingRequestTimeoutError && Date.now() >= deadlineAt - 1) {
          throw new RouteBuildDeadlineError()
        }

        lastFailure = error
        failures.push(getFailureMessage(error))
        if (error instanceof RoutingRequestTimeoutError) {
          break
        }
        if (!isTransientRoutingFailure(error)) {
          break
        }
      }
    }
  }

  if (lastFailure instanceof RouteResourceLimitError) {
    throw lastFailure
  }
  throw new Error(`Routing services are unreachable: ${failures.at(-1) ?? 'no route found'}`)
}

export function buildDirectSegment(from, to) {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) {
    throw new Error('Direct segment contains invalid coordinates.')
  }

  const geometry = [
    { lat: from.lat, lon: from.lon },
    { lat: to.lat, lon: to.lon },
  ]

  return {
    mode: 'direct',
    geometry,
    distanceMeters: getPolylineLength(geometry),
  }
}

export function buildRouteDisplayPreview(
  controlPoints,
  legModes,
  profile,
  {
    cache = null,
    status = 'loading',
    error = '',
    fingerprint,
    failedLegId = null,
    failedToControlId = null,
  } = {},
) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    return { ...emptyRoutePreview, status, error, fingerprint, failedLegId, failedToControlId }
  }

  const segments = []
  let geometry = []
  let distanceMeters = 0
  for (let index = 0; index < controlPoints.length - 1; index += 1) {
    const from = controlPoints[index]
    const to = controlPoints[index + 1]
    const mode = getLegMode(legModes, from.id) === directLegMode ? directLegMode : 'routed'
    const cacheKey = getRouteLegFingerprint(from, to, profile, mode)
    let segment = cache?.get(cacheKey) ?? null
    try {
      if (segment) validateBuiltSegment(segment, maximumRoutedSegmentPoints)
    }
    catch {
      segment = null
    }
    if (!segment) {
      segment = buildDirectSegment(from, to)
      if (mode !== directLegMode) segment = { ...segment, mode: 'unresolved' }
    }

    const displaySegment = {
      ...segment,
      id: `${from.id}-${to.id}`,
      insertAfterId: from.id,
    }
    segments.push(displaySegment)
    geometry = appendSegmentGeometry(geometry, displaySegment.geometry)
    distanceMeters += displaySegment.distanceMeters
  }

  return {
    status,
    error,
    fingerprint,
    failedLegId,
    failedToControlId,
    segments,
    geometry,
    distanceMeters,
  }
}

export function hydrateRouteLegCache(
  cache,
  controlPoints,
  legModes,
  profile,
  preview,
  {
    cacheLimit = defaultRouteLegCacheEntries,
    cachePointLimit = maximumRouteLegCachePoints,
  } = {},
) {
  if (
    !cache ||
    !Array.isArray(controlPoints) ||
    controlPoints.length < 2 ||
    !Array.isArray(preview?.segments) ||
    preview.segments.length !== controlPoints.length - 1
  ) {
    return 0
  }

  let restored = 0
  for (let index = 0; index < preview.segments.length; index += 1) {
    const from = controlPoints[index]
    const to = controlPoints[index + 1]
    const expectedMode = getLegMode(legModes, from.id) === directLegMode
      ? directLegMode
      : 'routed'
    const segment = preview.segments[index]
    try {
      validateBuiltSegment(segment, maximumRoutedSegmentPoints)
    }
    catch {
      continue
    }
    if (
      segment.mode !== expectedMode ||
      !hasSameCoordinate(segment.geometry[0], from) ||
      !hasSameCoordinate(segment.geometry.at(-1), to)
    ) {
      continue
    }

    const cacheKey = getRouteLegFingerprint(from, to, profile, expectedMode)
    cacheRouteSegment(cache, cacheKey, {
      mode: expectedMode,
      geometry: segment.geometry.map(({ lat, lon }) => ({ lat, lon })),
      distanceMeters: segment.distanceMeters,
    }, cacheLimit, cachePointLimit)
    restored += 1
  }

  return restored
}

export function appendSegmentGeometry(currentGeometry, nextGeometry) {
  if (!currentGeometry.length) {
    return [...nextGeometry]
  }

  return [...currentGeometry, ...nextGeometry.slice(1)]
}

function assertBuildCanContinue(signal, deadlineAt) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The route build was aborted.', 'AbortError')
  }
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
    throw new RouteBuildDeadlineError()
  }
}

function consumeRequestBudget(requestBudget) {
  if (!requestBudget || !Number.isInteger(requestBudget.remaining) || requestBudget.remaining <= 0) {
    throw new RouteResourceLimitError('The route build exceeded its routing-request budget.')
  }
  requestBudget.remaining -= 1
}

function normalizeProviderGeometry(coordinates, limit) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new RoutingRequestError('routing result contains no route geometry')
  }
  if (coordinates.length > limit) {
    throw new RouteResourceLimitError(
      `A routed segment exceeds the ${limit}-point geometry limit.`,
      { providerSpecific: true },
    )
  }

  const geometry = []
  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index]
    const point = {
      lat: coordinate?.[1],
      lon: coordinate?.[0],
    }
    if (!isValidCoordinate(point)) {
      throw new RoutingRequestError('routing result contains invalid coordinates')
    }
    geometry.push(point)
  }
  return geometry
}

function splitProviderGeometry(geometry, controls, segmentPointLimit) {
  if (geometry.length < controls.length) {
    throw new RoutingRequestError('routing result cannot be split at every route point')
  }

  const segments = []
  let geometryStart = 0
  for (let index = 0; index < controls.length - 1; index += 1) {
    const remainingLegs = controls.length - index - 2
    const geometryEnd = index === controls.length - 2
      ? geometry.length - 1
      : findClosestGeometryIndex(
          geometry,
          controls[index + 1],
          geometryStart + 1,
          geometry.length - remainingLegs - 1,
        )
    const anchoredGeometry = anchorRouteGeometry(
      geometry.slice(geometryStart, geometryEnd + 1),
      controls[index],
      controls[index + 1],
    )
    if (anchoredGeometry.length > segmentPointLimit) {
      throw new RouteResourceLimitError(
        `A routed segment exceeds the ${segmentPointLimit}-point geometry limit.`,
        { providerSpecific: true },
      )
    }
    if (shouldUseDirectGeometryFallback(controls[index], controls[index + 1], anchoredGeometry)) {
      throw new RoutingRequestError('routing result failed the geometry quality check')
    }
    const distanceMeters = getPolylineLength(anchoredGeometry)
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw new RoutingRequestError('routing result contains an invalid distance')
    }
    segments.push({
      mode: 'routed',
      geometry: anchoredGeometry,
      distanceMeters,
      snappedFrom: { ...geometry[geometryStart] },
      snappedTo: { ...geometry[geometryEnd] },
    })
    geometryStart = geometryEnd
  }
  return segments
}

function buildSnappedControls(controlPoints, segments) {
  return controlPoints.map((control, index) => {
    const previousSegment = index > 0 ? segments[index - 1] : null
    const nextSegment = index < segments.length ? segments[index] : null
    const snappedPoint = previousSegment?.snappedTo ?? nextSegment?.snappedFrom
    return {
      id: control.id,
      lat: snappedPoint?.lat ?? control.lat,
      lon: snappedPoint?.lon ?? control.lon,
    }
  })
}

function findClosestGeometryIndex(geometry, control, startIndex, endIndex) {
  let closestIndex = startIndex
  let closestDistance = Number.POSITIVE_INFINITY
  for (let index = startIndex; index <= endIndex; index += 1) {
    const latDistance = geometry[index].lat - control.lat
    const lonDistance = geometry[index].lon - control.lon
    const distance = latDistance * latDistance + lonDistance * lonDistance
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  }
  return closestIndex
}

function validateBuiltSegment(segment, pointLimit) {
  if (
    !segment ||
    !Array.isArray(segment.geometry) ||
    segment.geometry.length < 2 ||
    segment.geometry.length > pointLimit ||
    !hasOnlyValidGeometryPoints(segment.geometry) ||
    !Number.isFinite(segment.distanceMeters) ||
    segment.distanceMeters < 0
  ) {
    throw new Error('The route segment is invalid or exceeds its geometry budget.')
  }
}

function hasOnlyValidGeometryPoints(geometry) {
  for (let index = 0; index < geometry.length; index += 1) {
    if (!isValidCoordinate(geometry[index])) {
      return false
    }
  }
  return true
}

function hasSameCoordinate(left, right) {
  return left?.lat === right?.lat && left?.lon === right?.lon
}

export function trimRouteLegCache(cache, limit, pointLimit = maximumRouteLegCachePoints) {
  const boundedLimit = normalizeLimit(
    limit,
    defaultRouteLegCacheEntries,
    maximumRouteLegCacheEntries,
  )
  const boundedPointLimit = normalizeLimit(
    pointLimit,
    maximumRouteLegCachePoints,
    maximumRouteLegCachePoints,
  )
  let cachedPoints = countCachedGeometryPoints(cache)
  while (cache.size > boundedLimit || cachedPoints > boundedPointLimit) {
    const oldestKey = cache.keys().next().value
    const oldest = cache.get(oldestKey)
    cachedPoints -= Array.isArray(oldest?.geometry) ? oldest.geometry.length : 0
    cache.delete(oldestKey)
  }
}

function cacheRouteSegment(cache, key, segment, limit, pointLimit) {
  if (!cache) return
  cache.set(key, segment)
  trimRouteLegCache(cache, limit, pointLimit)
}

export async function waitForRoutingProviderSlot(request, {
  signal,
  deadlineAt = Number.MAX_SAFE_INTEGER,
  state = providerRateLimitState,
  now = Date.now,
  wait = waitWithAbort,
} = {}) {
  const minimumIntervalMs = Number.isFinite(request?.minimumIntervalMs)
    ? Math.max(0, request.minimumIntervalMs)
    : 0
  if (minimumIntervalMs === 0) return

  const origin = new URL(request.url).origin
  let entry = state.get(origin)
  if (!entry) {
    entry = { tail: Promise.resolve(), lastStartedAt: Number.NEGATIVE_INFINITY }
    state.set(origin, entry)
  }
  const reservation = entry.tail
    .catch(() => {})
    .then(async () => {
      assertProviderSlotCanContinue(signal, deadlineAt, now)
      const delayMs = Math.max(0, entry.lastStartedAt + minimumIntervalMs - now())
      if (delayMs > 0) {
        if (now() + delayMs >= deadlineAt) {
          throw new RouteBuildDeadlineError()
        }
        await wait(delayMs, signal)
      }
      assertProviderSlotCanContinue(signal, deadlineAt, now)
      entry.lastStartedAt = now()
    })
  entry.tail = reservation
  await reservation
}

function assertProviderSlotCanContinue(signal, deadlineAt, now) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The route build was aborted.', 'AbortError')
  }
  if (!Number.isFinite(deadlineAt) || now() >= deadlineAt) {
    throw new RouteBuildDeadlineError()
  }
}

function countCachedGeometryPoints(cache) {
  let count = 0
  for (const segment of cache.values()) {
    if (Array.isArray(segment?.geometry)) count += segment.geometry.length
  }
  return count
}

function waitWithAbort(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = () => {
      clearTimeout(timeout)
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    const timeout = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function readBoundedJson(response, byteLimit) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    throw new RouteResourceLimitError(
      `The routing response exceeds the ${byteLimit}-byte limit.`,
      { providerSpecific: true },
    )
  }

  try {
    if (response.body?.getReader) {
      const bytes = await readBoundedBody(response.body.getReader(), byteLimit)
      return JSON.parse(new TextDecoder().decode(bytes))
    }
    if (typeof response.text === 'function') {
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > byteLimit) {
        throw new RouteResourceLimitError(
          `The routing response exceeds the ${byteLimit}-byte limit.`,
          { providerSpecific: true },
        )
      }
      return JSON.parse(text)
    }
    if (typeof response.json === 'function') {
      const data = await response.json()
      const serialized = JSON.stringify(data)
      if (new TextEncoder().encode(serialized).byteLength > byteLimit) {
        throw new RouteResourceLimitError(
          `The routing response exceeds the ${byteLimit}-byte limit.`,
          { providerSpecific: true },
        )
      }
      return data
    }
  }
  catch (error) {
    if (error instanceof RouteResourceLimitError) {
      throw error
    }
    throw new RoutingRequestError('routing service returned invalid JSON', { cause: error })
  }

  throw new RoutingRequestError('routing service returned an unreadable response')
}

async function readBoundedBody(reader, byteLimit) {
  const chunks = []
  let totalLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      totalLength += value.byteLength
      if (totalLength > byteLimit) {
        reader.cancel('Routing response exceeded its size limit.').catch(() => {})
        throw new RouteResourceLimitError(
          `The routing response exceeds the ${byteLimit}-byte limit.`,
          { providerSpecific: true },
        )
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock?.()
  }

  const bytes = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function runWithTimeout(operation, { signal, timeoutMs }) {
  const requestController = new AbortController()
  let rejectOnAbort
  const abortPromise = new Promise((resolve, reject) => {
    void resolve
    rejectOnAbort = reject
  })
  const abortRequest = (reason) => {
    if (requestController.signal.aborted) {
      return
    }
    requestController.abort(reason)
    rejectOnAbort(reason)
  }
  const abortFromUpstream = () => abortRequest(
    signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The route request was aborted.', 'AbortError'),
  )
  const timeoutError = new RoutingRequestTimeoutError(timeoutMs)
  const timeout = globalThis.setTimeout(() => abortRequest(timeoutError), timeoutMs)

  if (signal?.aborted) {
    abortFromUpstream()
  }
  else {
    signal?.addEventListener('abort', abortFromUpstream, { once: true })
  }

  try {
    return await Promise.race([
      operation(requestController.signal),
      abortPromise,
    ])
  }
  catch (error) {
    if (error instanceof RoutingRequestError || error instanceof RouteResourceLimitError) {
      throw error
    }
    if (requestController.signal.aborted) {
      throw requestController.signal.reason instanceof Error
        ? requestController.signal.reason
        : new DOMException('The route request was aborted.', 'AbortError')
    }
    throw new RoutingRequestError('network request failed', { cause: error, transient: true })
  }
  finally {
    globalThis.clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromUpstream)
  }
}

function isTransientRoutingFailure(error) {
  return error instanceof RoutingRequestError && error.transient
}

function isTransientHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

function getFailureMessage(error) {
  return error instanceof Error ? error.message : 'network error'
}

function normalizeLimit(value, fallback, hardMaximum) {
  return Number.isInteger(value) && value > 0
    ? Math.min(value, hardMaximum)
    : fallback
}

function formatSeconds(milliseconds) {
  return Math.max(0.001, milliseconds / 1000).toLocaleString('en-US', {
    maximumFractionDigits: 3,
    useGrouping: false,
  })
}
