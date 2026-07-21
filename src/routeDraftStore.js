import { getLegMode } from './routeLegs.js'
import {
  projectDatabaseName as databaseName,
  projectDatabaseVersion,
  projectSchemaVersion,
  projectStoreNames,
  upgradeProjectDatabase,
} from './projectStore.js'
import {
  normalizePersistedRoutePlan,
  normalizeRoutePlan,
  routePlanFingerprint,
} from './routePlan.js'
import { isValidCoordinate } from './trackCore.js'

const storeName = 'repair-drafts'
const activeRouteDraftId = 'active-route'
const currentSchemaVersion = 3
const maximumStoredPreviewPoints = 100_000
const maximumWriterIdLength = 128

export class UnsupportedRouteDraftError extends Error {
  constructor(schemaVersion) {
    super('This route draft was created by a newer version of FixYourTrack.')
    this.name = 'UnsupportedRouteDraftError'
    this.code = 'UNSUPPORTED_ROUTE_DRAFT'
    this.schemaVersion = schemaVersion
  }
}

export class CorruptRouteDraftError extends Error {
  constructor() {
    super('The local route draft could not be read safely.')
    this.name = 'CorruptRouteDraftError'
    this.code = 'CORRUPT_ROUTE_DRAFT'
  }
}

export async function loadRouteDraft() {
  const database = await openDatabase()
  const storedDraft = await runRequest(database, 'readonly', (store) => store.get(activeRouteDraftId))
  if (storedDraft === undefined) {
    return null
  }
  if (Number.isInteger(storedDraft?.schemaVersion) && storedDraft.schemaVersion > currentSchemaVersion) {
    throw new UnsupportedRouteDraftError(storedDraft.schemaVersion)
  }
  const normalized = normalizeRouteDraft(storedDraft)
  if (!normalized) {
    throw new CorruptRouteDraftError()
  }
  return normalized
}

export async function saveRouteDraft(plan, session = {}, preview = null, metadata = null) {
  const normalizedMetadata = normalizeRouteDraftSnapshotMetadata(metadata)
  if (!normalizedMetadata) {
    throw new TypeError('Route draft snapshot metadata is required.')
  }
  const normalizedPlan = normalizeRoutePlan(plan)
  const database = await openDatabase()
  await runRequest(database, 'readwrite', (store) => store.put({
    id: activeRouteDraftId,
    schemaVersion: currentSchemaVersion,
    ...normalizedMetadata,
    plan: normalizedPlan,
    session: normalizeRouteSession(session, normalizedPlan),
    preview: normalizeRoutePreview(preview, normalizedPlan),
  }))
  return normalizedMetadata.savedAt
}

export async function deleteRouteDraft() {
  const database = await openDatabase()
  await runRequest(database, 'readwrite', (store) => store.delete(activeRouteDraftId))
}

export async function quarantineRouteDraft(
  reason = 'UNREADABLE_ROUTE_DRAFT',
  { journalDraft = null } = {},
) {
  const normalizedJournalDraft = journalDraft === null ? null : normalizeRouteDraft(journalDraft)
  if (journalDraft !== null && !normalizedJournalDraft) {
    throw new CorruptRouteDraftError()
  }
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([
      storeName,
      projectStoreNames.quarantine,
    ], 'readwrite')
    const drafts = transaction.objectStore(storeName)
    const quarantine = transaction.objectStore(projectStoreNames.quarantine)
    const readRequest = drafts.get(activeRouteDraftId)
    let preserved = false

    readRequest.onsuccess = () => {
      const storedDraft = readRequest.result
      if (storedDraft !== undefined) {
        preserveRouteDraftInQuarantine(quarantine, storedDraft, reason, activeRouteDraftId)
        drafts.delete(activeRouteDraftId)
        preserved = true
      }
      if (normalizedJournalDraft) {
        preserveRouteDraftInQuarantine(
          quarantine,
          normalizedJournalDraft,
          `${reason}_EMERGENCY_JOURNAL`,
          'emergency-journal',
        )
        preserved = true
      }
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(preserved)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('The route draft could not be preserved.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('The route draft preservation was cancelled.'))
    }
  })
}

export function createRouteDraftQuarantineId(
  draft,
  reason = 'UNREADABLE_ROUTE_DRAFT',
  sourceId = activeRouteDraftId,
) {
  const schema = Number.isInteger(draft?.schemaVersion) ? draft.schemaVersion : 'unknown'
  const savedAt = typeof draft?.savedAt === 'string' ? draft.savedAt : 'unknown'
  return `quarantine-route-draft-${encodeURIComponent(sourceId)}-${encodeURIComponent(String(reason))}-${schema}-${encodeURIComponent(savedAt)}`
}

