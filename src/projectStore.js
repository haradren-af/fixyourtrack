export const projectDatabaseName = 'fixyourtrack'
export const projectDatabaseVersion = 2
export const projectSchemaVersion = 1

export const projectStoreNames = Object.freeze({
  projects: 'projects',
  documents: 'project-documents',
  appMeta: 'app-meta',
  quarantine: 'project-quarantine',
  repairDrafts: 'repair-drafts',
})

export const projectTypes = Object.freeze(['route', 'repair'])

export function upgradeProjectDatabase(database, transaction) {
  ensureObjectStore(database, transaction, projectStoreNames.repairDrafts, { keyPath: 'id' })
  const projects = ensureObjectStore(database, transaction, projectStoreNames.projects, { keyPath: 'id' })
  ensureIndex(projects, 'by-updated-at', 'updatedAt')
  ensureIndex(projects, 'by-project-type', 'projectType')
  ensureObjectStore(database, transaction, projectStoreNames.documents, { keyPath: 'projectId' })
  ensureObjectStore(database, transaction, projectStoreNames.appMeta, { keyPath: 'key' })
  const quarantine = ensureObjectStore(database, transaction, projectStoreNames.quarantine, { keyPath: 'id' })
  ensureIndex(quarantine, 'by-project-id', 'projectId')
  ensureIndex(quarantine, 'by-detected-at', 'detectedAt')
}

const maximumProjectNameLength = 120
const maximumOriginLength = 48
const maximumProjectIdLength = 160
const maximumDocumentDepth = 100
const maximumDocumentNodes = 2_000_000

export class ProjectStoreError extends Error {
  constructor(code, message, { cause = null, projectId = null } = {}) {
    super(message)
    this.name = 'ProjectStoreError'
    this.code = code
    this.projectId = projectId
    if (cause) {
      this.cause = cause
    }
  }
}

export function isProjectStoreError(error, code = null) {
  return error instanceof ProjectStoreError && (code === null || error.code === code)
}

export function assertProjectCanBeSaved(metadata) {
  if (metadata?.archivedAt !== null) {
    throw new ProjectStoreError(
      'PROJECT_ARCHIVED',
      'Restore the archived project before saving changes to it.',
      { projectId: metadata?.id ?? null },
    )
  }
}

export function normalizeProjectName(value) {
  if (typeof value !== 'string') {
    return ''
  }
  const cleaned = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint > 31 && codePoint !== 127
    })
    .join('')
    .trim()
  return [...cleaned].slice(0, maximumProjectNameLength).join('')
}

export function normalizeProjectOrigin(value) {
  if (typeof value !== 'string') {
    return ''
  }
  const normalized = value.trim().toLowerCase()
  if (
    !normalized ||
    normalized.length > maximumOriginLength ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
  ) {
    return ''
  }
  return normalized
}

export function normalizeProjectSummary(value) {
  if (!isPlainObject(value)) {
    return null
  }
  const pointCount = normalizeCount(value.pointCount)
  const distanceMeters = normalizeOptionalMeasurement(value.distanceMeters)
  if (pointCount === null || distanceMeters === undefined) {
    return null
  }
  return { pointCount, distanceMeters }
}

export function deriveProjectSummary(projectType, document) {
  assertProjectType(projectType)
  const normalizedDocument = cloneProjectDocument(document)
  const pointCount = projectType === 'route'
    ? findRoutePointCount(normalizedDocument)
    : findRepairPointCount(normalizedDocument)
  const distanceMeters = findDistanceMeters(normalizedDocument)
  return { pointCount, distanceMeters }
}

export function normalizeProjectMetadata(record) {
  if (!isPlainObject(record) || record.schemaVersion !== projectSchemaVersion) {
    return null
  }

  const id = normalizeProjectId(record.id)
  const name = normalizeProjectName(record.name)
  const projectType = normalizeProjectType(record.projectType)
  const origin = normalizeProjectOrigin(record.origin)
  const revision = normalizeRevision(record.revision)
  const createdAt = normalizeTimestamp(record.createdAt)
  const updatedAt = normalizeTimestamp(record.updatedAt)
  const archivedAt = record.archivedAt === null ? null : normalizeTimestamp(record.archivedAt)
  const summary = normalizeProjectSummary(record.summary)

  if (
    !id ||
    !name ||
    !projectType ||
    !origin ||
    revision === null ||
    !createdAt ||
    !updatedAt ||
    archivedAt === '' ||
    !summary
  ) {
    return null
  }

  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    return null
  }
  if (archivedAt && new Date(archivedAt).getTime() < new Date(createdAt).getTime()) {
    return null
  }

  return {
    id,
    schemaVersion: projectSchemaVersion,
    revision,
    name,
    projectType,
    origin,
    summary,
    createdAt,
    updatedAt,
    archivedAt,
  }
}

