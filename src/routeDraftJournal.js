import {
  compareRouteDraftSnapshotVersions,
  normalizeRouteDraft,
  normalizeRouteDraftSnapshotMetadata,
} from './routeDraftStore.js'

export const routeDraftJournalKey = 'fixyourtrack:create-route-draft:emergency-v1'
export const maximumRouteDraftJournalBytes = 750_000

const journalSchemaVersion = 2

export class RouteDraftJournalError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined)
    this.name = 'RouteDraftJournalError'
    this.code = code
  }
}

export function saveRouteDraftJournal(plan, session = {}, {
  storage = getDefaultStorage(),
  metadata = null,
} = {}) {
  if (!storage?.setItem) {
    throw new RouteDraftJournalError('JOURNAL_UNAVAILABLE', 'Emergency route recovery is unavailable.')
  }
  const normalizedMetadata = normalizeRouteDraftSnapshotMetadata(metadata)
  if (!normalizedMetadata) {
    throw new RouteDraftJournalError('INVALID_JOURNAL_DRAFT', 'The route snapshot metadata is invalid.')
  }
  const normalized = normalizeRouteDraft({
    id: 'active-route',
    schemaVersion: 3,
    ...normalizedMetadata,
    plan,
    session,
    preview: null,
  })
  if (!normalized) {
    throw new RouteDraftJournalError('INVALID_JOURNAL_DRAFT', 'The route could not be journaled safely.')
  }
  const record = {
    journalSchemaVersion,
    ...normalizedMetadata,
    plan: normalized.plan,
    session: normalized.session,
  }
  const serialized = JSON.stringify(record)
  if (getUtf8ByteLength(serialized) > maximumRouteDraftJournalBytes) {
    throw new RouteDraftJournalError(
      'JOURNAL_TOO_LARGE',
      'The route is too large for emergency browser recovery.',
    )
  }
  try {
    storage.setItem(routeDraftJournalKey, serialized)
  }
  catch (error) {
    throw new RouteDraftJournalError(
      'JOURNAL_WRITE_FAILED',
      'Emergency route recovery could not be updated.',
      error,
    )
  }
  return normalized
}

export function loadRouteDraftJournal({ storage = getDefaultStorage() } = {}) {
  if (!storage?.getItem) {
    return null
  }
  let serialized
  try {
    serialized = storage.getItem(routeDraftJournalKey)
  }
  catch (error) {
    throw new RouteDraftJournalError(
      'JOURNAL_READ_FAILED',
      'Emergency route recovery could not be read.',
      error,
    )
  }
  if (serialized === null) {
    return null
  }
  let record
  try {
    record = JSON.parse(serialized)
  }
  catch (error) {
    throw new RouteDraftJournalError('CORRUPT_JOURNAL', 'Emergency route recovery is damaged.', error)
  }
  if (Number.isInteger(record?.journalSchemaVersion) && record.journalSchemaVersion > journalSchemaVersion) {
    throw new RouteDraftJournalError(
      'UNSUPPORTED_JOURNAL',
      'Emergency route recovery was created by a newer FixYourTrack version.',
    )
  }
  if (!Number.isInteger(record?.journalSchemaVersion) || record.journalSchemaVersion < 1) {
    throw new RouteDraftJournalError('CORRUPT_JOURNAL', 'Emergency route recovery is damaged.')
  }
  const hasCausalVersion = record.journalSchemaVersion >= 2
  const normalized = normalizeRouteDraft({
    id: 'active-route',
    schemaVersion: hasCausalVersion ? 3 : 2,
    savedAt: record.savedAt,
    snapshotVersion: hasCausalVersion ? record.snapshotVersion : undefined,
    plan: record.plan,
    session: record.session,
    preview: null,
  })
  if (!normalized) {
    throw new RouteDraftJournalError('CORRUPT_JOURNAL', 'Emergency route recovery is damaged.')
  }
  return normalized
}

export function selectNewestRouteDraft(storedDraft, journalDraft) {
  if (!journalDraft) return { draft: storedDraft, source: storedDraft ? 'database' : 'empty' }
  if (!storedDraft) return { draft: journalDraft, source: 'journal' }
  if (routeDraftCoreFingerprint(storedDraft) === routeDraftCoreFingerprint(journalDraft)) {
    return { draft: storedDraft, source: 'database' }
  }
  const causalComparison = compareRouteDraftSnapshotVersions(
    journalDraft.snapshotVersion,
    storedDraft.snapshotVersion,
  )
  if (causalComparison !== null) {
    return causalComparison > 0
      ? { draft: journalDraft, source: 'journal' }
      : { draft: storedDraft, source: 'database' }
  }
  return Date.parse(journalDraft.savedAt) > Date.parse(storedDraft.savedAt)
    ? { draft: journalDraft, source: 'journal' }
    : { draft: storedDraft, source: 'database' }
}

export async function inspectRouteDraftRecovery({
  loadPersistedDraft,
  loadJournalDraft = () => loadRouteDraftJournal(),
} = {}) {
  if (typeof loadPersistedDraft !== 'function' || typeof loadJournalDraft !== 'function') {
    throw new TypeError('Route draft recovery loaders are required.')
  }

  const journalDraft = loadJournalDraft()
  try {
    const persistedDraft = await loadPersistedDraft()
    const recovery = selectNewestRouteDraft(persistedDraft, journalDraft)
    return {
      ...recovery,
      persistedDraft,
      journalDraft,
      error: null,
    }
  }
  catch (error) {
    return {
      draft: null,
      source: 'blocked',
      persistedDraft: null,
      journalDraft,
      error,
    }
  }
}

export function clearRouteDraftJournalIfMatching(snapshot, { storage = getDefaultStorage() } = {}) {
  if (!storage?.removeItem) return false
  let journal
  try {
    journal = loadRouteDraftJournal({ storage })
  }
  catch {
    return false
  }
  if (!journal || routeDraftCoreFingerprint(journal) !== routeDraftCoreFingerprint(snapshot)) {
    return false
  }
  const causalComparison = compareRouteDraftSnapshotVersions(
    journal.snapshotVersion,
    snapshot?.snapshotVersion,
  )
  if (causalComparison !== null && causalComparison !== 0) {
    return false
  }
  try {
    storage.removeItem(routeDraftJournalKey)
    return true
  }
  catch {
    return false
  }
}

export function clearRouteDraftJournal({ storage = getDefaultStorage() } = {}) {
  try {
    storage?.removeItem?.(routeDraftJournalKey)
    return true
  }
  catch {
    return false
  }
}

export function routeDraftCoreFingerprint(draft) {
  return JSON.stringify([draft?.plan ?? null, draft?.session ?? null])
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage ?? null
  }
  catch {
    return null
  }
}

function getUtf8ByteLength(value) {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).byteLength
    : value.length * 2
}
