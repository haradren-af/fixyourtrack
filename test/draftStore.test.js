import assert from 'node:assert/strict'
import test from 'node:test'
import { translate } from '../src/i18n.js'
import {
  assertRepairSessionCanBeSaved,
  assertTrackCanBeSaved,
  classifyRepairDraft,
  createLatestRepairDraftSaveQueue,
  isReplaceableRepairDraftStatus,
  isUnsupportedRepairDraft,
  normalizeRepairDraft,
  shouldProtectRepairDraft,
} from '../src/draftStore.js'

const track = {
  name: 'ride',
  format: 'gpx',
  samples: [
    { lat: 55, lon: 37 },
    { lat: 55.01, lon: 37.01 },
  ],
}

test('rejects an oversized repair draft instead of truncating it', () => {
  const samples = []
  samples.length = 1_000_001
  assert.throws(
    () => assertTrackCanBeSaved({ samples }),
    /too many samples/i,
  )
})

test('rejects an oversized active repair instead of partially restoring it', () => {
  const viaPoints = []
  viaPoints.length = 2001
  assert.throws(
    () => assertRepairSessionCanBeSaved({ viaPoints }),
    /too large/i,
  )
})

test('migrates legacy drafts without an active repair session', () => {
  const draft = normalizeRepairDraft({
    id: 'active',
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
  })

  assert.equal(draft.schemaVersion, 3)
  assert.equal(draft.repairSession, null)
})

test('restores a complete active repair while dropping only transient preview state', () => {
  const draft = normalizeRepairDraft({
    id: 'active',
    schemaVersion: 2,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: {
      rebuildDirection: 'middle',
      middleRepairRange: { startSampleIndex: 0, endSampleIndex: 1 },
      selectedCutPointIndex: null,
      tailAnchorPointIndex: 0,
      removedSegmentSamples: [],
      endpoint: { lat: 55.01, lon: 37.01 },
      viaPoints: [{ id: 'one', lat: 55.005, lon: 37.005, manualPoint: false }],
      legModes: { anchor: 'direct', one: 'routed' },
      activeWaypointId: 'one',
      mapMode: 'inspect',
      routePreview: { status: 'loading', geometry: [], segments: [], distanceMeters: -1 },
    },
  })

  assert.equal(draft.repairSession.selectedCutPointIndex, null)
  assert.equal(draft.repairSession.tailAnchorPointIndex, 0)
  assert.deepEqual(draft.repairSession.viaPoints.map(({ id }) => id), ['one'])
  assert.deepEqual(draft.repairSession.legModes, { anchor: 'direct', one: 'routed' })
  assert.equal(draft.repairSession.mapMode, 'inspect')
  assert.equal(draft.repairSession.routePreview.status, 'idle')
  assert.equal(draft.repairSession.routePreview.distanceMeters, 0)
})

test('migrates a schema v2 active repair that predates per-leg modes', () => {
  const draft = normalizeRepairDraft({
    id: 'active',
    schemaVersion: 2,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: {
      rebuildDirection: 'after',
      selectedCutPointIndex: 1,
      tailAnchorPointIndex: 1,
      removedSegmentSamples: [],
      endpoint: null,
      viaPoints: [],
      activeWaypointId: null,
      mapMode: 'pick-endpoint',
      routePreview: { status: 'idle' },
    },
  })

  assert.deepEqual(draft.repairSession.legModes, {})
  assert.equal(draft.repairSession.mapMode, 'pick-endpoint')
})

test('rejects unsupported and malformed drafts', () => {
  assert.equal(normalizeRepairDraft({ schemaVersion: 99 }), null)
  assert.equal(isUnsupportedRepairDraft({ schemaVersion: 99 }), true)
  assert.equal(isUnsupportedRepairDraft({ schemaVersion: 3 }), false)
  assert.equal(normalizeRepairDraft({
    schemaVersion: 2,
    savedAt: 'invalid',
    sourceTrack: track,
    workingTrack: track,
  }), null)
  assert.equal(normalizeRepairDraft({
    schemaVersion: 2,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: { ...track, samples: [{ lat: 55, lon: 37 }] },
    workingTrack: track,
  }), null)
})

test('classifies every stored draft outcome before autosave can write', () => {
  const ready = classifyRepairDraft({
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
  })

  assert.equal(classifyRepairDraft(undefined).status, 'empty')
  assert.equal(ready.status, 'ready')
  assert.equal(ready.draft.sourceTrack.name, 'ride')
  assert.equal(classifyRepairDraft({ schemaVersion: 3 }).status, 'corrupt')
  assert.equal(classifyRepairDraft({ schemaVersion: 99 }).status, 'unsupported')

  assert.equal(shouldProtectRepairDraft('empty'), false)
  for (const status of ['loading', 'ready', 'corrupt', 'unsupported', 'unavailable']) {
    assert.equal(shouldProtectRepairDraft(status), true, `${status} must remain write-protected`)
  }
  for (const status of ['ready', 'corrupt', 'unsupported']) {
    assert.equal(isReplaceableRepairDraftStatus(status), true, `${status} can be explicitly replaced`)
  }
  for (const status of ['loading', 'empty', 'unavailable']) {
    assert.equal(isReplaceableRepairDraftStatus(status), false, `${status} cannot be treated as a stored replacement`)
  }
})