export function normalizeRouteDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return null
  }
  const schemaVersion = draft.schemaVersion
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > currentSchemaVersion) {
    return null
  }
  const savedAt = new Date(draft.savedAt)
  if (!Number.isFinite(savedAt.getTime())) {
    return null
  }
  const snapshotVersion = schemaVersion >= 3
    ? normalizeRouteDraftSnapshotVersion(draft.snapshotVersion)
    : null
  if (schemaVersion >= 3 && !snapshotVersion) {
    return null
  }
  const plan = normalizePersistedRoutePlan(draft.plan)
  if (!plan) {
    return null
  }
  return {
    id: activeRouteDraftId,
    schemaVersion: snapshotVersion ? currentSchemaVersion : schemaVersion,
    savedAt: savedAt.toISOString(),
    snapshotVersion,
    plan,
    session: normalizeRouteSession(draft.session, plan),
    preview: schemaVersion >= 2 ? normalizeRoutePreview(draft.preview, plan) : null,
  }
}

export function normalizeRouteDraftSnapshotVersion(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    typeof value.writerId !== 'string' ||
    value.writerId.length < 16 ||
    value.writerId.length > maximumWriterIdLength ||
    !/^[0-9A-Za-z_-]+$/.test(value.writerId)
  ) {
    return null
  }
  return {
    generation: value.generation,
    writerId: value.writerId,
  }
}

export function normalizeRouteDraftSnapshotMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const savedAt = new Date(value.savedAt)
  const snapshotVersion = normalizeRouteDraftSnapshotVersion(value.snapshotVersion)
  if (!Number.isFinite(savedAt.getTime()) || !snapshotVersion) {
    return null
  }
  return {
    savedAt: savedAt.toISOString(),
    snapshotVersion,
  }
}

export function compareRouteDraftSnapshotVersions(left, right) {
  const normalizedLeft = normalizeRouteDraftSnapshotVersion(left)
  const normalizedRight = normalizeRouteDraftSnapshotVersion(right)
  if (!normalizedLeft || !normalizedRight) {
    return null
  }
  if (normalizedLeft.generation !== normalizedRight.generation) {
    return normalizedLeft.generation < normalizedRight.generation ? -1 : 1
  }
  if (normalizedLeft.writerId === normalizedRight.writerId) {
    return 0
  }
  return normalizedLeft.writerId < normalizedRight.writerId ? -1 : 1
}

export function createRouteDraftSnapshotVersionClock({
  writerId = createRouteDraftWriterId(),
  initialGeneration = 0,
} = {}) {
  if (!normalizeRouteDraftSnapshotVersion({ generation: 1, writerId })) {
    throw new TypeError('A valid route draft writer ID is required.')
  }
  if (!Number.isSafeInteger(initialGeneration) || initialGeneration < 0) {
    throw new TypeError('The initial route draft generation is invalid.')
  }
  let generation = initialGeneration

  return {
    observe(...versions) {
      for (const version of versions) {
        const normalized = normalizeRouteDraftSnapshotVersion(version)
        if (normalized) {
          generation = Math.max(generation, normalized.generation)
        }
      }
      return generation
    },
    next() {
      if (generation >= Number.MAX_SAFE_INTEGER) {
        throw new Error('The route draft generation limit was reached.')
      }
      generation += 1
      return { generation, writerId }
    },
  }
}

export function createRouteDraftSnapshotMetadata(clock, { now = () => new Date() } = {}) {
  if (!clock || typeof clock.next !== 'function') {
    throw new TypeError('A route draft snapshot clock is required.')
  }
  const savedAt = now()
  if (!(savedAt instanceof Date) || !Number.isFinite(savedAt.getTime())) {
    throw new TypeError('The route draft snapshot clock returned an invalid date.')
  }
  return {
    savedAt: savedAt.toISOString(),
    snapshotVersion: clock.next(),
  }
}

function preserveRouteDraftInQuarantine(quarantine, draft, reason, sourceId) {
  const detectedAt = new Date().toISOString()
  quarantine.put({
    id: createRouteDraftQuarantineId(draft, reason, sourceId),
    schemaVersion: projectSchemaVersion,
    projectId: null,
    reason,
    detectedAt,
    metadata: {
      kind: 'route-draft',
      sourceId,
      sourceSchemaVersion: Number.isInteger(draft?.schemaVersion)
        ? draft.schemaVersion
        : null,
    },
    document: draft,
  })
}

