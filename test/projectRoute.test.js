import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRouteProjectDraftAssociation,
  normalizeRouteProjectDocument,
  reconcileRouteProjectRevision,
  routeProjectDocumentsEqual,
  UnsupportedRouteProjectError,
} from '../src/projectRoute.js'

test('normalizes a current route project and treats metadata name as authoritative', () => {
  const plan = normalizeRouteProjectDocument({
    kind: 'route',
    schemaVersion: 1,
    name: 'Old name',
    controls: [{ id: 'start', lat: 55, lon: 37 }],
  }, 'Library name')
  assert.equal(plan.name, 'Library name')
  assert.equal(plan.controls.length, 1)
})

test('never opens a future route document as a downgraded empty route', () => {
  assert.throws(
    () => normalizeRouteProjectDocument({ kind: 'route', schemaVersion: 2 }),
    UnsupportedRouteProjectError,
  )
})

test('rejects a non-route document in the route project library', () => {
  assert.throws(
    () => normalizeRouteProjectDocument({ kind: 'repair', schemaVersion: 1 }),
    /not a route/i,
  )
})

test('rejects route projects whose controls would be dropped or truncated', () => {
  const invalidDocuments = [
    { kind: 'route', schemaVersion: 1, controls: null },
    {
      kind: 'route',
      schemaVersion: 1,
      controls: [
        { id: 'duplicate', lat: 55, lon: 37 },
        { id: 'duplicate', lat: 55.1, lon: 37.1 },
      ],
    },
    {
      kind: 'route',
      schemaVersion: 1,
      controls: [{ id: 'outside-world', lat: 91, lon: 37 }],
    },
    {
      kind: 'route',
      schemaVersion: 1,
      controls: Array.from({ length: 2001 }, (_, index) => ({
        id: `point-${index}`,
        lat: 55,
        lon: 37,
      })),
    },
  ]

  for (const document of invalidDocuments) {
    assert.throws(() => normalizeRouteProjectDocument(document), /invalid/i)
  }
})

test('a conflict keeps the local base revision in the route draft across reload', () => {
  const localDocument = normalizeRouteProjectDocument({ name: 'Route', controls: [] })
  const storedDocument = normalizeRouteProjectDocument({
    name: 'Route',
    profile: 'walking',
    controls: [],
  })
  const project = reconcileRouteProjectRevision(
    { id: 'route-1', revision: 9, name: 'Route', archivedAt: null },
    7,
    localDocument,
    storedDocument,
  )
  assert.equal(project.conflict, true)
  assert.equal(project.revision, 9)
  assert.deepEqual(getRouteProjectDraftAssociation(project), {
    projectId: 'route-1',
    projectRevision: 7,
  })
})

test('a matching project revision persists normally', () => {
  const document = normalizeRouteProjectDocument({ name: 'Route', controls: [] })
  const project = reconcileRouteProjectRevision(
    { id: 'route-1', revision: 7, name: 'Route', archivedAt: null },
    7,
    document,
    document,
  )
  assert.equal(project.conflict, undefined)
  assert.deepEqual(getRouteProjectDraftAssociation(project), {
    projectId: 'route-1',
    projectRevision: 7,
  })
})

test('a newer stored revision is accepted when its full document already matches the draft', () => {
  const local = normalizeRouteProjectDocument({
    kind: 'route',
    schemaVersion: 1,
    name: 'Saved route',
    profile: 'cycling',
    controls: [{ id: 'start', lat: 55, lon: 37 }],
  })
  const project = reconcileRouteProjectRevision(
    { id: 'route-1', revision: 8, name: 'Saved route', archivedAt: null },
    7,
    local,
    local,
  )
  assert.equal(project.conflict, undefined)
  assert.equal(project.revision, 8)
})

test('an archived project remains conflicted even when its document matches the draft', () => {
  const local = normalizeRouteProjectDocument({
    kind: 'route',
    schemaVersion: 1,
    name: 'Archived route',
    controls: [{ id: 'start', lat: 55, lon: 37 }],
  })
  const project = reconcileRouteProjectRevision(
    {
      id: 'route-1',
      revision: 8,
      name: 'Archived route',
      archivedAt: '2026-07-14T10:00:00.000Z',
    },
    7,
    local,
    local,
  )
  assert.equal(project.conflict, true)
  assert.equal(project.baseRevision, 7)
})

test('an archived project remains conflicted even when its revision matches the draft', () => {
  const local = normalizeRouteProjectDocument({ name: 'Archived route', controls: [] })
  const project = reconcileRouteProjectRevision({
    id: 'route-1',
    revision: 7,
    name: 'Archived route',
    archivedAt: '2026-07-14T10:00:00.000Z',
  }, 7, local, local)
  assert.equal(project.conflict, true)
})

test('a matching envelope revision cannot overwrite an unsupported or wrong-kind route body', () => {
  const metadata = {
    id: 'route-1',
    revision: 7,
    name: 'Saved route',
    archivedAt: null,
  }
  const future = reconcileRouteProjectRevision(
    metadata,
    7,
    normalizeRouteProjectDocument({ name: 'Saved route', controls: [] }),
    { kind: 'route', schemaVersion: 2, name: 'Saved route' },
  )
  assert.equal(future.conflict, true)
  assert.equal(future.invalidDocument, true)
  assert.equal(future.documentErrorCode, 'UNSUPPORTED_ROUTE_DOCUMENT')

  const wrongKind = reconcileRouteProjectRevision(
    metadata,
    7,
    normalizeRouteProjectDocument({ name: 'Saved route', controls: [] }),
    { kind: 'repair', schemaVersion: 1, name: 'Saved route' },
  )
  assert.equal(wrongKind.conflict, true)
  assert.equal(wrongKind.invalidDocument, true)
})

test('document reconciliation compares the complete normalized route', () => {
  const local = normalizeRouteProjectDocument({
    kind: 'route',
    schemaVersion: 1,
    name: 'Local route',
    controls: [{ id: 'start', lat: 55, lon: 37 }],
  })
  assert.equal(routeProjectDocumentsEqual(local, local, 'Local route'), true)
  assert.equal(routeProjectDocumentsEqual(local, { ...local, profile: 'walking' }, 'Local route'), false)
  assert.equal(routeProjectDocumentsEqual(local, { ...local, name: 'Remote route' }, 'Remote route'), false)
})
