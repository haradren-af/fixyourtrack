import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearRouteDraftJournalIfMatching,
  inspectRouteDraftRecovery,
  loadRouteDraftJournal,
  maximumRouteDraftJournalBytes,
  routeDraftJournalKey,
  RouteDraftJournalError,
  saveRouteDraftJournal,
  selectNewestRouteDraft,
} from '../src/routeDraftJournal.js'

const writerA = 'writer_A_00000001'
const writerB = 'writer_B_00000001'

function metadata(generation, savedAt = '2026-07-14T10:00:00.000Z', writerId = writerA) {
  return {
    savedAt,
    snapshotVersion: { generation, writerId },
  }
}

class MemoryStorage {
  values = new Map()

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

const plan = {
  kind: 'route',
  schemaVersion: 1,
  name: 'Emergency route',
  profile: 'cycling',
  controls: [{ id: 'start', lat: 55, lon: 37 }],
  legModes: {},
}

test('journals and restores a bounded normalized route without preview telemetry', () => {
  const storage = new MemoryStorage()
  const saved = saveRouteDraftJournal(plan, { interactionMode: 'place-finish' }, {
    storage,
    metadata: metadata(1),
  })
  assert.equal(loadRouteDraftJournal({ storage }).plan.name, 'Emergency route')
  assert.equal(saved.preview, null)
  assert.deepEqual(saved.snapshotVersion, metadata(1).snapshotVersion)
  assert.ok(storage.getItem(routeDraftJournalKey).length < maximumRouteDraftJournalBytes)
})

test('uses timestamps only to order legacy emergency journals and IndexedDB state', () => {
  const stored = {
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: { ...plan, name: 'Stored' },
    session: {},
  }
  const newer = {
    savedAt: '2026-07-14T10:00:01.000Z',
    plan: { ...plan, name: 'Journal' },
    session: {},
  }
  assert.equal(selectNewestRouteDraft(stored, newer).source, 'journal')
  assert.equal(selectNewestRouteDraft(newer, stored).source, 'database')
  assert.equal(selectNewestRouteDraft(stored, {
    ...stored,
    savedAt: '2026-07-14T10:00:02.000Z',
  }).source, 'database')
})

test('causal generation beats write time when an older IndexedDB save finishes after a newer journal', () => {
  const olderPayloadWrittenLater = {
    ...metadata(41, '2026-07-14T10:00:02.000Z'),
    plan: { ...plan, name: 'A: older payload' },
    session: {},
  }
  const newerPayloadJournaledEarlier = {
    ...metadata(42, '2026-07-14T10:00:01.000Z'),
    plan: { ...plan, name: 'B: latest payload' },
    session: {},
  }

  const recovery = selectNewestRouteDraft(olderPayloadWrittenLater, newerPayloadJournaledEarlier)
  assert.equal(recovery.source, 'journal')
  assert.equal(recovery.draft.plan.name, 'B: latest payload')
})

test('causal versions remain unique and deterministic when writer generations collide', () => {
  const left = {
    ...metadata(7, '2026-07-14T10:00:02.000Z', writerA),
    plan: { ...plan, name: 'Writer A' },
    session: {},
  }
  const right = {
    ...metadata(7, '2026-07-14T10:00:01.000Z', writerB),
    plan: { ...plan, name: 'Writer B' },
    session: {},
  }

  assert.equal(selectNewestRouteDraft(left, right).source, 'journal')
  assert.equal(selectNewestRouteDraft(right, left).source, 'database')
})

test('clears a journal only after the same plan and session are physically saved', () => {
  const storage = new MemoryStorage()
  const journal = saveRouteDraftJournal(plan, {}, { storage, metadata: metadata(1) })
  assert.equal(clearRouteDraftJournalIfMatching({ ...journal, plan: { ...plan, name: 'Other' } }, { storage }), false)
  assert.equal(clearRouteDraftJournalIfMatching({
    ...journal,
    snapshotVersion: metadata(2).snapshotVersion,
  }, { storage }), false)
  assert.equal(clearRouteDraftJournalIfMatching(journal, { storage }), true)
  assert.equal(storage.getItem(routeDraftJournalKey), null)
})

test('loads a schema-v1 journal as a legacy record without causal metadata', () => {
  const storage = new MemoryStorage()
  storage.setItem(routeDraftJournalKey, JSON.stringify({
    journalSchemaVersion: 1,
    savedAt: '2026-07-14T10:00:00.000Z',
    plan,
    session: {},
  }))

  const legacy = loadRouteDraftJournal({ storage })
  assert.equal(legacy.plan.name, 'Emergency route')
  assert.equal(legacy.snapshotVersion, null)
})

test('blocks corrupt and future emergency journals instead of discarding them', () => {
  const storage = new MemoryStorage()
  storage.setItem(routeDraftJournalKey, '{broken')
  assert.throws(() => loadRouteDraftJournal({ storage }), RouteDraftJournalError)
  storage.setItem(routeDraftJournalKey, JSON.stringify({ journalSchemaVersion: 3 }))
  assert.throws(
    () => loadRouteDraftJournal({ storage }),
    (error) => error instanceof RouteDraftJournalError && error.code === 'UNSUPPORTED_JOURNAL',
  )
})

test('inspects the emergency journal before IndexedDB and retains it when database loading fails', async () => {
  const calls = []
  const databaseError = new Error('IndexedDB read failed')
  const journalDraft = {
    savedAt: '2026-07-14T10:00:00.000Z',
    plan,
    session: {},
  }
  const recovery = await inspectRouteDraftRecovery({
    loadJournalDraft: () => {
      calls.push('journal')
      return journalDraft
    },
    loadPersistedDraft: async () => {
      calls.push('database')
      throw databaseError
    },
  })

  assert.deepEqual(calls, ['journal', 'database'])
  assert.equal(recovery.source, 'blocked')
  assert.equal(recovery.journalDraft, journalDraft)
  assert.equal(recovery.error, databaseError)
})

test('returns the selected recovery candidates after both stores load safely', async () => {
  const storedDraft = {
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: { ...plan, name: 'Stored' },
    session: {},
  }
  const journalDraft = {
    savedAt: '2026-07-14T10:00:01.000Z',
    plan: { ...plan, name: 'Journal' },
    session: {},
  }
  const recovery = await inspectRouteDraftRecovery({
    loadJournalDraft: () => journalDraft,
    loadPersistedDraft: async () => storedDraft,
  })

  assert.equal(recovery.source, 'journal')
  assert.equal(recovery.draft, journalDraft)
  assert.equal(recovery.persistedDraft, storedDraft)
  assert.equal(recovery.error, null)
})
