import { normalizeLegModes } from './routeLegs.js'
import {
  projectDatabaseName as databaseName,
  projectDatabaseVersion,
  upgradeProjectDatabase,
} from './projectStore.js'

const storeName = 'repair-drafts'
const activeDraftId = 'active'
const currentSchemaVersion = 3
const maximumStoredSamples = 1_000_000
const maximumStoredWaypoints = 2000
const numericSampleFields = ['lat', 'lon', 'ele', 'speed', 'distance', 'heartRate', 'cadence', 'power', 'temperature']
const storedSampleFields = new Set([...numericSampleFields, 'time', 'segmentStart', 'repairAccepted'])
const storedTrackFields = new Set(['name', 'format', 'samples'])

export async function loadRepairDraft() {
  try {
    const database = await openDatabase()
    const storedDraft = await runRequest(database, 'readonly', (store) => store.get(activeDraftId))
    return classifyRepairDraft(storedDraft)
  }
  catch (error) {
    return {
      status: 'unavailable',
      draft: null,
      error,
    }
  }
}

export function classifyRepairDraft(storedDraft) {
  if (storedDraft === undefined || storedDraft === null) {
    return { status: 'empty', draft: null }
  }
  if (isUnsupportedRepairDraft(storedDraft)) {
    return { status: 'unsupported', draft: null }
  }

  const draft = normalizeRepairDraft(storedDraft)
  return draft
    ? { status: 'ready', draft }
    : { status: 'corrupt', draft: null }
}

export function shouldProtectRepairDraft(loadStatus) {
  return loadStatus !== 'empty'
}

export function isReplaceableRepairDraftStatus(loadStatus) {
  return ['ready', 'corrupt', 'unsupported'].includes(loadStatus)
}

export function createLatestRepairDraftSaveQueue({ save, onSaved, onFailed }) {
  let generation = 0
  let latest = null
  let pending = null
  let running = false
  let idleWaiters = []
  const activityListeners = new Set()
  let lastReportedActivity = false

  function reportActivity() {
    const active = running || Boolean(pending)
    if (active === lastReportedActivity) {
      return
    }
    lastReportedActivity = active
    activityListeners.forEach((listener) => listener(active))
  }

  function resolveIdleWaiters() {
    const waiters = idleWaiters
    idleWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  async function drain() {
    while (pending) {
      const entry = pending
      pending = null
      try {
        const savedAt = await save(entry.snapshot)
        if (entry === latest && entry.generation === generation) {
          onSaved?.(savedAt, entry.snapshot)
        }
      }
      catch (error) {
        if (entry === latest && entry.generation === generation) {
          onFailed?.(error, entry.snapshot)
        }
      }
    }
    running = false
    if (pending) {
      running = true
      reportActivity()
      void drain()
      return
    }
    reportActivity()
    resolveIdleWaiters()
  }

  return {
    enqueue(snapshot) {
      const entry = { generation, snapshot }
      latest = entry
      pending = entry
      if (!running) {
        running = true
        reportActivity()
        void drain()
      }
    },
    invalidate() {
      generation += 1
      latest = null
      pending = null
      reportActivity()
    },
    subscribeActivity(listener) {
      activityListeners.add(listener)
      listener(running || Boolean(pending))
      return () => {
        activityListeners.delete(listener)
      }
    },
    whenIdle() {
      return running || pending
        ? new Promise((resolve) => idleWaiters.push(resolve))
        : Promise.resolve()
    },
  }
}

export async function saveRepairDraft(sourceTrack, workingTrack, repairSession = null) {
  assertTrackCanBeSaved(sourceTrack)
  assertTrackCanBeSaved(workingTrack)
  assertRepairSessionCanBeSaved(repairSession)
  const database = await openDatabase()
  const savedAt = new Date().toISOString()

  await runRequest(database, 'readwrite', (store) => store.put({
    id: activeDraftId,
    schemaVersion: currentSchemaVersion,
    savedAt,
    sourceTrack: serializeTrack(sourceTrack),
    workingTrack: serializeTrack(workingTrack),
    repairSession,
  }))

  return savedAt
}

export async function deleteRepairDraft() {
  const database = await openDatabase()
  await runRequest(database, 'readwrite', (store) => store.delete(activeDraftId))
}

export function normalizeRepairDraft(draft) {
  if (!draft || typeof draft !== 'object') {
    return null
  }

  const schemaVersion = draft.schemaVersion ?? 1
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > currentSchemaVersion) {
    return null
  }
  const sourceTrack = normalizeSerializedTrack(draft.sourceTrack)
  const workingTrack = normalizeSerializedTrack(draft.workingTrack)
  if (!sourceTrack || !workingTrack) {
    return null
  }

  const savedAt = new Date(draft.savedAt)
  if (!Number.isFinite(savedAt.getTime())) {
    return null
  }
  const repairSession = schemaVersion >= 2
    ? normalizeRepairSession(draft.repairSession, workingTrack, schemaVersion)
    : null
  if (schemaVersion >= 2 && draft.repairSession !== undefined && draft.repairSession !== null && !repairSession) {
    return null
  }

  return {
    id: activeDraftId,
    schemaVersion: currentSchemaVersion,
    savedAt: savedAt.toISOString(),
    sourceTrack,
    workingTrack,
    repairSession,
  }
}