test('explains corrupt, future, and unavailable repair drafts distinctly in each language', () => {
  for (const language of ['en', 'ru']) {
    const messages = [
      translate(language, 'draftLoadCorrupt'),
      translate(language, 'draftLoadUnsupported'),
      translate(language, 'draftLoadUnavailable'),
    ]
    assert.equal(new Set(messages).size, 3)
    assert(messages.every((message) => typeof message === 'string' && message.length > 20))
  }
})

test('coalesces overlapping repair saves and reports only the latest snapshot', async () => {
  const operations = []
  const saved = []
  const activity = []
  const queue = createLatestRepairDraftSaveQueue({
    save: (snapshot) => new Promise((resolve, reject) => {
      operations.push({ reject, resolve, snapshot })
    }),
    onSaved: (savedAt, snapshot) => saved.push({ savedAt, snapshot }),
  })
  const unsubscribe = queue.subscribeActivity((active) => activity.push(active))

  const first = { id: 'first' }
  const skipped = { id: 'skipped' }
  const latest = { id: 'latest' }
  queue.enqueue(first)
  queue.enqueue(skipped)
  queue.enqueue(latest)
  assert.deepEqual(operations.map(({ snapshot }) => snapshot.id), ['first'])

  operations[0].resolve('first-time')
  await Promise.resolve()
  assert.deepEqual(operations.map(({ snapshot }) => snapshot.id), ['first', 'latest'])
  operations[1].resolve('latest-time')
  await queue.whenIdle()
  unsubscribe()

  assert.deepEqual(saved, [{ savedAt: 'latest-time', snapshot: latest }])
  assert.deepEqual(activity, [false, true, false])
})

test('an explicit replacement barrier cannot be overwritten by an older in-flight save', async () => {
  const operations = []
  const callbacks = []
  let persisted = null
  const queue = createLatestRepairDraftSaveQueue({
    save: (snapshot) => new Promise((resolve) => {
      operations.push(() => {
        persisted = snapshot.id
        resolve(`${snapshot.id}-time`)
      })
    }),
    onSaved: (_savedAt, snapshot) => callbacks.push(snapshot.id),
  })

  queue.enqueue({ id: 'old autosave' })
  queue.invalidate()
  const replacement = (async () => {
    await queue.whenIdle()
    persisted = 'explicit replacement'
  })()
  operations[0]()
  await replacement

  assert.equal(persisted, 'explicit replacement')
  assert.deepEqual(callbacks, [])
})

test('rejects an invalid middle repair session instead of restoring a ready preview without borders', () => {
  const draft = normalizeRepairDraft({
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: {
      rebuildDirection: 'middle',
      middleRepairRange: { startSampleIndex: 0, endSampleIndex: 20 },
      routePreview: {
        status: 'ready',
        geometry: track.samples,
        segments: [{
          id: 'anchor-endpoint',
          insertAfterId: 'anchor',
          geometry: track.samples,
          distanceMeters: 100,
        }],
        distanceMeters: 100,
      },
    },
  })

  assert.equal(draft, null)
})

test('rejects lossy persisted track and repair-session normalization', () => {
  const baseDraft = {
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
  }
  assert.equal(normalizeRepairDraft({
    ...baseDraft,
    sourceTrack: { ...track, injected: true },
  }), null)
  assert.equal(normalizeRepairDraft({
    ...baseDraft,
    sourceTrack: {
      ...track,
      samples: [track.samples[0], 'broken sample', track.samples[1]],
    },
  }), null)
  assert.equal(normalizeRepairDraft({
    ...baseDraft,
    repairSession: {
      rebuildDirection: 'after',
      selectedCutPointIndex: 20,
      tailAnchorPointIndex: 0,
      removedSegmentSamples: [],
      viaPoints: [],
      legModes: {},
      mapMode: 'inspect',
      routePreview: { status: 'idle' },
    },
  }), null)
})

test('preserves valid coordinate-less samples without accepting malformed samples', () => {
  const draft = normalizeRepairDraft({
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: {
      ...track,
      samples: [
        track.samples[0],
        { lat: null, lon: null, heartRate: 140, time: null, segmentStart: false },
        track.samples[1],
      ],
    },
    workingTrack: track,
  })

  assert.equal(draft.sourceTrack.samples.length, 3)
  assert.equal(draft.sourceTrack.samples[1].heartRate, 140)
  assert.equal(draft.sourceTrack.samples[1].lat, null)
})

test('rejects a ready preview that does not match its selected repair controls', () => {
  const readySession = {
    rebuildDirection: 'middle',
    middleRepairRange: { startSampleIndex: 0, endSampleIndex: 1 },
    selectedCutPointIndex: null,
    tailAnchorPointIndex: 0,
    removedSegmentSamples: [],
    endpoint: { lat: 55.01, lon: 37.01 },
    viaPoints: [],
    legModes: {},
    activeWaypointId: null,
    mapMode: 'inspect',
    routePreview: {
      status: 'ready',
      geometry: track.samples,
      segments: [{
        id: 'anchor-endpoint',
        insertAfterId: 'anchor',
        mode: 'routed',
        geometry: track.samples,
        distanceMeters: 100,
      }],
      distanceMeters: 100,
    },
  }
  const validDraft = normalizeRepairDraft({
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: readySession,
  })
  assert.equal(validDraft.repairSession.routePreview.status, 'ready')

  assert.equal(normalizeRepairDraft({
    schemaVersion: 3,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: {
      ...readySession,
      routePreview: {
        ...readySession.routePreview,
        segments: [{
          ...readySession.routePreview.segments[0],
          insertAfterId: 'endpoint',
        }],
      },
    },
  }), null)
})
