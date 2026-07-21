import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareRouteDraftSnapshotVersions,
  createRouteDraftSnapshotMetadata,
  createRouteDraftSnapshotVersionClock,
  createRouteDraftQuarantineId,
  normalizeRouteDraft,
  normalizeRoutePreview,
} from '../src/routeDraftStore.js'
import { normalizeRoutePlan, routePlanFingerprint } from '../src/routePlan.js'

test('normalizes a partial create-route draft without requiring a finish', () => {
  const draft = normalizeRouteDraft({
    id: 'active-route',
    schemaVersion: 1,
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: {
      kind: 'route',
      name: 'Draft',
      profile: 'walking',
      controls: [{ id: 'start', lat: 55.75, lon: 37.61 }],
      legModes: {},
    },
    session: { interactionMode: 'place-finish' },
  })

  assert.equal(draft.plan.controls.length, 1)
  assert.deepEqual(draft.plan.legModes, {})
  assert.equal(draft.session.interactionMode, 'place-finish')
})

test('drops invalid session IDs and unsafe interaction states', () => {
  const draft = normalizeRouteDraft({
    schemaVersion: 1,
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: {
      controls: [
        { id: 'start', lat: 55.75, lon: 37.61 },
        { id: 'finish', lat: 55.76, lon: 37.62 },
      ],
    },
    session: {
      interactionMode: 'move-control',
      activeControlId: 'missing',
      traceAnchorId: 'missing',
    },
  })

  assert.equal(draft.session.interactionMode, 'inspect')
  assert.equal(draft.session.activeControlId, null)
  assert.equal(draft.session.traceAnchorId, null)
})

test('rejects future route-draft schemas without modifying them', () => {
  assert.equal(normalizeRouteDraft({ schemaVersion: 4, savedAt: new Date().toISOString() }), null)
})

test('requires causal metadata for current drafts while preserving legacy schemas', () => {
  const base = {
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: { kind: 'route', schemaVersion: 1, controls: [], legModes: {} },
    session: {},
    preview: null,
  }
  const legacy = normalizeRouteDraft({ ...base, schemaVersion: 2 })
  assert.equal(legacy.schemaVersion, 2)
  assert.equal(legacy.snapshotVersion, null)
  assert.deepEqual(normalizeRouteDraft(legacy), legacy)
  assert.equal(normalizeRouteDraft({ ...base, schemaVersion: 3 }), null)
  assert.deepEqual(normalizeRouteDraft({
    ...base,
    schemaVersion: 3,
    snapshotVersion: { generation: 9, writerId: 'writer_A_00000001' },
  }).snapshotVersion, {
    generation: 9,
    writerId: 'writer_A_00000001',
  })
})

test('advances a new writer beyond every observed generation after reload', () => {
  const clock = createRouteDraftSnapshotVersionClock({ writerId: 'writer_B_00000001' })
  clock.observe(
    { generation: 12, writerId: 'writer_A_00000001' },
    { generation: 14, writerId: 'writer_C_00000001' },
    null,
  )
  const created = createRouteDraftSnapshotMetadata(clock, {
    now: () => new Date('2026-07-14T10:00:00.000Z'),
  })

  assert.deepEqual(created, {
    savedAt: '2026-07-14T10:00:00.000Z',
    snapshotVersion: { generation: 15, writerId: 'writer_B_00000001' },
  })
  assert.equal(compareRouteDraftSnapshotVersions(
    created.snapshotVersion,
    { generation: 14, writerId: 'writer_C_00000001' },
  ), 1)
})

test('rejects a missing or lossy persisted plan while preserving a valid empty route', () => {
  const base = {
    schemaVersion: 2,
    savedAt: '2026-07-14T10:00:00.000Z',
    session: {},
    preview: null,
  }
  assert.equal(normalizeRouteDraft({ ...base, plan: null }), null)
  assert.equal(normalizeRouteDraft(base), null)
  assert.equal(normalizeRouteDraft({
    ...base,
    plan: { kind: 'route', schemaVersion: 1, controls: [], legModes: {} },
  }).plan.controls.length, 0)
  assert.equal(normalizeRouteDraft({
    ...base,
    plan: {
      controls: [
        { id: 'duplicate', lat: 55, lon: 37 },
        { id: 'duplicate', lat: 55.1, lon: 37.1 },
      ],
    },
  }), null)
  assert.equal(normalizeRouteDraft({
    ...base,
    plan: { controls: [{ id: 'invalid', lat: 95, lon: 37 }] },
  }), null)
})

test('restores only a current preview whose fingerprint and endpoints match the plan', () => {
  const plan = normalizeRoutePlan({
    controls: [
      { id: 'start', lat: 55.75, lon: 37.61 },
      { id: 'finish', lat: 55.76, lon: 37.62 },
    ],
    legModes: { start: 'direct' },
  })
  const preview = {
    status: 'ready',
    fingerprint: routePlanFingerprint(plan),
    segments: [{
      mode: 'direct',
      geometry: plan.controls,
      distanceMeters: 100,
    }],
  }

  assert.equal(normalizeRoutePreview(preview, plan)?.geometry.length, 2)
  assert.equal(normalizeRoutePreview({ ...preview, fingerprint: 'stale' }, plan), null)
  assert.equal(normalizeRoutePreview({
    ...preview,
    segments: [{ ...preview.segments[0], distanceMeters: -1 }],
  }, plan), null)
})

test('keeps a valid named-project association only when id and revision are paired', () => {
  const base = {
    schemaVersion: 2,
    savedAt: '2026-07-14T10:00:00.000Z',
    plan: { controls: [] },
    preview: null,
  }
  assert.deepEqual(normalizeRouteDraft({
    ...base,
    session: { projectId: 'route-1', projectRevision: 4 },
  }).session, {
    interactionMode: 'place-start',
    activeControlId: null,
    traceAnchorId: null,
    projectId: 'route-1',
    projectRevision: 4,
  })
  assert.equal(normalizeRouteDraft({
    ...base,
    session: { projectId: 'route-1' },
  }).session.projectId, null)
})

test('uses a stable quarantine identity for an unreadable route draft', () => {
  const draft = { schemaVersion: 99, savedAt: '2026-07-14T10:00:00.000Z' }
  assert.equal(createRouteDraftQuarantineId(draft), createRouteDraftQuarantineId({ ...draft }))
  assert.notEqual(
    createRouteDraftQuarantineId(draft),
    createRouteDraftQuarantineId({ ...draft, savedAt: '2026-07-14T10:01:00.000Z' }),
  )
  assert.notEqual(
    createRouteDraftQuarantineId(draft),
    createRouteDraftQuarantineId(draft, 'UNREADABLE_ROUTE_DRAFT', 'emergency-journal'),
  )
})