export function isUnsupportedRepairDraft(draft) {
  return Number.isInteger(draft?.schemaVersion) && draft.schemaVersion > currentSchemaVersion
}

function serializeTrack(track) {
  assertTrackCanBeSaved(track)
  return {
    name: track.name,
    format: track.format,
    samples: track.samples.map(normalizeSample).filter(Boolean),
  }
}

export function assertTrackCanBeSaved(track) {
  if (!Array.isArray(track?.samples)) {
    throw new Error('The repair draft does not contain a valid sample list.')
  }
  if (track.samples.length > maximumStoredSamples) {
    throw new Error(`This track has too many samples for a safe local draft (maximum ${maximumStoredSamples.toLocaleString('en-US')}). Export it instead.`)
  }
}

export function assertRepairSessionCanBeSaved(session) {
  if (!session) {
    return
  }
  const routePreview = session.routePreview
  const previewPointCount = Array.isArray(routePreview?.segments)
    ? routePreview.segments.reduce((total, segment) => (
        total + (Array.isArray(segment?.geometry) ? segment.geometry.length : 0)
      ), 0)
    : 0
  if (
    (Array.isArray(session.removedSegmentSamples) && session.removedSegmentSamples.length > maximumStoredSamples) ||
    (Array.isArray(session.viaPoints) && session.viaPoints.length > maximumStoredWaypoints) ||
    (Array.isArray(routePreview?.segments) && routePreview.segments.length > maximumStoredWaypoints) ||
    (Array.isArray(routePreview?.geometry) && routePreview.geometry.length > 250_000) ||
    previewPointCount > 250_000
  ) {
    throw new Error('The active repair is too large for a safe local draft. Apply or cancel it, then export the track.')
  }
}

function normalizeSerializedTrack(track) {
  if (
    !track ||
    typeof track !== 'object' ||
    Array.isArray(track) ||
    Object.keys(track).some((field) => !storedTrackFields.has(field)) ||
    typeof track.name !== 'string' ||
    !track.name.trim() ||
    !['gpx', 'fit'].includes(track.format) ||
    !Array.isArray(track.samples) ||
    track.samples.length < 2 ||
    track.samples.length > maximumStoredSamples
  ) {
    return null
  }

  const samples = track.samples.map(normalizeStoredSample)
  if (samples.some((sample) => !sample) || samples.filter(hasValidCoordinate).length < 2) {
    return null
  }

  return {
    name: track.name,
    format: track.format,
    samples,
  }
}

function normalizeStoredSample(sample) {
  if (
    !sample ||
    typeof sample !== 'object' ||
    Array.isArray(sample) ||
    Object.keys(sample).some((field) => !storedSampleFields.has(field)) ||
    numericSampleFields.some((field) => (
      sample[field] !== undefined && sample[field] !== null && !Number.isFinite(sample[field])
    )) ||
    (sample.time !== undefined && sample.time !== null && (
      typeof sample.time !== 'string' || sample.time.length > 100
    )) ||
    (sample.segmentStart !== undefined && typeof sample.segmentStart !== 'boolean') ||
    (sample.repairAccepted !== undefined && typeof sample.repairAccepted !== 'boolean')
  ) {
    return null
  }
  return normalizeSample(sample)
}

function hasValidCoordinate(sample) {
  return Number.isFinite(sample?.lat) &&
    Number.isFinite(sample?.lon) &&
    sample.lat >= -90 &&
    sample.lat <= 90 &&
    sample.lon >= -180 &&
    sample.lon <= 180
}