export function serializeProjectMetadata({
  id,
  revision,
  name,
  projectType,
  origin,
  summary,
  createdAt,
  updatedAt,
  archivedAt = null,
}) {
  const normalized = normalizeProjectMetadata({
    id,
    schemaVersion: projectSchemaVersion,
    revision,
    name,
    projectType,
    origin,
    summary,
    createdAt,
    updatedAt,
    archivedAt,
  })
  if (!normalized) {
    throw new ProjectStoreError('INVALID_PROJECT_METADATA', 'Project metadata is invalid.')
  }
  return normalized
}

export function normalizeProjectDocument(record) {
  if (!isPlainObject(record) || record.schemaVersion !== projectSchemaVersion) {
    return null
  }

  const projectId = normalizeProjectId(record.projectId)
  const projectType = normalizeProjectType(record.projectType)
  const revision = normalizeRevision(record.revision)
  if (!projectId || !projectType || revision === null) {
    return null
  }

  try {
    return {
      projectId,
      schemaVersion: projectSchemaVersion,
      revision,
      projectType,
      document: cloneProjectDocument(record.document),
    }
  }
  catch (error) {
    if (isProjectStoreError(error, 'INVALID_PROJECT_DOCUMENT')) {
      return null
    }
    throw error
  }
}

export function serializeProjectDocument({ projectId, revision, projectType, document }) {
  const normalized = normalizeProjectDocument({
    projectId,
    schemaVersion: projectSchemaVersion,
    revision,
    projectType,
    document,
  })
  if (!normalized) {
    throw new ProjectStoreError(
      'INVALID_PROJECT_DOCUMENT',
      'The project document must be a JSON-compatible object.',
      { projectId: normalizeProjectId(projectId) || null },
    )
  }
  return normalized
}

export function normalizeProjectBundle(metadataRecord, documentRecord) {
  const metadata = normalizeProjectMetadata(metadataRecord)
  const storedDocument = normalizeProjectDocument(documentRecord)
  if (!metadata || !storedDocument || !projectRecordsMatch(metadata, storedDocument)) {
    return null
  }
  return { metadata, document: storedDocument.document }
}

export function isUnsupportedProjectSchema(record) {
  return Number.isInteger(record?.schemaVersion) && record.schemaVersion > projectSchemaVersion
}

export function cloneProjectDocument(document) {
  if (!isPlainObject(document)) {
    throw new ProjectStoreError(
      'INVALID_PROJECT_DOCUMENT',
      'The project document must be a JSON-compatible object.',
    )
  }

  const state = { ancestors: new WeakSet(), nodeCount: 0 }
  return cloneJsonValue(document, state, 0)
}

