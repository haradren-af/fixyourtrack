import {
  normalizePersistedRoutePlan,
  routePlanSchemaVersion,
  setRouteName,
} from './routePlan.js'

export class UnsupportedRouteProjectError extends Error {
  constructor(schemaVersion) {
    super('This route project requires a newer version of FixYourTrack.')
    this.name = 'UnsupportedRouteProjectError'
    this.code = 'UNSUPPORTED_ROUTE_DOCUMENT'
    this.schemaVersion = schemaVersion
  }
}

export function normalizeRouteProjectDocument(document, name = null) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The saved route project document is invalid.')
  }
  if (
    Number.isInteger(document.schemaVersion) &&
    document.schemaVersion > routePlanSchemaVersion
  ) {
    throw new UnsupportedRouteProjectError(document.schemaVersion)
  }
  if (document.kind !== undefined && document.kind !== 'route') {
    throw new Error('The saved project is not a route document.')
  }
  const plan = normalizePersistedRoutePlan(document)
  if (!plan) {
    throw new Error('The saved route project document is invalid.')
  }
  return name === null ? plan : setRouteName(plan, name)
}

export function reconcileRouteProjectRevision(
  metadata,
  draftRevision,
  localDocument = null,
  storedDocument = null,
) {
  if (!metadata || !Number.isInteger(draftRevision) || draftRevision < 1) {
    throw new Error('The route project revision is invalid.')
  }
  if (metadata.archivedAt !== null) {
    return { ...metadata, baseRevision: draftRevision, conflict: true }
  }
  try {
    normalizeRouteProjectDocument(storedDocument, metadata.name)
  }
  catch (error) {
    return {
      ...metadata,
      baseRevision: draftRevision,
      conflict: true,
      invalidDocument: true,
      documentErrorCode: error?.code ?? 'INVALID_ROUTE_DOCUMENT',
    }
  }
  return metadata.revision === draftRevision || routeProjectDocumentsEqual(
    localDocument,
    storedDocument,
    metadata.name,
  )
    ? metadata
    : { ...metadata, baseRevision: draftRevision, conflict: true }
}

export function routeProjectDocumentsEqual(localDocument, storedDocument, storedName = null) {
  if (!localDocument || !storedDocument) {
    return false
  }
  try {
    const local = normalizeRouteProjectDocument(localDocument)
    const stored = normalizeRouteProjectDocument(storedDocument, storedName)
    return JSON.stringify(local) === JSON.stringify(stored)
  }
  catch {
    return false
  }
}

export function getRouteProjectDraftAssociation(project) {
  if (!project?.id) {
    return { projectId: null, projectRevision: null }
  }
  return {
    projectId: project.id,
    projectRevision: project.baseRevision ?? project.revision ?? null,
  }
}