function normalizeRepairSession(session, workingTrack, schemaVersion) {
  if (!session || !['before', 'after', 'middle'].includes(session.rebuildDirection)) {
    return null
  }
  try {
    assertRepairSessionCanBeSaved(session)
  }
  catch {
    return null
  }

  const workingPoints = workingTrack.samples
    .map((sample, sampleIndex) => ({ ...sample, sampleIndex }))
    .filter(hasValidCoordinate)
  const pointCount = workingPoints.length
  const selectedCutPointIndex = readOptionalIndex(session.selectedCutPointIndex, pointCount)
  const tailAnchorPointIndex = readOptionalIndex(session.tailAnchorPointIndex, pointCount)
  if (
    (session.selectedCutPointIndex !== undefined && session.selectedCutPointIndex !== null && selectedCutPointIndex === null) ||
    tailAnchorPointIndex === null
  ) {
    return null
  }
  const middleRepairRange = normalizeMiddleRange(session.middleRepairRange, workingTrack.samples.length)
  if (session.rebuildDirection === 'middle' && !middleRepairRange) {
    return null
  }
  if (session.rebuildDirection !== 'middle' && session.middleRepairRange && !middleRepairRange) {
    return null
  }
  const viaPoints = normalizeViaPoints(session.viaPoints)
  if (!viaPoints) {
    return null
  }
  const validControlIds = new Set(['anchor', 'endpoint', ...viaPoints.map(({ id }) => id)])
  const storedLegModes = schemaVersion === 2 && session.legModes === undefined
    ? {}
    : session.legModes
  const legModes = normalizeLegModes(storedLegModes)
  if (
    !storedLegModes ||
    typeof storedLegModes !== 'object' ||
    Array.isArray(storedLegModes) ||
    Object.keys(legModes).length !== Object.keys(storedLegModes).length ||
    Object.keys(legModes).some((id) => !validControlIds.has(id))
  ) {
    return null
  }
  const activeWaypointId = session.activeWaypointId === undefined || session.activeWaypointId === null
    ? null
    : typeof session.activeWaypointId === 'string' && viaPoints.some(({ id }) => id === session.activeWaypointId)
      ? session.activeWaypointId
      : undefined
  if (activeWaypointId === undefined) {
    return null
  }
  const endpoint = session.endpoint === undefined || session.endpoint === null
    ? null
    : normalizeStoredCoordinate(session.endpoint)
  if (session.endpoint && !endpoint) {
    return null
  }
  const removedSegmentSamples = Array.isArray(session.removedSegmentSamples)
    ? session.removedSegmentSamples.map(normalizeStoredSample)
    : null
  if (!removedSegmentSamples || removedSegmentSamples.some((sample) => !sample)) {
    return null
  }
  const anchorPoint = workingPoints[tailAnchorPointIndex]
  if (
    session.rebuildDirection === 'middle' && (
      anchorPoint.sampleIndex !== middleRepairRange.startSampleIndex ||
      !endpoint ||
      !hasSameCoordinate(endpoint, workingTrack.samples[middleRepairRange.endSampleIndex])
    )
  ) {
    return null
  }
  const mapMode = session.mapMode === undefined
    ? 'inspect'
    : ['inspect', 'pick-endpoint', 'add-offgrid-waypoint'].includes(session.mapMode)
      ? session.mapMode
      : null
  if (!mapMode) {
    return null
  }
  const controlPoints = endpoint
    ? session.rebuildDirection === 'before'
      ? [
          { id: 'endpoint', ...endpoint },
          ...viaPoints,
          { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon },
        ]
      : [
          { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon },
          ...viaPoints,
          { id: 'endpoint', ...endpoint },
        ]
    : []
  const routePreview = normalizeRoutePreview(session.routePreview, controlPoints, legModes)
  if (!routePreview) {
    return null
  }

  return {
    selectedCutPointIndex,
    tailAnchorPointIndex,
    removedSegmentSamples,
    rebuildDirection: session.rebuildDirection,
    middleRepairRange,
    endpoint,
    viaPoints,
    legModes,
    activeWaypointId,
    mapMode,
    routePreview,
  }
}

function normalizeViaPoints(points) {
  if (points === undefined) {
    return []
  }
  if (!Array.isArray(points)) {
    return null
  }

  const usedIds = new Set()
  const normalized = []
  for (const point of points) {
    if (
      !hasValidCoordinate(point) ||
      typeof point.id !== 'string' ||
      !point.id.trim() ||
      point.id !== point.id.trim() ||
      usedIds.has(point.id) ||
      (point.manualPoint !== undefined && typeof point.manualPoint !== 'boolean')
    ) {
      return null
    }
    usedIds.add(point.id)
    normalized.push({
      id: point.id,
      lat: point.lat,
      lon: point.lon,
      manualPoint: Boolean(point.manualPoint),
    })
  }
  return normalized
}

