import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProjectStoreError,
  assertProjectCanBeSaved,
  cloneProjectDocument,
  createProjectQuarantineId,
  createProjectStore,
  deriveProjectSummary,
  isProjectStoreError,
  isUnsupportedProjectSchema,
  normalizeProjectBundle,
  normalizeProjectDocument,
  normalizeProjectMetadata,
  normalizeProjectName,
  normalizeProjectOrigin,
  normalizeProjectSummary,
  projectDatabaseName,
  projectDatabaseVersion,
  projectSchemaVersion,
  projectStoreNames,
  serializeProjectDocument,
  serializeProjectMetadata,
  upgradeProjectDatabase,
} from '../src/projectStore.js'

const createdAt = '2026-07-14T10:00:00.000Z'
const updatedAt = '2026-07-14T10:05:00.000Z'

function createMetadata(overrides = {}) {
  return {
    id: 'project-route-1',
    schemaVersion: projectSchemaVersion,
    revision: 3,
    name: 'Morning route',
    projectType: 'route',
    origin: 'create-route',
    summary: { pointCount: 3, distanceMeters: 4125.5 },
    createdAt,
    updatedAt,
    archivedAt: null,
    ...overrides,
  }
}

function createDocument(overrides = {}) {
  return {
    projectId: 'project-route-1',
    schemaVersion: projectSchemaVersion,
    revision: 3,
    projectType: 'route',
    document: {
      plan: {
        controls: [
          { id: 'start', lat: 55.75, lon: 37.61 },
          { id: 'via', lat: 55.76, lon: 37.62 },
          { id: 'finish', lat: 55.77, lon: 37.63 },
        ],
      },
      preview: { distanceMeters: 4125.5 },
    },
    ...overrides,
  }
}

test('declares the additive version-two project database stores', () => {
  assert.equal(projectDatabaseName, 'fixyourtrack')
  assert.equal(projectDatabaseVersion, 2)
  assert.equal(projectSchemaVersion, 1)
  assert.deepEqual(projectStoreNames, {
    projects: 'projects',
    documents: 'project-documents',
    appMeta: 'app-meta',
    quarantine: 'project-quarantine',
    repairDrafts: 'repair-drafts',
  })
})

test('database upgrade is additive and idempotently ensures every shared store and index', () => {
  const stores = new Map()
  const createStore = (name) => {
    const indexes = new Set()
    const store = {
      indexNames: { contains: (indexName) => indexes.has(indexName) },
      createIndex: (indexName) => indexes.add(indexName),
      indexes,
    }
    stores.set(name, store)
    return store
  }
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => createStore(name),
  }
  const transaction = { objectStore: (name) => stores.get(name) }
  upgradeProjectDatabase(database, transaction)
  upgradeProjectDatabase(database, transaction)
  assert.deepEqual([...stores.keys()].sort(), Object.values(projectStoreNames).sort())
  assert.deepEqual([...stores.get(projectStoreNames.projects).indexes].sort(), [
    'by-project-type',
    'by-updated-at',
  ])
  assert.deepEqual([...stores.get(projectStoreNames.quarantine).indexes].sort(), [
    'by-detected-at',
    'by-project-id',
  ])
})

test('quarantine identity is stable for repeated reads of the same broken record', () => {
  const broken = {
    projectId: 'project-route-1',
    reason: 'METADATA_DOCUMENT_MISMATCH',
    metadata: { revision: 7, schemaVersion: 1 },
    document: { revision: 6, schemaVersion: 1 },
  }
  assert.equal(createProjectQuarantineId(broken), createProjectQuarantineId({ ...broken }))
  assert.notEqual(
    createProjectQuarantineId(broken),
    createProjectQuarantineId({ ...broken, document: { revision: 5, schemaVersion: 1 } }),
  )
})

test('normalizes bounded display names and validated origin slugs', () => {
  assert.equal(normalizeProjectName('  Morning\u0000 route  '), 'Morning route')
  assert.equal(normalizeProjectName('x'.repeat(150)).length, 120)
  assert.equal(normalizeProjectName(' \u0001 '), '')

  assert.equal(normalizeProjectOrigin('  Create-Route  '), 'create-route')
  assert.equal(normalizeProjectOrigin('create route'), '')
  assert.equal(normalizeProjectOrigin('../import'), '')
})

test('serializes metadata into canonical project schema v1', () => {
  const metadata = serializeProjectMetadata({
    ...createMetadata(),
    name: '  Morning route  ',
    origin: 'CREATE-ROUTE',
    createdAt: new Date(createdAt),
  })

  assert.deepEqual(metadata, createMetadata())
  assert.notEqual(metadata.summary, createMetadata().summary)
  assert.equal(normalizeProjectMetadata({ ...metadata, revision: 0 }), null)
  assert.equal(normalizeProjectMetadata({ ...metadata, projectType: 'unknown' }), null)
  assert.equal(normalizeProjectMetadata({ ...metadata, updatedAt: '2020-01-01' }), null)
  assert.equal(normalizeProjectMetadata({ ...metadata, createdAt: null }), null)
})