export function createProjectStore({
  indexedDB = null,
  now = () => new Date(),
  createId = createProjectId,
} = {}) {
  if (typeof now !== 'function' || typeof createId !== 'function') {
    throw new ProjectStoreError('INVALID_CONFIGURATION', 'The project store configuration is invalid.')
  }

  const run = (storeNames, mode, executor) => runTransaction({
    indexedDB,
    storeNames,
    mode,
    executor,
  })

  async function createProject({ projectType, name, origin, document }) {
    assertProjectType(projectType)
    const normalizedName = assertProjectName(name)
    const normalizedOrigin = assertProjectOrigin(origin)
    const normalizedDocument = cloneProjectDocument(document)
    const id = assertGeneratedProjectId(createId())
    const timestamp = readNow(now)
    const revision = 1
    const metadata = serializeProjectMetadata({
      id,
      revision,
      name: normalizedName,
      projectType,
      origin: normalizedOrigin,
      summary: deriveProjectSummary(projectType, normalizedDocument),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const storedDocument = serializeProjectDocument({
      projectId: id,
      revision,
      projectType,
      document: normalizedDocument,
    })

    const outcome = await run([
      projectStoreNames.projects,
      projectStoreNames.documents,
      projectStoreNames.appMeta,
    ], 'readwrite', (context) => {
      const projectRequest = context.store(projectStoreNames.projects).get(id)
      const activeRequest = context.store(projectStoreNames.appMeta).get(lastActiveKey(projectType))
      let projectReady = false
      let activeReady = false

      projectRequest.onsuccess = () => {
        projectReady = true
        finish()
      }
      activeRequest.onsuccess = () => {
        activeReady = true
        finish()
      }

      function finish() {
        if (!projectReady || !activeReady) {
          return
        }
        if (projectRequest.result !== undefined) {
          context.setResult(failedOutcome(new ProjectStoreError(
            'PROJECT_ALREADY_EXISTS',
            'A project with this ID already exists.',
            { projectId: id },
          )))
          return
        }

        context.store(projectStoreNames.projects).add(metadata)
        context.store(projectStoreNames.documents).add(storedDocument)
        if (!isUnsupportedProjectSchema(activeRequest.result)) {
          context.store(projectStoreNames.appMeta).put(createLastActiveRecord(projectType, id, timestamp))
        }
        context.setResult(successfulOutcome({ metadata, document: storedDocument.document }))
      }
    })
    return unwrapOutcome(outcome)
  }

  async function listProjects({ projectType = null, includeArchived = false } = {}) {
    if (projectType !== null) {
      assertProjectType(projectType)
    }
    if (typeof includeArchived !== 'boolean') {
      throw new ProjectStoreError('INVALID_ARGUMENT', 'includeArchived must be a boolean.')
    }

    const timestamp = readNow(now)
    const projects = await run([
      projectStoreNames.projects,
      projectStoreNames.quarantine,
    ], 'readwrite', (context) => {
      const request = context.store(projectStoreNames.projects).getAll()
      request.onsuccess = () => {
        const listedProjects = []
        for (const rawMetadata of request.result) {
          const metadata = normalizeProjectMetadata(rawMetadata)
          if (metadata) {
            if (
              (projectType === null || metadata.projectType === projectType) &&
              (includeArchived || metadata.archivedAt === null)
            ) {
              listedProjects.push(metadata)
            }
            continue
          }

          const compatibilityMetadata = describeUnreadableMetadata(rawMetadata)
          if (
            compatibilityMetadata &&
            (projectType === null || compatibilityMetadata.projectType === projectType) &&
            (includeArchived || compatibilityMetadata.archivedAt === null)
          ) {
            listedProjects.push(compatibilityMetadata)
          }
          if (!isUnsupportedProjectSchema(rawMetadata)) {
            putQuarantineRecord(context, {
              projectId: normalizeProjectId(rawMetadata?.id) || null,
              reason: 'CORRUPT_PROJECT_METADATA',
              detectedAt: timestamp,
              metadata: rawMetadata,
              document: null,
            })
          }
        }
        context.setResult(sortProjectMetadata(listedProjects))
      }
    })
    return projects
  }

  async function loadProject(projectId) {
    const id = assertProjectId(projectId)
    const timestamp = readNow(now)
    const outcome = await run([
      projectStoreNames.projects,
      projectStoreNames.documents,
      projectStoreNames.quarantine,
    ], 'readwrite', (context) => {
      readProjectPair(context, id, (rawMetadata, rawDocument) => {
        const inspection = inspectProjectPair(id, rawMetadata, rawDocument)
        if (inspection.error) {
          preserveBrokenPair(context, inspection, rawMetadata, rawDocument, timestamp)
          context.setResult(failedOutcome(inspection.error))
          return
        }
        context.setResult(successfulOutcome(inspection.project))
      })
    })
    return unwrapOutcome(outcome)
  }

  async function saveProject(projectId, document, { expectedRevision, name = null } = {}) {
    const normalizedDocument = cloneProjectDocument(document)
    const normalizedName = name === null ? null : assertProjectName(name)
    return mutateProject(projectId, expectedRevision, (project, timestamp) => {
      assertProjectCanBeSaved(project.metadata)
      const revision = project.metadata.revision + 1
      const metadata = serializeProjectMetadata({
        ...project.metadata,
        revision,
        name: normalizedName ?? project.metadata.name,
        summary: deriveProjectSummary(project.metadata.projectType, normalizedDocument),
        updatedAt: timestamp,
      })
      const storedDocument = serializeProjectDocument({
        projectId: metadata.id,
        revision,
        projectType: metadata.projectType,
        document: normalizedDocument,
      })
      return { metadata, storedDocument }
    })
  }

  async function renameProject(projectId, name, { expectedRevision } = {}) {
    const normalizedName = assertProjectName(name)
    return mutateProject(projectId, expectedRevision, (project, timestamp) => {
      assertProjectCanBeSaved(project.metadata)
      return reviseProject(project, timestamp, { name: normalizedName })
    })
  }

  async function archiveProject(projectId, { expectedRevision } = {}) {
    return mutateProject(projectId, expectedRevision, (project, timestamp) => {
      if (project.metadata.archivedAt !== null) {
        throw new ProjectStoreError(
          'PROJECT_ALREADY_ARCHIVED',
          'The project is already archived.',
          { projectId: project.metadata.id },
        )
      }
      return reviseProject(project, timestamp, { archivedAt: timestamp })
    })
  }

  async function restoreProject(projectId, { expectedRevision } = {}) {
    return mutateProject(projectId, expectedRevision, (project, timestamp) => {
      if (project.metadata.archivedAt === null) {
        throw new ProjectStoreError(
          'PROJECT_NOT_ARCHIVED',
          'The project is not archived.',
          { projectId: project.metadata.id },
        )
      }
      return reviseProject(project, timestamp, { archivedAt: null })
    })
  }

  async function deleteProject(projectId, { expectedRevision } = {}) {
    const id = assertProjectId(projectId)
    const revision = assertExpectedRevision(expectedRevision, id)
    const timestamp = readNow(now)
    const outcome = await run([
      projectStoreNames.projects,
      projectStoreNames.documents,
      projectStoreNames.appMeta,
      projectStoreNames.quarantine,
    ], 'readwrite', (context) => {
      readProjectPair(context, id, (rawMetadata, rawDocument) => {
        const inspection = inspectProjectPair(id, rawMetadata, rawDocument)
        if (inspection.error) {
          preserveBrokenPair(context, inspection, rawMetadata, rawDocument, timestamp)
          context.setResult(failedOutcome(inspection.error))
          return
        }
        if (inspection.project.metadata.revision !== revision) {
          context.setResult(failedOutcome(createRevisionConflict(id, revision, inspection.project.metadata.revision)))
          return
        }

        context.store(projectStoreNames.projects).delete(id)
        context.store(projectStoreNames.documents).delete(id)
        const activeKey = lastActiveKey(inspection.project.metadata.projectType)
        const activeRequest = context.store(projectStoreNames.appMeta).get(activeKey)
        activeRequest.onsuccess = () => {
          if (
            !isUnsupportedProjectSchema(activeRequest.result) &&
            activeRequest.result?.projectId === id
          ) {
            context.store(projectStoreNames.appMeta).delete(activeKey)
          }
        }
        context.setResult(successfulOutcome(undefined))
      })
    })
    return unwrapOutcome(outcome)
  }

  async function getLastActiveProjectId(projectType) {
    assertProjectType(projectType)
    const record = await run([projectStoreNames.appMeta], 'readonly', (context) => {
      const request = context.store(projectStoreNames.appMeta).get(lastActiveKey(projectType))
      request.onsuccess = () => context.setResult(request.result)
    })
    if (record === undefined) {
      return null
    }
    if (isUnsupportedProjectSchema(record)) {
      throw new ProjectStoreError(
        'UNSUPPORTED_SCHEMA_VERSION',
        'The saved app metadata was written by a newer version of FixYourTrack.',
      )
    }
    return normalizeLastActiveRecord(record, projectType)?.projectId ?? null
  }

  async function setLastActiveProjectId(projectType, projectId) {
    assertProjectType(projectType)
    if (projectId === null) {
      const outcome = await run([projectStoreNames.appMeta], 'readwrite', (context) => {
        const request = context.store(projectStoreNames.appMeta).get(lastActiveKey(projectType))
        request.onsuccess = () => {
          if (isUnsupportedProjectSchema(request.result)) {
            context.setResult(failedOutcome(new ProjectStoreError(
              'UNSUPPORTED_SCHEMA_VERSION',
              'The saved app metadata was written by a newer version of FixYourTrack.',
            )))
            return
          }
          context.store(projectStoreNames.appMeta).delete(lastActiveKey(projectType))
          context.setResult(successfulOutcome(null))
        }
      })
      return unwrapOutcome(outcome)
    }

    const id = assertProjectId(projectId)
    const timestamp = readNow(now)
    const outcome = await run([
      projectStoreNames.projects,
      projectStoreNames.documents,
      projectStoreNames.appMeta,
      projectStoreNames.quarantine,
    ], 'readwrite', (context) => {
      readProjectPair(context, id, (rawMetadata, rawDocument) => {
        const inspection = inspectProjectPair(id, rawMetadata, rawDocument)
        if (inspection.error) {
          preserveBrokenPair(context, inspection, rawMetadata, rawDocument, timestamp)
          context.setResult(failedOutcome(inspection.error))
          return
        }
        if (inspection.project.metadata.projectType !== projectType) {
          context.setResult(failedOutcome(new ProjectStoreError(
            'PROJECT_TYPE_MISMATCH',
            `The project is not a ${projectType} project.`,
            { projectId: id },
          )))
          return
        }
        const activeRequest = context.store(projectStoreNames.appMeta).get(lastActiveKey(projectType))
        activeRequest.onsuccess = () => {
          if (isUnsupportedProjectSchema(activeRequest.result)) {
            context.setResult(failedOutcome(new ProjectStoreError(
              'UNSUPPORTED_SCHEMA_VERSION',
              'The saved app metadata was written by a newer version of FixYourTrack.',
            )))
            return
          }
          context.store(projectStoreNames.appMeta).put(createLastActiveRecord(projectType, id, timestamp))
          context.setResult(successfulOutcome(id))
        }
      })
    })
    return unwrapOutcome(outcome)
  }

  async function mutateProject(projectId, expectedRevision, mutate) {
    const id = assertProjectId(projectId)
    const revision = assertExpectedRevision(expectedRevision, id)
    const timestamp = readNow(now)
    const outcome = await run([
      projectStoreNames.projects,
      projectStoreNames.documents,
      projectStoreNames.quarantine,
    ], 'readwrite', (context) => {
      readProjectPair(context, id, (rawMetadata, rawDocument) => {
        const inspection = inspectProjectPair(id, rawMetadata, rawDocument)
        if (inspection.error) {
          preserveBrokenPair(context, inspection, rawMetadata, rawDocument, timestamp)
          context.setResult(failedOutcome(inspection.error))
          return
        }
        if (inspection.project.metadata.revision !== revision) {
          context.setResult(failedOutcome(createRevisionConflict(id, revision, inspection.project.metadata.revision)))
          return
        }

        let next
        try {
          next = mutate(inspection.project, timestamp)
        }
        catch (error) {
          context.setResult(failedOutcome(toProjectStoreError(error, id)))
          return
        }
        context.store(projectStoreNames.projects).put(next.metadata)
        context.store(projectStoreNames.documents).put(next.storedDocument)
        context.setResult(successfulOutcome({
          metadata: next.metadata,
          document: next.storedDocument.document,
        }))
      })
    })
    return unwrapOutcome(outcome)
  }

  return Object.freeze({
    createProject,
    listProjects,
    loadProject,
    saveProject,
    renameProject,
    archiveProject,
    restoreProject,
    deleteProject,
    getLastActiveProjectId,
    setLastActiveProjectId,
  })
}

const defaultProjectStore = createProjectStore()

export const createProject = (...args) => defaultProjectStore.createProject(...args)
export const listProjects = (...args) => defaultProjectStore.listProjects(...args)
export const loadProject = (...args) => defaultProjectStore.loadProject(...args)
export const saveProject = (...args) => defaultProjectStore.saveProject(...args)
export const renameProject = (...args) => defaultProjectStore.renameProject(...args)
export const archiveProject = (...args) => defaultProjectStore.archiveProject(...args)
export const restoreProject = (...args) => defaultProjectStore.restoreProject(...args)
export const deleteProject = (...args) => defaultProjectStore.deleteProject(...args)
export const getLastActiveProjectId = (...args) => defaultProjectStore.getLastActiveProjectId(...args)
export const setLastActiveProjectId = (...args) => defaultProjectStore.setLastActiveProjectId(...args)

function reviseProject(project, timestamp, metadataChanges) {
  const revision = project.metadata.revision + 1
  const metadata = serializeProjectMetadata({
    ...project.metadata,
    ...metadataChanges,
    revision,
    updatedAt: timestamp,
  })
  const storedDocument = serializeProjectDocument({
    projectId: metadata.id,
    revision,
    projectType: metadata.projectType,
    document: project.document,
  })
  return { metadata, storedDocument }
}

function readProjectPair(context, projectId, onReady) {
  const metadataRequest = context.store(projectStoreNames.projects).get(projectId)
  const documentRequest = context.store(projectStoreNames.documents).get(projectId)
  let metadataReady = false
  let documentReady = false
  let rawMetadata
  let rawDocument

  metadataRequest.onsuccess = () => {
    rawMetadata = metadataRequest.result
    metadataReady = true
    finish()
  }
  documentRequest.onsuccess = () => {
    rawDocument = documentRequest.result
    documentReady = true
    finish()
  }

  function finish() {
    if (metadataReady && documentReady) {
      onReady(rawMetadata, rawDocument)
    }
  }
}

function inspectProjectPair(projectId, rawMetadata, rawDocument) {
  if (rawMetadata === undefined && rawDocument === undefined) {
    return {
      error: new ProjectStoreError('PROJECT_NOT_FOUND', 'The project was not found.', { projectId }),
      quarantine: false,
    }
  }

  if (isUnsupportedProjectSchema(rawMetadata) || isUnsupportedProjectSchema(rawDocument)) {
    return {
      error: new ProjectStoreError(
        'UNSUPPORTED_SCHEMA_VERSION',
        'This project was written by a newer version of FixYourTrack and is read-only here.',
        { projectId },
      ),
      quarantine: false,
    }
  }

  const metadata = normalizeProjectMetadata(rawMetadata)
  const storedDocument = normalizeProjectDocument(rawDocument)
  if (!metadata || !storedDocument) {
    return {
      error: new ProjectStoreError(
        'CORRUPT_PROJECT',
        'The project is incomplete or contains invalid local data.',
        { projectId },
      ),
      quarantine: true,
      reason: 'CORRUPT_PROJECT',
    }
  }

  if (!projectRecordsMatch(metadata, storedDocument)) {
    return {
      error: new ProjectStoreError(
        'METADATA_DOCUMENT_MISMATCH',
        'The project metadata and document revisions do not match.',
        { projectId },
      ),
      quarantine: true,
      reason: 'METADATA_DOCUMENT_MISMATCH',
    }
  }

  return { project: { metadata, document: storedDocument.document }, quarantine: false }
}

function projectRecordsMatch(metadata, storedDocument) {
  return metadata.id === storedDocument.projectId &&
    metadata.schemaVersion === storedDocument.schemaVersion &&
    metadata.revision === storedDocument.revision &&
    metadata.projectType === storedDocument.projectType
}

function preserveBrokenPair(context, inspection, metadata, document, detectedAt) {
  if (!inspection.quarantine) {
    return
  }
  putQuarantineRecord(context, {
    projectId: inspection.error.projectId,
    reason: inspection.reason,
    detectedAt,
    metadata,
    document,
  })
}

function putQuarantineRecord(context, {
  projectId,
  reason,
  detectedAt,
  metadata,
  document,
}) {
  const quarantineId = createProjectQuarantineId({ projectId, reason, metadata, document })
  context.store(projectStoreNames.quarantine).put({
    id: quarantineId,
    schemaVersion: projectSchemaVersion,
    projectId,
    reason,
    detectedAt,
    metadata: metadata ?? null,
    document: document ?? null,
  })
}

export function createProjectQuarantineId({ projectId, reason, metadata, document }) {
  const identity = [
    normalizeProjectId(projectId) || 'unknown',
    typeof reason === 'string' ? reason : 'UNKNOWN',
    normalizeRevision(metadata?.revision) ?? 'unknown',
    Number.isInteger(metadata?.schemaVersion) ? metadata.schemaVersion : 'unknown',
    normalizeRevision(document?.revision) ?? 'unknown',
    Number.isInteger(document?.schemaVersion) ? document.schemaVersion : 'unknown',
  ]
  return `quarantine-${identity.map((value) => encodeURIComponent(String(value))).join('-')}`
}

function describeUnreadableMetadata(record) {
  if (!isPlainObject(record)) {
    return null
  }
  const id = normalizeProjectId(record.id)
  if (!id) {
    return null
  }
  const future = isUnsupportedProjectSchema(record)
  return {
    id,
    schemaVersion: Number.isInteger(record.schemaVersion) ? record.schemaVersion : null,
    revision: normalizeRevision(record.revision),
    name: normalizeProjectName(record.name) || 'Damaged project',
    projectType: normalizeProjectType(record.projectType) || 'unknown',
    origin: normalizeProjectOrigin(record.origin) || 'unknown',
    summary: normalizeProjectSummary(record.summary) ?? { pointCount: 0, distanceMeters: null },
    createdAt: normalizeTimestamp(record.createdAt) || null,
    updatedAt: normalizeTimestamp(record.updatedAt) || null,
    archivedAt: record.archivedAt === null ? null : normalizeTimestamp(record.archivedAt) || null,
    compatibility: future ? 'unsupported' : 'corrupt',
    readOnly: true,
  }
}

function sortProjectMetadata(projects) {
  return projects.sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : Number.NEGATIVE_INFINITY
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : Number.NEGATIVE_INFINITY
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  })
}