function normalizeRouteSession(session, plan) {
  const defaultInteractionMode = plan.controls.length === 0
    ? 'place-start'
    : plan.controls.length === 1
      ? 'place-finish'
      : 'inspect'
  const allowedModes = new Set([
    'inspect',
    'place-start',
    'place-finish',
    'add-waypoint',
    'extend-route',
    'trace-direct',
    'move-control',
  ])
  const requestedMode = allowedModes.has(session?.interactionMode)
    ? session.interactionMode
    : defaultInteractionMode
  const activeControlId = typeof session?.activeControlId === 'string' &&
    plan.controls.some(({ id }) => id === session.activeControlId)
    ? session.activeControlId
    : null
  const traceAnchorId = typeof session?.traceAnchorId === 'string' &&
    plan.controls.some(({ id }) => id === session.traceAnchorId)
    ? session.traceAnchorId
    : null

  let interactionMode = requestedMode
  if (requestedMode === 'place-start' && plan.controls.length) {
    interactionMode = defaultInteractionMode
  }
  if (requestedMode === 'place-finish' && plan.controls.length !== 1) {
    interactionMode = defaultInteractionMode
  }
  if (requestedMode === 'move-control' && !activeControlId) {
    interactionMode = 'inspect'
  }
  if (requestedMode === 'trace-direct' && !traceAnchorId) {
    interactionMode = 'inspect'
  }

  const projectId = normalizeProjectId(session?.projectId)
  const projectRevision = Number.isInteger(session?.projectRevision) && session.projectRevision >= 1
    ? session.projectRevision
    : null

  return {
    interactionMode,
    activeControlId,
    traceAnchorId,
    projectId: projectId && projectRevision ? projectId : null,
    projectRevision: projectId && projectRevision ? projectRevision : null,
  }
}

export function normalizeRoutePreview(preview, plan) {
  if (
    !preview ||
    preview.status !== 'ready' ||
    preview.fingerprint !== routePlanFingerprint(plan) ||
    !Array.isArray(preview.segments) ||
    preview.segments.length !== plan.controls.length - 1
  ) {
    return null
  }

  const segments = []
  let geometry = []
  let distanceMeters = 0
  let pointCount = 0
  for (let index = 0; index < preview.segments.length; index += 1) {
    const candidate = preview.segments[index]
    const from = plan.controls[index]
    const to = plan.controls[index + 1]
    if (
      !candidate ||
      candidate.mode !== getLegMode(plan.legModes, from.id) ||
      !Array.isArray(candidate.geometry) ||
      candidate.geometry.length < 2 ||
      !candidate.geometry.every(isValidCoordinate) ||
      !sameCoordinate(candidate.geometry[0], from) ||
      !sameCoordinate(candidate.geometry.at(-1), to) ||
      !Number.isFinite(candidate.distanceMeters) ||
      candidate.distanceMeters < 0
    ) {
      return null
    }
    pointCount += candidate.geometry.length
    if (pointCount > maximumStoredPreviewPoints) {
      return null
    }
    const segmentGeometry = candidate.geometry.map(({ lat, lon }) => ({ lat, lon }))
    segments.push({
      id: `${from.id}-${to.id}`,
      insertAfterId: from.id,
      mode: candidate.mode,
      geometry: segmentGeometry,
      distanceMeters: candidate.distanceMeters,
    })
    geometry = geometry.length
      ? [...geometry, ...segmentGeometry.slice(1)]
      : [...segmentGeometry]
    distanceMeters += candidate.distanceMeters
  }

  return {
    status: 'ready',
    fingerprint: routePlanFingerprint(plan),
    error: '',
    failedLegId: null,
    failedToControlId: null,
    segments,
    geometry,
    distanceMeters,
  }
}

function normalizeProjectId(value) {
  return typeof value === 'string' &&
    value.length <= 160 &&
    value.trim() === value &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 31 || codePoint === 127
    })
    ? value
    : null
}

function sameCoordinate(left, right) {
  return left.lat === right.lat && left.lon === right.lon
}

function createRouteDraftWriterId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (typeof uuid === 'string') {
      return uuid
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      globalThis.crypto.getRandomValues(bytes)
      return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
    }
  }
  catch {
    // A collision-resistant process-local fallback is sufficient when Web Crypto is unavailable.
  }

  const random = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `writer_${Date.now().toString(36)}_${random.padEnd(20, '0').slice(0, 20)}`
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
    request.onerror = () => reject(request.error ?? new Error('The route draft database could not be opened.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('The local route draft is blocked by another app window.'))
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
      reject(transaction.error ?? request.error ?? new Error('The route draft transaction failed.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? request.error ?? new Error('The route draft transaction was cancelled.'))
    }
  })
}
