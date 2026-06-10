const databaseName = 'fixyourtrack'
const storeName = 'repair-drafts'
const activeDraftId = 'active'
const currentSchemaVersion = 2

export async function loadRepairDraft() {
  try {
    const database = await openDatabase()
    const storedDraft = await runRequest(database, 'readonly', (store) => store.get(activeDraftId))
    const draft = normalizeRepairDraft(storedDraft)
    if (storedDraft && !draft) {
      await deleteRepairDraft()
    }
    return draft
  }
  catch {
    return null
  }
}

export async function saveRepairDraft(sourceTrack, workingTrack, repairSession = null) {
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
  if (!isSerializedTrack(draft.sourceTrack) || !isSerializedTrack(draft.workingTrack)) {
    return null
  }

  const savedAt = new Date(draft.savedAt)
  if (!Number.isFinite(savedAt.getTime())) {
    return null
  }

  return {
    ...draft,
    schemaVersion: currentSchemaVersion,
    savedAt: savedAt.toISOString(),
    repairSession: schemaVersion >= 2 ? normalizeRepairSession(draft.repairSession) : null,
  }
}

function serializeTrack(track) {
  return {
    name: track.name,
    format: track.format,
    samples: track.samples,
  }
}

function isSerializedTrack(track) {
  return track &&
    typeof track === 'object' &&
    Array.isArray(track.samples) &&
    track.samples.length >= 2 &&
    track.samples.filter(hasValidCoordinate).length >= 2
}

function hasValidCoordinate(sample) {
  return Number.isFinite(sample?.lat) &&
    Number.isFinite(sample?.lon) &&
    sample.lat >= -90 &&
    sample.lat <= 90 &&
    sample.lon >= -180 &&
    sample.lon <= 180
}

function normalizeRepairSession(session) {
  if (!session || !['before', 'after', 'middle'].includes(session.rebuildDirection)) {
    return null
  }

  return {
    selectedCutPointIndex: readOptionalIndex(session.selectedCutPointIndex),
    tailAnchorPointIndex: readOptionalIndex(session.tailAnchorPointIndex),
    removedSegmentSamples: Array.isArray(session.removedSegmentSamples) ? session.removedSegmentSamples : [],
    rebuildDirection: session.rebuildDirection,
    middleRepairRange: normalizeMiddleRange(session.middleRepairRange),
    endpoint: hasValidCoordinate(session.endpoint) ? session.endpoint : null,
    viaPoints: Array.isArray(session.viaPoints) ? session.viaPoints.filter(hasValidCoordinate) : [],
    activeWaypointId: typeof session.activeWaypointId === 'string' ? session.activeWaypointId : null,
    mapMode: ['inspect', 'pick-endpoint', 'add-offgrid-waypoint'].includes(session.mapMode)
      ? session.mapMode
      : 'inspect',
    routePreview: normalizeRoutePreview(session.routePreview),
  }
}

function normalizeMiddleRange(range) {
  if (
    !range ||
    !Number.isInteger(range.startSampleIndex) ||
    !Number.isInteger(range.endSampleIndex) ||
    range.startSampleIndex < 0 ||
    range.endSampleIndex < range.startSampleIndex
  ) {
    return null
  }
  return {
    startSampleIndex: range.startSampleIndex,
    endSampleIndex: range.endSampleIndex,
  }
}

function normalizeRoutePreview(preview) {
  const geometry = Array.isArray(preview?.geometry) ? preview.geometry.filter(hasValidCoordinate) : []
  const segments = Array.isArray(preview?.segments) ? preview.segments : []
  return {
    status: preview?.status === 'ready' && geometry.length >= 2 ? 'ready' : 'idle',
    error: '',
    segments,
    geometry,
    distanceMeters: Number.isFinite(preview?.distanceMeters) && preview.distanceMeters >= 0
      ? preview.distanceMeters
      : 0,
  }
}

function readOptionalIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function runRequest(database, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = createRequest(transaction.objectStore(storeName))

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error)
  })
}