function createLastActiveRecord(projectType, projectId, updatedAt) {
  return {
    key: lastActiveKey(projectType),
    schemaVersion: projectSchemaVersion,
    projectType,
    projectId,
    updatedAt,
  }
}

function normalizeLastActiveRecord(record, expectedProjectType) {
  if (!isPlainObject(record) || record.schemaVersion !== projectSchemaVersion) {
    return null
  }
  const projectType = normalizeProjectType(record.projectType)
  const projectId = normalizeProjectId(record.projectId)
  const updatedAt = normalizeTimestamp(record.updatedAt)
  if (
    projectType !== expectedProjectType ||
    record.key !== lastActiveKey(expectedProjectType) ||
    !projectId ||
    !updatedAt
  ) {
    return null
  }
  return { key: record.key, schemaVersion: projectSchemaVersion, projectType, projectId, updatedAt }
}

function lastActiveKey(projectType) {
  return `last-active-project:${projectType}`
}

function findRoutePointCount(document) {
  const controls = Array.isArray(document.controls)
    ? document.controls
    : Array.isArray(document.plan?.controls)
      ? document.plan.controls
      : null
  if (controls) {
    return controls.length
  }
  const geometry = findGeometry(document)
  return geometry?.length ?? 0
}

function findRepairPointCount(document) {
  const samples = Array.isArray(document.workingTrack?.samples)
    ? document.workingTrack.samples
    : Array.isArray(document.track?.samples)
      ? document.track.samples
      : Array.isArray(document.samples)
        ? document.samples
        : null
  return samples?.length ?? 0
}