test('normalizes only compact non-negative project summaries', () => {
  assert.deepEqual(
    normalizeProjectSummary({ pointCount: 0, distanceMeters: null, ignored: 'value' }),
    { pointCount: 0, distanceMeters: null },
  )
  assert.equal(normalizeProjectSummary({ pointCount: -1, distanceMeters: 10 }), null)
  assert.equal(normalizeProjectSummary({ pointCount: 2, distanceMeters: Number.NaN }), null)
})

test('derives route and repair summaries from supported document shapes', () => {
  assert.deepEqual(deriveProjectSummary('route', createDocument().document), {
    pointCount: 3,
    distanceMeters: 4125.5,
  })
  assert.deepEqual(deriveProjectSummary('repair', {
    workingTrack: { samples: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
    metrics: { distanceMeters: 250 },
  }), {
    pointCount: 2,
    distanceMeters: 250,
  })
  assert.deepEqual(deriveProjectSummary('route', { controls: [] }), {
    pointCount: 0,
    distanceMeters: null,
  })
})

test('serializes and clones JSON-compatible project documents', () => {
  const input = createDocument()
  const stored = serializeProjectDocument(input)

  assert.deepEqual(stored, input)
  assert.notEqual(stored.document, input.document)
  assert.notEqual(stored.document.plan, input.document.plan)
  input.document.plan.controls[0].lat = 0
  assert.equal(stored.document.plan.controls[0].lat, 55.75)
  assert.deepEqual(normalizeProjectDocument(stored), stored)
})

test('rejects non-JSON data without partially normalizing it', () => {
  const circular = {}
  circular.self = circular

  assert.throws(
    () => cloneProjectDocument(circular),
    (error) => isProjectStoreError(error, 'INVALID_PROJECT_DOCUMENT'),
  )
  assert.throws(
    () => cloneProjectDocument({ elevation: Number.POSITIVE_INFINITY }),
    (error) => isProjectStoreError(error, 'INVALID_PROJECT_DOCUMENT'),
  )
  assert.throws(
    () => cloneProjectDocument({ recordedAt: new Date() }),
    (error) => isProjectStoreError(error, 'INVALID_PROJECT_DOCUMENT'),
  )
  assert.equal(normalizeProjectDocument({ ...createDocument(), document: circular }), null)
})

test('normalizes a bundle only when metadata and document identity match', () => {
  const metadata = createMetadata()
  const document = createDocument()

  assert.deepEqual(normalizeProjectBundle(metadata, document), {
    metadata,
    document: document.document,
  })
  assert.equal(normalizeProjectBundle(metadata, { ...document, revision: 4 }), null)
  assert.equal(normalizeProjectBundle(metadata, { ...document, projectType: 'repair' }), null)
  assert.equal(normalizeProjectBundle(metadata, { ...document, projectId: 'project-route-2' }), null)
})

test('identifies future project records without treating them as current data', () => {
  const futureMetadata = createMetadata({ schemaVersion: projectSchemaVersion + 1 })
  assert.equal(isUnsupportedProjectSchema(futureMetadata), true)
  assert.equal(isUnsupportedProjectSchema(createMetadata()), false)
  assert.equal(normalizeProjectMetadata(futureMetadata), null)
  assert.equal(normalizeProjectDocument({
    ...createDocument(),
    schemaVersion: projectSchemaVersion + 1,
  }), null)
})

test('provides typed validation and storage-unavailable failures', async () => {
  const store = createProjectStore({ indexedDB: {} })

  await assert.rejects(
    store.createProject({
      projectType: 'route',
      name: ' ',
      origin: 'create-route',
      document: {},
    }),
    (error) => error instanceof ProjectStoreError && error.code === 'INVALID_PROJECT_NAME',
  )
  await assert.rejects(
    store.saveProject('project-route-1', {}, {}),
    (error) => isProjectStoreError(error, 'INVALID_EXPECTED_REVISION'),
  )
  await assert.rejects(
    store.listProjects({ projectType: 'route' }),
    (error) => isProjectStoreError(error, 'INDEXEDDB_UNAVAILABLE'),
  )
})

test('rejects writes to archived projects until they are restored', () => {
  assert.doesNotThrow(() => assertProjectCanBeSaved(createMetadata()))
  assert.throws(
    () => assertProjectCanBeSaved(createMetadata({ archivedAt: updatedAt })),
    (error) => isProjectStoreError(error, 'PROJECT_ARCHIVED'),
  )
})