function normalizeStoredCoordinate(point) {
  if (
    !hasValidCoordinate(point) ||
    Object.keys(point).some((field) => !['lat', 'lon'].includes(field))
  ) {
    return null
  }
  return { lat: point.lat, lon: point.lon }
}

function normalizeMiddleRange(range, sampleCount) {
  if (
    !range ||
    !Number.isInteger(range.startSampleIndex) ||
    !Number.isInteger(range.endSampleIndex) ||
    range.startSampleIndex < 0 ||
    range.endSampleIndex <= range.startSampleIndex ||
    range.endSampleIndex >= sampleCount
  ) {
    return null
  }
  return {
    startSampleIndex: range.startSampleIndex,
    endSampleIndex: range.endSampleIndex,
  }
}

function normalizeRoutePreview(preview, controlPoints, legModes) {
  if (preview?.status !== 'ready') {
    return {
      status: 'idle',
      error: '',
      segments: [],
      geometry: [],
      distanceMeters: 0,
    }
  }
  if (
    controlPoints.length < 2 ||
    !Array.isArray(preview.geometry) ||
    preview.geometry.some((point) => !hasValidCoordinate(point)) ||
    !Array.isArray(preview.segments) ||
    preview.segments.length !== controlPoints.length - 1 ||
    !Number.isFinite(preview.distanceMeters) ||
    preview.distanceMeters < 0
  ) {
    return null
  }
  const segments = preview.segments.map((segment, index) => normalizeRouteSegment(
    segment,
    controlPoints[index],
    controlPoints[index + 1],
    legModes[controlPoints[index].id] === 'direct' ? 'direct' : 'routed',
  ))
  if (segments.some((segment) => !segment)) {
    return null
  }
  const geometry = segments.flatMap((segment, index) => index ? segment.geometry.slice(1) : segment.geometry)
  const distanceMeters = segments.reduce((total, segment) => total + segment.distanceMeters, 0)
  if (
    !hasSameGeometry(geometry, preview.geometry) ||
    Math.abs(distanceMeters - preview.distanceMeters) > Math.max(0.01, distanceMeters * 1e-9)
  ) {
    return null
  }
  return {
    status: 'ready',
    error: '',
    segments,
    geometry,
    distanceMeters: preview.distanceMeters,
  }
}

function normalizeRouteSegment(segment, from, to, expectedMode) {
  if (
    !segment ||
    typeof segment !== 'object' ||
    Array.isArray(segment) ||
    segment.id !== `${from.id}-${to.id}` ||
    segment.insertAfterId !== from.id ||
    segment.mode !== expectedMode ||
    !Array.isArray(segment.geometry) ||
    segment.geometry.length < 2 ||
    segment.geometry.some((point) => !hasValidCoordinate(point)) ||
    !hasSameCoordinate(segment.geometry[0], from) ||
    !hasSameCoordinate(segment.geometry.at(-1), to) ||
    !Number.isFinite(segment.distanceMeters) ||
    segment.distanceMeters < 0
  ) {
    return null
  }
  return {
    id: segment.id,
    insertAfterId: segment.insertAfterId,
    mode: segment.mode,
    geometry: segment.geometry.map(({ lat, lon }) => ({ lat, lon })),
    distanceMeters: segment.distanceMeters,
  }
}

function hasSameCoordinate(left, right) {
  return left?.lat === right?.lat && left?.lon === right?.lon
}

function hasSameGeometry(left, right) {
  return left.length === right.length && left.every((point, index) => hasSameCoordinate(point, right[index]))
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return null
  }
  const normalized = {}
  for (const field of numericSampleFields) {
    normalized[field] = Number.isFinite(sample[field]) ? sample[field] : null
  }
  normalized.time = typeof sample.time === 'string' && sample.time.length <= 100 ? sample.time : null
  normalized.segmentStart = Boolean(sample.segmentStart)
  if (sample.repairAccepted) {
    normalized.repairAccepted = true
  }
  return normalized
}

function readOptionalIndex(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value < maximum ? value : null
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, projectDatabaseVersion)
    let blocked = false

    request.onupgradeneeded = () => {
      upgradeProjectDatabase(request.result, request.transaction)
    }
    request.onsuccess = () => {
      if (blocked) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('The local draft database is blocked by another app window.'))
    }
  })
}

function runRequest(database, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    let request
    try {
      request = createRequest(transaction.objectStore(storeName))
    }
    catch (error) {
      database.close()
      reject(error)
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(request.result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? request.error ?? new Error('The local draft transaction failed.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? request.error ?? new Error('The local draft transaction was cancelled.'))
    }
  })
}