function findDistanceMeters(document) {
  const candidates = [
    document.summary?.distanceMeters,
    document.preview?.distanceMeters,
    document.routePreview?.distanceMeters,
    document.metrics?.distanceMeters,
    document.distanceMeters,
  ]
  for (const value of candidates) {
    const normalized = normalizeOptionalMeasurement(value)
    if (normalized !== undefined && normalized !== null) {
      return normalized
    }
  }
  return null
}

function findGeometry(document) {
  if (Array.isArray(document.geometry)) {
    return document.geometry
  }
  if (Array.isArray(document.preview?.geometry)) {
    return document.preview.geometry
  }
  if (Array.isArray(document.routePreview?.geometry)) {
    return document.routePreview.geometry
  }
  return null
}

function cloneJsonValue(value, state, depth) {
  state.nodeCount += 1
  if (state.nodeCount > maximumDocumentNodes) {
    throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document is too large.')
  }
  if (depth > maximumDocumentDepth) {
    throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document is nested too deeply.')
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains a non-finite number.')
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains an unsupported value.')
  }
  if (state.ancestors.has(value)) {
    throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains a circular reference.')
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains a non-plain object.')
  }

  state.ancestors.add(value)
  let cloned
  if (Array.isArray(value)) {
    cloned = value.map((item, index) => {
      if (!(index in value)) {
        throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains a sparse array.')
      }
      return cloneJsonValue(item, state, depth + 1)
    })
  }
  else {
    if (Object.getOwnPropertySymbols(value).length) {
      throw new ProjectStoreError('INVALID_PROJECT_DOCUMENT', 'The project document contains symbol keys.')
    }
    cloned = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, state, depth + 1)]),
    )
  }
  state.ancestors.delete(value)
  return cloned
}

function normalizeProjectType(value) {
  return projectTypes.includes(value) ? value : ''
}

function assertProjectType(value) {
  const normalized = normalizeProjectType(value)
  if (!normalized) {
    throw new ProjectStoreError('INVALID_PROJECT_TYPE', 'Project type must be route or repair.')
  }
  return normalized
}

function assertProjectName(value) {
  const normalized = normalizeProjectName(value)
  if (!normalized) {
    throw new ProjectStoreError('INVALID_PROJECT_NAME', 'Project name cannot be empty.')
  }
  return normalized
}

function assertProjectOrigin(value) {
  const normalized = normalizeProjectOrigin(value)
  if (!normalized) {
    throw new ProjectStoreError(
      'INVALID_PROJECT_ORIGIN',
      'Project origin must be a lowercase word or hyphenated phrase.',
    )
  }
  return normalized
}

function normalizeProjectId(value) {
  if (typeof value !== 'string') {
    return ''
  }
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > maximumProjectIdLength ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)
  ) {
    return ''
  }
  return normalized
}

function assertProjectId(value) {
  const normalized = normalizeProjectId(value)
  if (!normalized) {
    throw new ProjectStoreError('INVALID_PROJECT_ID', 'Project ID is invalid.')
  }
  return normalized
}

function assertGeneratedProjectId(value) {
  const normalized = normalizeProjectId(value)
  if (!normalized) {
    throw new ProjectStoreError('INVALID_GENERATED_ID', 'The project ID generator returned an invalid ID.')
  }
  return normalized
}

function normalizeRevision(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

function assertExpectedRevision(value, projectId) {
  const normalized = normalizeRevision(value)
  if (normalized === null) {
    throw new ProjectStoreError(
      'INVALID_EXPECTED_REVISION',
      'A positive expectedRevision is required for this change.',
      { projectId },
    )
  }
  return normalized
}

function normalizeTimestamp(value) {
  if (
    !(value instanceof Date) &&
    !(typeof value === 'string' && value.trim()) &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    return ''
  }
  const timestamp = value instanceof Date ? value : new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : ''
}

function readNow(now) {
  let value
  try {
    value = now()
  }
  catch (error) {
    throw new ProjectStoreError('INVALID_CLOCK', 'The project store clock failed.', { cause: error })
  }
  const timestamp = normalizeTimestamp(value)
  if (!timestamp) {
    throw new ProjectStoreError('INVALID_CLOCK', 'The project store clock returned an invalid date.')
  }
  return timestamp
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function normalizeOptionalMeasurement(value) {
  if (value === null || value === undefined) {
    return value === null ? null : undefined
  }
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function createRevisionConflict(projectId, expectedRevision, actualRevision) {
  const error = new ProjectStoreError(
    'REVISION_CONFLICT',
    `This project changed after revision ${expectedRevision}; its current revision is ${actualRevision}.`,
    { projectId },
  )
  error.expectedRevision = expectedRevision
  error.actualRevision = actualRevision
  return error
}

function successfulOutcome(value) {
  return { ok: true, value }
}

function failedOutcome(error) {
  return { ok: false, error }
}

function unwrapOutcome(outcome) {
  if (outcome?.ok) {
    return outcome.value
  }
  throw outcome?.error ?? new ProjectStoreError('TRANSACTION_FAILED', 'The project transaction failed.')
}

function toProjectStoreError(error, projectId = null) {
  return error instanceof ProjectStoreError
    ? error
    : new ProjectStoreError('PROJECT_MUTATION_FAILED', 'The project change could not be prepared.', {
      cause: error,
      projectId,
    })
}

function createProjectId() {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  return randomUuid ? `project-${randomUuid}` : `project-${createFallbackId()}`
}

function createFallbackId() {
  const randomPart = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${randomPart}`
}

function runTransaction({ indexedDB, storeNames, mode, executor }) {
  return openDatabase(indexedDB).then((database) => new Promise((resolve, reject) => {
    let transaction
    try {
      transaction = database.transaction(storeNames, mode)
    }
    catch (error) {
      database.close()
      reject(mapStorageError(error, 'The project transaction could not be started.'))
      return
    }

    let result
    let failure = null
    let settled = false
    const closeAndResolve = () => {
      if (settled) {
        return
      }
      settled = true
      database.close()
      resolve(result)
    }
    const closeAndReject = (error) => {
      if (settled) {
        return
      }
      settled = true
      database.close()
      reject(error)
    }

    transaction.oncomplete = closeAndResolve
    transaction.onerror = () => {
      closeAndReject(failure ?? mapStorageError(
        transaction.error,
        'The project transaction failed.',
      ))
    }
    transaction.onabort = () => {
      closeAndReject(failure ?? mapStorageError(
        transaction.error,
        'The project transaction was cancelled.',
        'TRANSACTION_ABORTED',
      ))
    }

    const context = {
      store: (name) => transaction.objectStore(name),
      setResult: (value) => {
        result = value
      },
      abort: (error) => {
        failure = toProjectStoreError(error)
        try {
          transaction.abort()
        }
        catch (abortError) {
          closeAndReject(mapStorageError(abortError, 'The project transaction could not be cancelled.'))
        }
      },
    }

    try {
      executor(context)
    }
    catch (error) {
      context.abort(error)
    }
  }))
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const factory = indexedDB ?? globalThis.indexedDB
    if (!factory?.open) {
      reject(new ProjectStoreError(
        'INDEXEDDB_UNAVAILABLE',
        'Local project storage is not available in this browser.',
      ))
      return
    }

    let request
    try {
      request = factory.open(projectDatabaseName, projectDatabaseVersion)
    }
    catch (error) {
      reject(mapStorageError(error, 'The local project database could not be opened.'))
      return
    }
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
    request.onerror = () => {
      const error = request.error
      if (error?.name === 'VersionError') {
        reject(new ProjectStoreError(
          'UNSUPPORTED_DATABASE_VERSION',
          'The local project database was created by a newer version of FixYourTrack.',
          { cause: error },
        ))
        return
      }
      reject(mapStorageError(error, 'The local project database could not be opened.'))
    }
    request.onblocked = () => {
      blocked = true
      reject(new ProjectStoreError(
        'DATABASE_BLOCKED',
        'Close other FixYourTrack tabs before upgrading local project storage.',
      ))
    }
  })
}

function ensureObjectStore(database, transaction, name, options) {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, options)
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false })
  }
}

function mapStorageError(error, fallbackMessage, fallbackCode = 'TRANSACTION_FAILED') {
  if (error instanceof ProjectStoreError) {
    return error
  }
  const code = error?.name === 'QuotaExceededError'
    ? 'STORAGE_QUOTA_EXCEEDED'
    : error?.name === 'VersionError'
      ? 'UNSUPPORTED_DATABASE_VERSION'
      : fallbackCode
  return new ProjectStoreError(code, fallbackMessage, { cause: error ?? null })
}
