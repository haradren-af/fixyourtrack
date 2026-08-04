import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatCreateRouteCopy, getCreateRouteCopy } from './createRouteCopy.js'
import { sanitizeFilename } from './filename.js'
import { buildPlannedRouteGpx } from './plannedRouteGpx.js'
import ProjectLibraryDialog from './ProjectLibraryDialog.jsx'
import {
  getRouteProjectDraftAssociation,
  normalizeRouteProjectDocument,
  reconcileRouteProjectRevision,
} from './projectRoute.js'
import {
  archiveProject,
  createProject,
  deleteProject,
  isProjectStoreError,
  listProjects,
  loadProject,
  restoreProject,
  saveProject,
  setLastActiveProjectId,
} from './projectStore.js'
import { directLegMode, getLegMode, routedLegMode } from './routeLegs.js'
import { buildRouteDisplayPreview, buildRoutePreview, emptyRoutePreview } from './routeBuilder.js'
import {
  acquireRouteDraftLock,
  clearRecoverableRouteDraftLease,
} from './routeDraftLock.js'
import {
  createRouteDraftSnapshotMetadata,
  createRouteDraftSnapshotVersionClock,
  loadRouteDraft,
  quarantineRouteDraft,
  saveRouteDraft,
} from './routeDraftStore.js'
import {
  clearRouteDraftJournalIfMatching,
  inspectRouteDraftRecovery,
  loadRouteDraftJournal,
  routeDraftCoreFingerprint,
  saveRouteDraftJournal,
} from './routeDraftJournal.js'
import {
  appendRouteControl,
  closeRouteLoop,
  commitRouteHistory,
  createRouteHistory,
  createRoutePlan,
  getRouteExportProblems,
  insertRouteControl,
  redoRouteHistory,
  removeRouteControl,
  replaceRouteControl,
  reverseRoutePlan,
  routePlanFingerprint,
  setRouteLegMode,
  setRouteName,
  setRouteProfile,
  undoRouteHistory,
} from './routePlan.js'
import TrackMap from './TrackMap.jsx'

export default function CreateRouteWorkspace({
  active,
  inert = false,
  initialView,
  language,
  mapLayer,
  onMapLayerChange,
  onHydrationStatusChange = () => {},
  onProjectLibraryClose = () => {},
  projectLibraryOpen = false,
}) {
  const labels = getCreateRouteCopy(language)
  const [history, setHistory] = useState(() => createRouteHistory(createRoutePlan({ name: labels.newRoute })))
  const [interactionMode, setInteractionMode] = useState('place-start')
  const [activeControlId, setActiveControlId] = useState(null)
  const [traceAnchorId, setTraceAnchorId] = useState(null)
  const [preview, setPreview] = useState({ ...emptyRoutePreview })
  const [fitRequest, setFitRequest] = useState(0)
  const [retryRequest, setRetryRequest] = useState(0)
  const [message, setMessage] = useState(labels.clickStart)
  const [exportError, setExportError] = useState('')
  const [hydrationStatus, setHydrationStatus] = useState('loading')
  const [hydrationAttempt, setHydrationAttempt] = useState(0)
  const [hydrationError, setHydrationError] = useState(null)
  const [draftStatus, setDraftStatus] = useState({ kind: 'idle', savedAt: null })
  const [currentProject, setCurrentProject] = useState(null)
  const [projectSaveStatus, setProjectSaveStatus] = useState({ kind: 'local', message: '' })
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState('')
  const [projectsStatus, setProjectsStatus] = useState('')
  const [projectTransitioning, setProjectTransitioning] = useState(false)
  const fitAfterRoutingRef = useRef(false)
  const routeLegCacheRef = useRef(new Map())
  const restoredPreviewRef = useRef(false)
  const draftRestoredMessageRef = useRef(labels.draftRestored)
  const draftMessagesRef = useRef({
    loadFailed: labels.draftLoadFailed,
    writerBlocked: labels.draftWriterBlocked,
  })
  const routeMessagesRef = useRef({
    error: labels.error,
    ready: labels.ready,
  })
  const initialProjectMessagesRef = useRef({
    conflict: labels.projectConflict,
    saveFailed: labels.projectSaveFailed,
  })
  const lastSavedDraftRef = useRef(null)
  const lastSavedDraftAtRef = useRef(null)
  const latestDraftRef = useRef(null)
  const pendingDraftSaveRef = useRef(null)
  const draftSaveRunningRef = useRef(false)
  const draftSavePromiseRef = useRef(Promise.resolve())
  const [draftSnapshotClock] = useState(() => createRouteDraftSnapshotVersionClock())
  const draftJournalHealthyRef = useRef(true)
  const hydrationJournalDraftRef = useRef(null)
  const currentProjectRef = useRef(null)
  const planRef = useRef(null)
  const lastSavedProjectDocumentRef = useRef(null)
  const projectSaveChainRef = useRef(Promise.resolve())
  const projectSaveGenerationRef = useRef(0)
  const projectAssociationTokenRef = useRef(0)
  const pendingProjectSaveTimerRef = useRef(null)
  const draftLockRef = useRef(null)
  const draftLockAcquisitionRef = useRef(Promise.resolve())
  const draftLockTransitionRef = useRef(Promise.resolve())
  const hasHydratedRef = useRef(false)
  const lockRecoverySnapshotRef = useRef(null)
  const lockRecoveryConflictRef = useRef(null)
  const plan = history.present
  const fingerprint = routePlanFingerprint(plan)
  const effectivePreview = plan.controls.length < 2
    ? emptyRoutePreview
    : preview.fingerprint === fingerprint
      ? preview
      : buildRouteDisplayPreview(plan.controls, plan.legModes, plan.profile, {
          status: 'loading',
          fingerprint,
        })
  const persistablePreview = preview.status === 'ready' && preview.fingerprint === fingerprint
    ? preview
    : null
  const initialDraftStateRef = useRef({
    plan,
    session: {
      interactionMode,
      activeControlId,
      traceAnchorId,
      projectId: null,
      projectRevision: null,
    },
    preview: null,
  })

  const queueDraftSave = useCallback((snapshot) => {
    if (
      !draftSaveRunningRef.current &&
      snapshot.serializedSnapshot === lastSavedDraftRef.current
    ) {
      return
    }
    pendingDraftSaveRef.current = snapshot
    if (draftSaveRunningRef.current) {
      return
    }

    draftSaveRunningRef.current = true
    const operation = (async () => {
      let failed = false
      try {
        while (pendingDraftSaveRef.current) {
          const next = pendingDraftSaveRef.current
          pendingDraftSaveRef.current = null
          if (next.serializedSnapshot === lastSavedDraftRef.current) {
            continue
          }
          if (!draftLockRef.current?.isHeld()) {
            failed = true
            break
          }

          setDraftStatus({ kind: 'saving', savedAt: null })
          try {
            const savedAt = await saveRouteDraft(next.plan, next.session, next.preview, {
              savedAt: next.savedAt,
              snapshotVersion: next.snapshotVersion,
            })
            lastSavedDraftRef.current = next.serializedSnapshot
            lastSavedDraftAtRef.current = savedAt
            clearRouteDraftJournalIfMatching(next)
          }
          catch {
            failed = true
            if (!pendingDraftSaveRef.current) {
              break
            }
          }
        }
      }
      finally {
        draftSaveRunningRef.current = false
        const latest = latestDraftRef.current
        if (latest?.serializedSnapshot === lastSavedDraftRef.current) {
          setDraftStatus({ kind: 'saved', savedAt: lastSavedDraftAtRef.current })
        }
        else if (failed) {
          setDraftStatus({ kind: 'error', savedAt: null })
        }
        else if (latest) {
          setDraftStatus({ kind: 'dirty', savedAt: null })
        }
      }
    })()
    draftSavePromiseRef.current = operation
    void operation
  }, [])

  useEffect(() => {
    planRef.current = plan
  }, [plan])

  useEffect(() => {
    currentProjectRef.current = currentProject
  }, [currentProject])

  useEffect(() => {
    draftMessagesRef.current = {
      loadFailed: labels.draftLoadFailed,
      writerBlocked: labels.draftWriterBlocked,
    }
  }, [labels.draftLoadFailed, labels.draftWriterBlocked])

  useEffect(() => {
    routeMessagesRef.current = {
      error: labels.error,
      ready: labels.ready,
    }
  }, [labels.error, labels.ready])

  useEffect(() => {
    onHydrationStatusChange(hydrationStatus)
  }, [hydrationStatus, onHydrationStatusChange])

  useEffect(() => () => {
    const lock = draftLockRef.current
    draftLockRef.current = null
    if (draftSaveRunningRef.current) {
      void draftSavePromiseRef.current.finally(() => lock?.release())
    }
    else {
      lock?.release()
    }
  }, [])

  useEffect(() => {
    if (active) {
      return undefined
    }

    hasHydratedRef.current = false
    lockRecoveryConflictRef.current = null

    const latest = latestDraftRef.current
    const hasUnsavedSnapshot = Boolean(
      latest && latest.serializedSnapshot !== lastSavedDraftRef.current,
    )
    lockRecoverySnapshotRef.current = hasUnsavedSnapshot ? latest : null

    if (hasUnsavedSnapshot) {
      try {
        saveRouteDraftJournal(latest.plan, latest.session, {
          metadata: {
            savedAt: latest.savedAt,
            snapshotVersion: latest.snapshotVersion,
          },
        })
        draftJournalHealthyRef.current = true
      }
      catch {
        draftJournalHealthyRef.current = false
      }
    }

    const transition = (async () => {
      await draftLockAcquisitionRef.current.catch(() => {})
      if (hasUnsavedSnapshot && draftLockRef.current?.isHeld()) {
        queueDraftSave(latest)
      }
      await draftSavePromiseRef.current.catch(() => {})
      if (
        lockRecoverySnapshotRef.current === latest &&
        latest?.serializedSnapshot === lastSavedDraftRef.current
      ) {
        lockRecoverySnapshotRef.current = null
      }
      const lock = draftLockRef.current
      draftLockRef.current = null
      lock?.release()
    })()
    draftLockTransitionRef.current = transition
    void transition
    return undefined
  }, [active, queueDraftSave])

  useEffect(() => {
    if (!active) {
      return undefined
    }
    let mounted = true

    Promise.resolve()
      .then(async () => {
        if (!mounted) {
          return null
        }
        setHydrationStatus('loading')
        setHydrationError(null)
        await draftLockTransitionRef.current.catch(() => {})
        if (!mounted) {
          return null
        }
        let lock = draftLockRef.current
        if (!lock?.isHeld()) {
          const acquisition = acquireRouteDraftLock()
          draftLockAcquisitionRef.current = acquisition
          lock = await acquisition
          if (!lock.acquired) {
            const error = new Error(draftMessagesRef.current.writerBlocked)
            error.code = 'ROUTE_DRAFT_LOCK_UNAVAILABLE'
            error.lockReason = lock.reason
            error.cause = lock.error ?? null
            throw error
          }
          if (!mounted) {
            lock.release()
            return null
          }
          draftLockRef.current = lock
        }
        lock.lost.then(({ reason }) => {
          if (!mounted || reason === 'released') {
            return
          }
          const error = new Error(draftMessagesRef.current.writerBlocked)
          error.code = 'ROUTE_DRAFT_LOCK_LOST'
          lockRecoverySnapshotRef.current = latestDraftRef.current
          lockRecoveryConflictRef.current = null
          hasHydratedRef.current = false
          setHydrationError(error)
          setDraftStatus({ kind: 'error', savedAt: null })
          setHydrationStatus('blocked')
        })

        if (
          hasHydratedRef.current &&
          !lockRecoverySnapshotRef.current &&
          currentProjectRef.current?.unverified
        ) {
          const unverifiedProject = currentProjectRef.current
          setProjectSaveStatus({ kind: 'loading', message: '' })
          try {
            const project = await loadProject(unverifiedProject.id)
            if (!mounted) {
              return null
            }
            const restoredProject = reconcileRouteProjectRevision(
              project.metadata,
              unverifiedProject.baseRevision ?? unverifiedProject.revision,
              planRef.current,
              project.document,
            )
            currentProjectRef.current = restoredProject
            setCurrentProject(restoredProject)
            lastSavedProjectDocumentRef.current = serializeProjectDocument(project.document)
            setProjectSaveStatus(restoredProject.conflict
              ? { kind: 'conflict', message: initialProjectMessagesRef.current.conflict }
              : { kind: 'saved', message: '' })
          }
          catch (error) {
            if (mounted) {
              setProjectSaveStatus({
                kind: 'error',
                message: error instanceof Error
                  ? error.message
                  : initialProjectMessagesRef.current.saveFailed,
              })
            }
          }
        }
        if (hasHydratedRef.current && !lockRecoverySnapshotRef.current) {
          return { preserveEditor: true, draft: null }
        }
        hydrationJournalDraftRef.current = null
        const recovery = await inspectRouteDraftRecovery({
          loadPersistedDraft: loadRouteDraft,
          loadJournalDraft: () => {
            const journalDraft = loadRouteDraftJournal()
            hydrationJournalDraftRef.current = journalDraft
            return journalDraft
          },
        })
        draftSnapshotClock.observe(
          recovery.persistedDraft?.snapshotVersion,
          recovery.journalDraft?.snapshotVersion,
          lockRecoverySnapshotRef.current?.snapshotVersion,
        )
        if (recovery.error) {
          throw recovery.error
        }
        const { persistedDraft, journalDraft } = recovery
        if (recovery.source === 'database' && journalDraft) {
          clearRouteDraftJournalIfMatching(journalDraft)
        }
        const storedDraft = recovery.draft
        const localRecovery = lockRecoverySnapshotRef.current
        if (localRecovery) {
          if (routeDraftCoreFingerprint(storedDraft) !== routeDraftCoreFingerprint(localRecovery)) {
            lockRecoveryConflictRef.current = {
              local: localRecovery,
              stored: storedDraft,
            }
            const error = new Error(draftMessagesRef.current.loadFailed)
            error.code = 'ROUTE_DRAFT_CONTENT_CONFLICT'
            throw error
          }
          lockRecoverySnapshotRef.current = null
          lockRecoveryConflictRef.current = null
        }
        return {
          preserveEditor: false,
          draft: storedDraft,
          persistedDraft,
          recoveredFromJournal: recovery.source === 'journal',
        }
      })
      .then((draft) => {
        if (!mounted || !draft) {
          return
        }
        if (!draft.preserveEditor && draft.draft) {
          const restoredDraft = draft.draft
          const restoredSnapshot = {
            plan: restoredDraft.plan,
            session: restoredDraft.session,
            preview: restoredDraft.preview,
            savedAt: restoredDraft.savedAt,
            snapshotVersion: restoredDraft.snapshotVersion,
          }
          latestDraftRef.current = {
            ...restoredSnapshot,
            serializedSnapshot: serializeDraftSnapshot(restoredSnapshot),
          }
          setHistory(createRouteHistory(restoredDraft.plan))
          setInteractionMode(restoredDraft.session.interactionMode)
          setActiveControlId(restoredDraft.session.activeControlId)
          setTraceAnchorId(restoredDraft.session.traceAnchorId)
          setMessage(draftRestoredMessageRef.current)
          if (restoredDraft.preview) {
            restoredPreviewRef.current = true
            setPreview(restoredDraft.preview)
          }
          if (restoredDraft.plan.controls.length === 1) {
            setFitRequest((current) => current + 1)
          }
          lastSavedDraftRef.current = draft.recoveredFromJournal
            ? draft.persistedDraft
              ? serializeDraftSnapshot({
                  plan: draft.persistedDraft.plan,
                  session: draft.persistedDraft.session,
                  preview: draft.persistedDraft.preview,
                })
              : null
            : serializeDraftSnapshot({
                plan: restoredDraft.plan,
                session: restoredDraft.session,
                preview: restoredDraft.preview,
              })
          lastSavedDraftAtRef.current = draft.persistedDraft?.savedAt ?? restoredDraft.savedAt
          if (!draft.recoveredFromJournal) {
            setDraftStatus({ kind: 'saved', savedAt: lastSavedDraftAtRef.current })
          }
          if (restoredDraft.session.projectId && restoredDraft.session.projectRevision) {
            const placeholder = {
              id: restoredDraft.session.projectId,
              revision: restoredDraft.session.projectRevision,
              name: restoredDraft.plan.name,
              unverified: true,
            }
            currentProjectRef.current = placeholder
            setCurrentProject(placeholder)
            setProjectSaveStatus({ kind: 'loading', message: '' })
            loadProject(restoredDraft.session.projectId)
              .then((project) => {
                if (!mounted) {
                  return
                }
                const restoredProject = reconcileRouteProjectRevision(
                  project.metadata,
                  restoredDraft.session.projectRevision,
                  restoredDraft.plan,
                  project.document,
                )
                currentProjectRef.current = restoredProject
                setCurrentProject(restoredProject)
                lastSavedProjectDocumentRef.current = serializeProjectDocument(project.document)
                setProjectSaveStatus(restoredProject.conflict
                  ? { kind: 'conflict', message: initialProjectMessagesRef.current.conflict }
                  : { kind: 'saved', message: '' })
              })
              .catch((error) => {
                if (mounted) {
                  setProjectSaveStatus({
                    kind: 'error',
                    message: error instanceof Error ? error.message : initialProjectMessagesRef.current.saveFailed,
                  })
                }
              })
          }
        }
        else if (!draft.preserveEditor) {
          const initialSerializedSnapshot = serializeDraftSnapshot(initialDraftStateRef.current)
          lastSavedDraftRef.current = initialSerializedSnapshot
          lastSavedDraftAtRef.current = null
          latestDraftRef.current = {
            ...initialDraftStateRef.current,
            savedAt: null,
            snapshotVersion: null,
            serializedSnapshot: initialSerializedSnapshot,
          }
        }
        hasHydratedRef.current = true
        setHydrationStatus('ready')
      })
      .catch((error) => {
        if (mounted) {
          setHydrationError(error instanceof Error ? error : new Error(draftMessagesRef.current.loadFailed))
          setDraftStatus({ kind: 'error', savedAt: null })
          setHydrationStatus('blocked')
        }
      })

    return () => {
      mounted = false
    }
  }, [active, draftSnapshotClock, hydrationAttempt])

  useEffect(() => {
    if (!active || hydrationStatus !== 'ready') {
      return undefined
    }

    const snapshotContent = {
      plan,
      session: {
        interactionMode,
        activeControlId,
        traceAnchorId,
        ...getRouteProjectDraftAssociation(currentProject),
      },
      preview: persistablePreview,
    }
    const serializedSnapshot = serializeDraftSnapshot(snapshotContent)
    const previousSnapshot = latestDraftRef.current
    const metadata = previousSnapshot?.serializedSnapshot === serializedSnapshot &&
      previousSnapshot.savedAt &&
      previousSnapshot.snapshotVersion
      ? {
          savedAt: previousSnapshot.savedAt,
          snapshotVersion: previousSnapshot.snapshotVersion,
        }
      : createRouteDraftSnapshotMetadata(draftSnapshotClock)
    const snapshot = { ...snapshotContent, ...metadata, serializedSnapshot }
    latestDraftRef.current = snapshot
    if (
      serializedSnapshot === lastSavedDraftRef.current &&
      !draftSaveRunningRef.current
    ) {
      return undefined
    }
    try {
      saveRouteDraftJournal(snapshot.plan, snapshot.session, { metadata })
      draftJournalHealthyRef.current = true
    }
    catch {
      draftJournalHealthyRef.current = false
    }
    setDraftStatus({ kind: 'dirty', savedAt: null })
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      queueDraftSave({ ...snapshot, serializedSnapshot })
    })

    return () => {
      cancelled = true
    }
  }, [active, activeControlId, currentProject, draftSnapshotClock, hydrationStatus, interactionMode, persistablePreview, plan, queueDraftSave, traceAnchorId])

  useEffect(() => {
    if (!active) {
      return undefined
    }
    const flushLatestDraft = () => {
      const latest = latestDraftRef.current
      if (
        !latest ||
        (
          latest.serializedSnapshot === lastSavedDraftRef.current &&
          !draftSaveRunningRef.current
        )
      ) {
        return
      }
      try {
        saveRouteDraftJournal(latest.plan, latest.session, {
          metadata: {
            savedAt: latest.savedAt,
            snapshotVersion: latest.snapshotVersion,
          },
        })
        draftJournalHealthyRef.current = true
      }
      catch {
        draftJournalHealthyRef.current = false
      }
      queueDraftSave(latest)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushLatestDraft()
      }
    }
    window.addEventListener('pagehide', flushLatestDraft)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const warnBeforeUnload = (event) => {
      const latest = latestDraftRef.current
      if (
        latest &&
        latest.serializedSnapshot !== lastSavedDraftRef.current &&
        !draftJournalHealthyRef.current
      ) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', flushLatestDraft)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [active, queueDraftSave])

  useEffect(() => {
    if (
      hydrationStatus !== 'ready' ||
      !currentProject?.id ||
      currentProject.unverified ||
      currentProject.conflict
    ) {
      return undefined
    }

    const serializedDocument = serializeProjectDocument(plan)
    if (
      serializedDocument === lastSavedProjectDocumentRef.current &&
      currentProject.name === plan.name
    ) {
      return undefined
    }

    const generation = projectSaveGenerationRef.current + 1
    projectSaveGenerationRef.current = generation
    const associationToken = projectAssociationTokenRef.current
    setProjectSaveStatus({ kind: 'dirty', message: '' })
    const timeout = window.setTimeout(() => {
      pendingProjectSaveTimerRef.current = null
      setProjectSaveStatus({ kind: 'saving', message: '' })
      const operation = projectSaveChainRef.current
        .catch(() => {})
        .then(async () => {
          const latestProject = currentProjectRef.current
          if (
            projectAssociationTokenRef.current !== associationToken ||
            !latestProject?.id ||
            latestProject.id !== currentProject.id ||
            latestProject.conflict
          ) {
            return null
          }
          const savedProject = await saveProject(currentProject.id, plan, {
            expectedRevision: latestProject.revision,
            name: plan.name,
          })
          if (
            projectAssociationTokenRef.current !== associationToken ||
            currentProjectRef.current?.id !== currentProject.id
          ) {
            return null
          }
          currentProjectRef.current = savedProject.metadata
          lastSavedProjectDocumentRef.current = serializedDocument
          setCurrentProject(savedProject.metadata)
          return savedProject
        })
        .then((savedProject) => {
          if (savedProject && projectSaveGenerationRef.current === generation) {
            setProjectSaveStatus({ kind: 'saved', message: '' })
          }
        })
        .catch((error) => {
          if (
            projectAssociationTokenRef.current !== associationToken ||
            currentProjectRef.current?.id !== currentProject.id
          ) {
            return null
          }
          if (isProjectStoreError(error, 'REVISION_CONFLICT')) {
            const conflicted = { ...currentProjectRef.current, conflict: true }
            currentProjectRef.current = conflicted
            setCurrentProject(conflicted)
          }
          if (projectSaveGenerationRef.current === generation) {
            setProjectSaveStatus({
              kind: isProjectStoreError(error, 'REVISION_CONFLICT') ? 'conflict' : 'error',
              message: isProjectStoreError(error, 'REVISION_CONFLICT')
                ? labels.projectConflict
                : error instanceof Error
                  ? error.message
                  : labels.projectSaveFailed,
            })
          }
          return null
        })
      projectSaveChainRef.current = operation
    }, 500)
    pendingProjectSaveTimerRef.current = timeout

    return () => {
      window.clearTimeout(timeout)
      if (pendingProjectSaveTimerRef.current === timeout) {
        pendingProjectSaveTimerRef.current = null
      }
    }
  }, [currentProject?.conflict, currentProject?.id, currentProject?.name, currentProject?.revision, currentProject?.unverified, hydrationStatus, labels.projectConflict, labels.projectSaveFailed, plan])

  useEffect(() => {
    if (!projectLibraryOpen || hydrationStatus !== 'ready') {
      return undefined
    }
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      setProjectsLoading(true)
      setProjectsError('')
      listProjects({ projectType: 'route', includeArchived: true })
        .then((nextProjects) => {
          if (!cancelled) {
            setProjects(nextProjects)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setProjectsError(error instanceof Error ? error.message : labels.projectsUnavailable)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setProjectsLoading(false)
          }
        })
    })
    return () => {
      cancelled = true
    }
  }, [hydrationStatus, labels.projectsUnavailable, projectLibraryOpen])

  useEffect(() => {
    const routePlan = planRef.current
    if (!active || routePlan.controls.length < 2) {
      return undefined
    }
    if (restoredPreviewRef.current) {
      restoredPreviewRef.current = false
      return undefined
    }

    let cancelled = false
    const abortController = new AbortController()
    setPreview(buildRouteDisplayPreview(routePlan.controls, routePlan.legModes, routePlan.profile, {
      cache: routeLegCacheRef.current,
      status: 'loading',
      fingerprint,
    }))

    const buildTimer = window.setTimeout(() => {
      if (cancelled) return
      buildRoutePreview(routePlan.controls, routePlan.legModes, routePlan.profile, {
        cache: routeLegCacheRef.current,
        signal: abortController.signal,
      })
        .then((nextPreview) => {
          if (cancelled) {
            return
          }
          setPreview({ ...nextPreview, fingerprint })
          setMessage(routeMessagesRef.current.ready)
          if (fitAfterRoutingRef.current) {
            fitAfterRoutingRef.current = false
            setFitRequest((current) => current + 1)
          }
        })
        .catch((error) => {
          if (cancelled || abortController.signal.aborted) {
            return
          }
          setPreview(buildRouteDisplayPreview(routePlan.controls, routePlan.legModes, routePlan.profile, {
            cache: routeLegCacheRef.current,
            status: 'error',
            fingerprint,
            error: error instanceof Error ? error.message : routeMessagesRef.current.error,
            failedLegId: error?.fromControlId ?? null,
            failedToControlId: error?.toControlId ?? null,
          }))
        })
    }, 50)

    return () => {
      cancelled = true
      window.clearTimeout(buildTimer)
      abortController.abort()
    }
  }, [active, fingerprint, retryRequest])

  useEffect(() => {
    if (!active || inert || interactionMode === 'inspect') {
      return undefined
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setInteractionMode('inspect')
        setActiveControlId(null)
        setTraceAnchorId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active, inert, interactionMode])

  const anchorPoint = plan.controls[0] ?? null
  const endpoint = plan.controls.length >= 2 ? plan.controls.at(-1) : null
  const viaPoints = useMemo(
    () => plan.controls.length > 2 ? plan.controls.slice(1, -1) : [],
    [plan.controls],
  )
  const directSectionCount = plan.controls
    .slice(0, -1)
    .filter(({ id }) => getLegMode(plan.legModes, id) === directLegMode)
    .length
  const exportProblems = getRouteExportProblems(plan, effectivePreview)

  const waypointDetails = useMemo(() => {
    return buildCreateWaypointDetails(viaPoints, plan, effectivePreview.segments)
  }, [effectivePreview.segments, plan, viaPoints])

  const waypointCardLabels = useMemo(() => ({
    close: labels.closeWaypointCard,
    distance: labels.waypointDistance,
    elevation: labels.waypointElevation,
    incomingOffGridSegment: labels.incomingDirect,
    notAvailable: labels.notAvailable,
    outgoingOffGridSegment: labels.outgoingDirect,
    remove: labels.remove,
    title: `${labels.waypoint} {number}`,
  }), [labels])

  function commit(updater, nextMessage = '') {
    setHistory((current) => commitRouteHistory(current, updater(current.present)))
    setExportError('')
    if (nextMessage) {
      setMessage(nextMessage)
    }
  }

  function handleMapClick(latlng) {
    const coordinate = { lat: latlng.lat, lon: latlng.lng }
    try {
      if (interactionMode === 'place-start') {
        commit((current) => appendRouteControl(current, coordinate))
        setInteractionMode('place-finish')
        setMessage(labels.clickFinish)
        return
      }
      if (interactionMode === 'place-finish') {
        fitAfterRoutingRef.current = true
        commit((current) => appendRouteControl(current, coordinate), labels.routePlaced)
        setInteractionMode('inspect')
        return
      }
      if (interactionMode === 'add-waypoint') {
        const segment = findNearestRouteSegment(coordinate, effectivePreview.segments)
        if (!segment) {
          return
        }
        commit(
          (current) => insertRouteControl(current, segment.insertAfterId, coordinate, {
            incomingMode: segment.mode,
            outgoingMode: segment.mode,
          }),
          labels.pointAdded,
        )
        setInteractionMode('inspect')
        return
      }
      if (interactionMode === 'extend-route') {
        fitAfterRoutingRef.current = true
        commit((current) => appendRouteControl(current, coordinate), labels.pointAdded)
        setInteractionMode('inspect')
        return
      }
      if (interactionMode === 'trace-direct') {
        const controlId = `route-point-${crypto.randomUUID()}`
        commit(
          (current) => appendRouteControl(current, coordinate, {
            id: controlId,
            incomingMode: directLegMode,
          }),
          labels.pointAdded,
        )
        setTraceAnchorId(controlId)
        return
      }
      if (interactionMode === 'move-control' && activeControlId) {
        commit((current) => replaceRouteControl(current, activeControlId, coordinate), labels.pointMoved)
        setActiveControlId(null)
        setInteractionMode('inspect')
      }
    }
    catch (error) {
      setExportError(error instanceof Error ? error.message : labels.error)
    }
  }

  function addNextControlByCoordinates(coordinate) {
    try {
      if (plan.controls.length === 0) {
        commit((current) => appendRouteControl(current, coordinate))
        setInteractionMode('place-finish')
        setMessage(labels.clickFinish)
      }
      else if (plan.controls.length === 1) {
        fitAfterRoutingRef.current = true
        commit((current) => appendRouteControl(current, coordinate), labels.routePlaced)
        setInteractionMode('inspect')
      }
      else {
        fitAfterRoutingRef.current = true
        commit((current) => appendRouteControl(current, coordinate), labels.pointAdded)
        setInteractionMode('inspect')
      }
    }
    catch (error) {
      setExportError(error instanceof Error ? error.message : labels.error)
    }
  }

  function handleRouteSegmentClick(segment, latlng) {
    if (interactionMode !== 'inspect') {
      return
    }
    commit(
      (current) => insertRouteControl(
        current,
        segment.insertAfterId,
        { lat: latlng.lat, lon: latlng.lng },
        { incomingMode: segment.mode, outgoingMode: segment.mode },
      ),
      labels.pointAdded,
    )
  }

  function moveControl(controlId, latlng) {
    commit(
      (current) => replaceRouteControl(current, controlId, { lat: latlng.lat, lon: latlng.lng }),
      labels.pointMoved,
    )
  }

  function toggleLeg(fromControlId) {
    commit((current) => setRouteLegMode(
      current,
      fromControlId,
      getLegMode(current.legModes, fromControlId) === directLegMode
        ? routedLegMode
        : directLegMode,
    ))
  }

  function clearRoute() {
    if (plan.controls.length && !window.confirm(labels.clearConfirm)) {
      return
    }
    setHistory(createRouteHistory(createRoutePlan({ name: labels.newRoute })))
    setPreview({ ...emptyRoutePreview })
    setInteractionMode('place-start')
    setActiveControlId(null)
    setTraceAnchorId(null)
    setMessage(labels.clickStart)
    setExportError('')
  }

  async function refreshProjects(status = '') {
    setProjectsLoading(true)
    setProjectsError('')
    try {
      setProjects(await listProjects({ projectType: 'route', includeArchived: true }))
      setProjectsStatus(status)
    }
    catch (error) {
      setProjectsError(error instanceof Error ? error.message : labels.projectsUnavailable)
      throw error
    }
    finally {
      setProjectsLoading(false)
    }
  }

  async function createProjectFromCurrent({ copy = false } = {}) {
    const projectName = copy
      ? formatCreateRouteCopy(labels.copyOfProject, { name: planRef.current.name })
      : planRef.current.name
    const projectPlan = setRouteName(planRef.current, projectName)
    projectAssociationTokenRef.current += 1
    const associationToken = projectAssociationTokenRef.current
    projectSaveGenerationRef.current += 1
    if (pendingProjectSaveTimerRef.current !== null) {
      window.clearTimeout(pendingProjectSaveTimerRef.current)
      pendingProjectSaveTimerRef.current = null
    }
    setProjectSaveStatus({ kind: 'saving', message: '' })
    try {
      const created = await createProject({
        projectType: 'route',
        name: projectName,
        origin: 'route-planner',
        document: projectPlan,
      })
      if (projectAssociationTokenRef.current !== associationToken) {
        return created
      }
      currentProjectRef.current = created.metadata
      lastSavedProjectDocumentRef.current = serializeProjectDocument(created.document)
      setCurrentProject(created.metadata)
      if (copy) {
        setHistory((current) => ({
          ...current,
          present: setRouteName(current.present, projectName),
        }))
      }
      setProjectSaveStatus({ kind: 'saved', message: '' })
      await refreshProjects(labels.projectCreated).catch(() => {})
      return created
    }
    catch (error) {
      if (projectAssociationTokenRef.current === associationToken) {
        setProjectSaveStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : labels.projectSaveFailed,
        })
      }
      throw error
    }
  }

  async function flushCurrentProject() {
    if (pendingProjectSaveTimerRef.current !== null) {
      window.clearTimeout(pendingProjectSaveTimerRef.current)
      pendingProjectSaveTimerRef.current = null
    }
    await projectSaveChainRef.current.catch(() => {})
    const project = currentProjectRef.current
    if (!project?.id) {
      return true
    }
    if (project.unverified || project.conflict) {
      throw new Error(project.conflict ? labels.projectConflict : labels.projectSaveFailed)
    }
    const latestPlan = planRef.current
    const serializedDocument = serializeProjectDocument(latestPlan)
    if (
      serializedDocument === lastSavedProjectDocumentRef.current &&
      project.name === latestPlan.name
    ) {
      return true
    }

    setProjectSaveStatus({ kind: 'saving', message: '' })
    try {
      const saved = await saveProject(project.id, latestPlan, {
        expectedRevision: project.revision,
        name: latestPlan.name,
      })
      currentProjectRef.current = saved.metadata
      lastSavedProjectDocumentRef.current = serializedDocument
      setCurrentProject(saved.metadata)
      setProjectSaveStatus({ kind: 'saved', message: '' })
      return true
    }
    catch (error) {
      if (isProjectStoreError(error, 'REVISION_CONFLICT')) {
        const conflicted = { ...project, conflict: true }
        currentProjectRef.current = conflicted
        setCurrentProject(conflicted)
      }
      setProjectSaveStatus({
        kind: isProjectStoreError(error, 'REVISION_CONFLICT') ? 'conflict' : 'error',
        message: isProjectStoreError(error, 'REVISION_CONFLICT')
          ? labels.projectConflict
          : error instanceof Error
            ? error.message
            : labels.projectSaveFailed,
      })
      throw error
    }
  }

  async function canReplaceCurrentRoute() {
    if (currentProjectRef.current?.id) {
      try {
        await flushCurrentProject()
        return true
      }
      catch (error) {
        setProjectsError(error instanceof Error ? error.message : labels.projectSaveFailed)
        return false
      }
    }
    const latestPlan = planRef.current
    const hasLocalWork = latestPlan.controls.length > 0 || latestPlan.name !== labels.newRoute
    return !hasLocalWork || window.confirm(labels.replaceLocalConfirm)
  }

  function openProjectInEditor(project) {
    const nextPlan = normalizeRouteProjectDocument(project.document, project.metadata.name)
    setHistory(createRouteHistory(nextPlan))
    setPreview({ ...emptyRoutePreview })
    restoredPreviewRef.current = false
    setInteractionMode(nextPlan.controls.length === 0
      ? 'place-start'
      : nextPlan.controls.length === 1
        ? 'place-finish'
        : 'inspect')
    setActiveControlId(null)
    setTraceAnchorId(null)
    setMessage(labels.projectOpened)
    setExportError('')
    projectAssociationTokenRef.current += 1
    projectSaveGenerationRef.current += 1
    currentProjectRef.current = project.metadata
    setCurrentProject(project.metadata)
    lastSavedProjectDocumentRef.current = serializeProjectDocument(nextPlan)
    setProjectSaveStatus({ kind: 'saved', message: '' })
    setFitRequest((current) => current + 1)
  }

  async function handleNewProject() {
    if (!await canReplaceCurrentRoute()) {
      return
    }
    const nextPlan = createRoutePlan({ name: labels.newRoute })
    setHistory(createRouteHistory(nextPlan))
    setPreview({ ...emptyRoutePreview })
    setInteractionMode('place-start')
    setActiveControlId(null)
    setTraceAnchorId(null)
    setMessage(labels.clickStart)
    projectAssociationTokenRef.current += 1
    projectSaveGenerationRef.current += 1
    currentProjectRef.current = null
    setCurrentProject(null)
    lastSavedProjectDocumentRef.current = null
    setProjectSaveStatus({ kind: 'local', message: '' })
    await setLastActiveProjectId('route', null).catch(() => {})
    onProjectLibraryClose()
  }

  async function handleOpenProject(projectMetadata) {
    if (projectMetadata.id === currentProjectRef.current?.id) {
      onProjectLibraryClose()
      return
    }
    if (!await canReplaceCurrentRoute()) {
      return
    }
    const project = await loadProject(projectMetadata.id)
    openProjectInEditor(project)
    await setLastActiveProjectId('route', project.metadata.id).catch(() => {})
    onProjectLibraryClose()
  }

  async function handleRenameProject(projectMetadata, nextName) {
    try {
      let sourceDocument
      let expectedRevision = projectMetadata.revision
      if (projectMetadata.id === currentProjectRef.current?.id) {
        await flushCurrentProject()
        sourceDocument = planRef.current
        expectedRevision = currentProjectRef.current.revision
      }
      else {
        const source = await loadProject(projectMetadata.id)
        sourceDocument = source.document
        expectedRevision = source.metadata.revision
      }
      const renamedPlan = normalizeRouteProjectDocument(sourceDocument, nextName)
      const saved = await saveProject(projectMetadata.id, renamedPlan, {
        expectedRevision,
        name: nextName,
      })
      if (projectMetadata.id === currentProjectRef.current?.id) {
        currentProjectRef.current = saved.metadata
        setCurrentProject(saved.metadata)
        lastSavedProjectDocumentRef.current = serializeProjectDocument(saved.document)
        setHistory((current) => ({
          ...current,
          present: setRouteName(current.present, nextName),
        }))
        setProjectSaveStatus({ kind: 'saved', message: '' })
      }
      await refreshProjects(labels.projectRenamed).catch(() => {})
    }
    catch (error) {
      await recoverLibraryMutation(error)
    }
  }

  async function handleDuplicateProject(projectMetadata) {
    let sourceMetadata
    let sourceDocument
    if (projectMetadata.id === currentProjectRef.current?.id) {
      await flushCurrentProject()
      sourceMetadata = currentProjectRef.current
      sourceDocument = planRef.current
    }
    else {
      const source = await loadProject(projectMetadata.id)
      sourceMetadata = source.metadata
      sourceDocument = source.document
    }
    const copyName = formatCreateRouteCopy(labels.copyOfProject, { name: sourceMetadata.name })
    await createProject({
      projectType: 'route',
      name: copyName,
      origin: 'route-planner',
      document: normalizeRouteProjectDocument(sourceDocument, copyName),
    })
    await setLastActiveProjectId('route', currentProjectRef.current?.id ?? null).catch(() => {})
    await refreshProjects(labels.projectDuplicated).catch(() => {})
  }

  async function handleArchiveProject(projectMetadata) {
    try {
      let revision = projectMetadata.revision
      if (projectMetadata.id === currentProjectRef.current?.id) {
        await flushCurrentProject()
        revision = currentProjectRef.current.revision
      }
      await archiveProject(projectMetadata.id, { expectedRevision: revision })
      if (projectMetadata.id === currentProjectRef.current?.id) {
        projectAssociationTokenRef.current += 1
        projectSaveGenerationRef.current += 1
        currentProjectRef.current = null
        setCurrentProject(null)
        lastSavedProjectDocumentRef.current = null
        setProjectSaveStatus({ kind: 'local', message: '' })
        await setLastActiveProjectId('route', null).catch(() => {})
      }
      await refreshProjects(labels.projectArchived).catch(() => {})
    }
    catch (error) {
      await recoverLibraryMutation(error)
    }
  }

  async function handleRestoreProject(projectMetadata) {
    try {
      await restoreProject(projectMetadata.id, { expectedRevision: projectMetadata.revision })
      await refreshProjects(labels.projectRestored).catch(() => {})
    }
    catch (error) {
      await recoverLibraryMutation(error)
    }
  }

  async function handleDeleteProject(projectMetadata) {
    try {
      await deleteProject(projectMetadata.id, { expectedRevision: projectMetadata.revision })
      await refreshProjects(labels.projectDeleted).catch(() => {})
    }
    catch (error) {
      await recoverLibraryMutation(error)
    }
  }

  async function recoverLibraryMutation(error) {
    if (isProjectStoreError(error, 'REVISION_CONFLICT')) {
      await refreshProjects().catch(() => {})
      throw new Error(labels.projectConflict, { cause: error })
    }
    throw error
  }

  async function reloadConflictedProject() {
    if (
      !currentProjectRef.current?.id ||
      currentProjectRef.current.archivedAt !== null
    ) {
      return
    }
    setProjectTransitioning(true)
    try {
      const project = await loadProject(currentProjectRef.current.id)
      openProjectInEditor(project)
    }
    catch (error) {
      setProjectSaveStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : labels.projectSaveFailed,
      })
    }
    finally {
      setProjectTransitioning(false)
    }
  }

  async function retryUnverifiedProjectAssociation() {
    const unverifiedProject = currentProjectRef.current
    if (!unverifiedProject?.id || !unverifiedProject.unverified) {
      return
    }
    setProjectSaveStatus({ kind: 'loading', message: '' })
    try {
      const project = await loadProject(unverifiedProject.id)
      const restoredProject = reconcileRouteProjectRevision(
        project.metadata,
        unverifiedProject.baseRevision ?? unverifiedProject.revision,
        planRef.current,
        project.document,
      )
      currentProjectRef.current = restoredProject
      setCurrentProject(restoredProject)
      lastSavedProjectDocumentRef.current = serializeProjectDocument(project.document)
      setProjectSaveStatus(restoredProject.conflict
        ? { kind: 'conflict', message: labels.projectConflict }
        : { kind: 'saved', message: '' })
    }
    catch (error) {
      setProjectSaveStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : labels.projectSaveFailed,
      })
    }
  }

  async function saveConflictedProjectAsCopy() {
    try {
      await createProjectFromCurrent({ copy: true })
    }
    catch {
      // createProjectFromCurrent already preserves the route and reports the error.
    }
  }

  async function retryProjectSave() {
    if (currentProjectRef.current?.unverified) {
      await retryUnverifiedProjectAssociation()
      return
    }
    try {
      await flushCurrentProject()
    }
    catch {
      // flushCurrentProject keeps the current route and reports the storage error.
    }
  }

  function retryDraftHydration() {
    setHydrationAttempt((current) => current + 1)
  }

  function resetDamagedDraftLock() {
    if (!window.confirm(labels.resetDraftLockConfirm)) {
      return
    }
    const result = clearRecoverableRouteDraftLease()
    if (result.cleared) {
      setHydrationAttempt((current) => current + 1)
    }
  }

  function reloadDraftAfterLockConflict() {
    lockRecoverySnapshotRef.current = null
    lockRecoveryConflictRef.current = null
    hasHydratedRef.current = false
    setHydrationAttempt((current) => current + 1)
  }

  async function keepLocalDraftAfterLockConflict() {
    const conflict = lockRecoveryConflictRef.current
    if (
      !conflict ||
      !draftLockRef.current?.isHeld() ||
      !window.confirm(labels.keepLocalDraftConfirm)
    ) {
      return
    }
    setHydrationStatus('loading')
    setHydrationError(null)
    try {
      await quarantineRouteDraft('ROUTE_DRAFT_LOCK_CONFLICT')
      const metadata = createRouteDraftSnapshotMetadata(draftSnapshotClock)
      const rebasedLocal = { ...conflict.local, ...metadata }
      saveRouteDraftJournal(rebasedLocal.plan, rebasedLocal.session, { metadata })
      draftJournalHealthyRef.current = true
      latestDraftRef.current = rebasedLocal
      lockRecoverySnapshotRef.current = null
      lockRecoveryConflictRef.current = null
      lastSavedDraftRef.current = null
      lastSavedDraftAtRef.current = null
      pendingDraftSaveRef.current = null
      hasHydratedRef.current = true
      setHydrationStatus('ready')
    }
    catch {
      setHydrationError(new Error(labels.draftPreserveFailed))
      setHydrationStatus('blocked')
    }
  }

  async function preserveDraftAndStartFresh() {
    if (!draftLockRef.current?.isHeld() || !window.confirm(labels.preserveDraftConfirm)) {
      return
    }
    setHydrationStatus('loading')
    setHydrationError(null)
    try {
      const journalDraft = hydrationJournalDraftRef.current
      await quarantineRouteDraft('UNREADABLE_ROUTE_DRAFT', { journalDraft })
      if (journalDraft && !clearRouteDraftJournalIfMatching(journalDraft)) {
        throw new Error(labels.draftPreserveFailed)
      }
      hydrationJournalDraftRef.current = null
      const nextPlan = createRoutePlan({ name: labels.newRoute })
      setHistory(createRouteHistory(nextPlan))
      setPreview({ ...emptyRoutePreview })
      restoredPreviewRef.current = false
      setInteractionMode('place-start')
      setActiveControlId(null)
      setTraceAnchorId(null)
      setMessage(labels.clickStart)
      setExportError('')
      currentProjectRef.current = null
      setCurrentProject(null)
      lastSavedProjectDocumentRef.current = null
      setProjectSaveStatus({ kind: 'local', message: '' })
      lastSavedDraftRef.current = null
      lastSavedDraftAtRef.current = null
      latestDraftRef.current = null
      hasHydratedRef.current = false
      setHydrationAttempt((current) => current + 1)
    }
    catch {
      setHydrationError(new Error(labels.draftPreserveFailed))
      setHydrationStatus('blocked')
    }
  }

  function exportRoute() {
    if (exportProblems.length) {
      setExportError(exportProblems[0])
      return
    }
    try {
      const content = buildPlannedRouteGpx({
        name: plan.name,
        profile: plan.profile,
        geometry: effectivePreview.geometry,
      })
      const blob = new Blob([content], { type: 'application/gpx+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sanitizeFilename(plan.name)}.gpx`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage(labels.exported)
      setExportError('')
    }
    catch (error) {
      setExportError(error instanceof Error ? error.message : labels.error)
    }
  }

  const banner = getInteractionBanner(interactionMode, labels)
  const failedFromIndex = plan.controls.findIndex(({ id }) => id === effectivePreview.failedLegId)
  const failedToIndex = plan.controls.findIndex(({ id }) => id === effectivePreview.failedToControlId)
  const projectStatusText = {
    local: labels.localDraft,
    loading: labels.projectLoading,
    dirty: labels.projectDirty,
    saving: labels.projectSaving,
    saved: labels.projectSaved,
    error: labels.projectSaveFailed,
    conflict: labels.projectConflictStatus,
  }[projectSaveStatus.kind] ?? labels.localDraft
  const hydrationBlockedByWriter = [
    'ROUTE_DRAFT_LOCK_UNAVAILABLE',
    'ROUTE_DRAFT_LOCK_LOST',
  ].includes(hydrationError?.code)
  const hydrationHasContentConflict = hydrationError?.code === 'ROUTE_DRAFT_CONTENT_CONFLICT'
  const hydrationJournalBlocked = hydrationError?.name === 'RouteDraftJournalError'

  return (
    <>
    <section
      aria-hidden={!active || inert || projectTransitioning ? 'true' : undefined}
      aria-busy={hydrationStatus === 'loading' || projectTransitioning}
      className="workspace create-workspace"
      hidden={!active}
      inert={!active || inert || projectTransitioning ? true : undefined}
    >
      {hydrationStatus === 'loading' ? (
        <div className="create-hydration-status" role="status">{labels.draftLoading}</div>
      ) : hydrationStatus === 'blocked' ? (
        <div className="create-hydration-status create-hydration-blocked" role="alert">
          <strong>{hydrationHasContentConflict
            ? labels.draftChangedElsewhere
            : hydrationBlockedByWriter
              ? labels.draftWriterBlocked
              : labels.draftLoadFailed}</strong>
          <p>{hydrationBlockedByWriter ? labels.draftLoadFailed : labels.draftSaveFailed}</p>
          <div className="draft-actions">
            {hydrationHasContentConflict ? (
              <>
                <button type="button" className="ghost-button" onClick={reloadDraftAfterLockConflict}>
                  {labels.reloadSavedDraft}
                </button>
                <button type="button" className="primary-button" onClick={keepLocalDraftAfterLockConflict}>
                  {labels.keepLocalDraft}
                </button>
              </>
            ) : (
              <button type="button" className="primary-button" onClick={retryDraftHydration}>
                {labels.retryDraftLoad}
              </button>
            )}
            {!hydrationBlockedByWriter && !hydrationHasContentConflict && !hydrationJournalBlocked ? (
              <button type="button" className="ghost-button" onClick={preserveDraftAndStartFresh}>
                {labels.preserveAndStartFresh}
              </button>
            ) : null}
            {hydrationError?.lockReason === 'corrupt-lease' ? (
              <button type="button" className="ghost-button" onClick={resetDamagedDraftLock}>
                {labels.resetDraftLock}
              </button>
            ) : null}
            {!exportProblems.length ? (
              <button type="button" className="ghost-button" onClick={exportRoute}>
                {labels.exportRoute}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
      <aside className="sidebar create-sidebar" aria-label={labels.newRoute}>
        <section className="panel create-summary" aria-busy={effectivePreview.status === 'loading'}>
          <div className="panel-header">
            <h2>{labels.routeSummary}</h2>
            <span className={`route-status route-status-${effectivePreview.status}`}>{labels[effectivePreview.status] ?? labels.empty}</span>
          </div>
          <label className="field-label">
            <span>{labels.routeName}</span>
            <RouteNameEditor
              key={plan.name}
              name={plan.name}
              onCommit={(name) => setHistory((current) => ({
                ...current,
                present: setRouteName(current.present, name),
              }))}
            />
          </label>
          <label className="field-label">
            <span>{labels.activity}</span>
            <select
              value={plan.profile}
              onChange={(event) => commit((current) => setRouteProfile(current, event.target.value))}
            >
              <option value="cycling">{labels.cycling}</option>
              <option value="walking">{labels.walking}</option>
            </select>
          </label>
          <dl className="stats-grid create-stats">
            <div><dt>{labels.distance}</dt><dd>{formatDistance(effectivePreview.distanceMeters)}</dd></div>
            <div><dt>{labels.routePoints}</dt><dd>{plan.controls.length}</dd></div>
            <div><dt>{labels.directSections}</dt><dd>{directSectionCount}</dd></div>
            <div><dt>{labels.routingStatus}</dt><dd>{labels[effectivePreview.status] ?? labels.empty}</dd></div>
          </dl>
          <div className="project-association-status" aria-live="polite">
            <strong>{currentProject?.name ?? labels.localDraft}</strong>
            <span>{projectStatusText}</span>
          </div>
          {!currentProject ? (
            <button
              type="button"
              className="ghost-button save-project-button"
              onClick={() => createProjectFromCurrent().catch(() => {})}
            >
              {labels.saveToProjects}
            </button>
          ) : null}
          {projectSaveStatus.kind === 'error' ? (
            <div className="project-save-problem" role="alert">
              <p>{projectSaveStatus.message || labels.projectSaveFailed}</p>
              <div className="draft-actions">
                <button type="button" className="ghost-button" onClick={retryProjectSave}>{labels.retryProjectSave}</button>
                <button type="button" className="primary-button" onClick={saveConflictedProjectAsCopy}>{labels.saveAsCopy}</button>
              </div>
            </div>
          ) : null}
          {projectSaveStatus.kind === 'conflict' ? (
            <div className="project-save-problem" role="alert">
              <p>{projectSaveStatus.message || labels.projectConflict}</p>
              <div className="draft-actions">
                {currentProject?.archivedAt === null ? (
                  <button type="button" className="ghost-button" onClick={reloadConflictedProject}>{labels.reloadSavedProject}</button>
                ) : null}
                <button type="button" className="primary-button" onClick={saveConflictedProjectAsCopy}>{labels.saveAsCopy}</button>
              </div>
            </div>
          ) : null}
          {draftStatus.kind === 'saved' ? (
            <p className="draft-saved create-draft-status" aria-live="polite">{labels.draftSaved}</p>
          ) : null}
          {draftStatus.kind === 'dirty' ? (
            <p className="muted-text create-draft-status" aria-live="polite">{labels.draftDirty}</p>
          ) : null}
          {draftStatus.kind === 'saving' ? (
            <p className="muted-text create-draft-status" aria-live="polite">{labels.draftSaving}</p>
          ) : null}
          {draftStatus.kind === 'error' ? (
            <p className="error-text create-draft-status" role="alert">{labels.draftSaveFailed}</p>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-header"><h2>{labels.buildRoute}</h2></div>
          <div className="create-action-grid">
            {plan.controls.length === 0 ? (
              <button type="button" className="primary-button" onClick={() => setInteractionMode('place-start')}>
                {labels.placeStart}
              </button>
            ) : null}
            {plan.controls.length === 1 ? (
              <button type="button" className="primary-button" onClick={() => setInteractionMode('place-finish')}>
                {labels.placeFinish}
              </button>
            ) : null}
            <button type="button" className="ghost-button" disabled={plan.controls.length < 2 || effectivePreview.status !== 'ready'} onClick={() => setInteractionMode('add-waypoint')}>
              {labels.addWaypoint}
            </button>
            <button type="button" className="ghost-button" disabled={plan.controls.length < 2} onClick={() => setInteractionMode('extend-route')}>
              {labels.extendRoute}
            </button>
            <button
              type="button"
              className={interactionMode === 'trace-direct' ? 'primary-button' : 'ghost-button'}
              disabled={plan.controls.length < 1}
              onClick={() => {
                if (interactionMode === 'trace-direct') {
                  setInteractionMode('inspect')
                  setTraceAnchorId(null)
                }
                else {
                  setTraceAnchorId(plan.controls.at(-1)?.id ?? null)
                  setInteractionMode('trace-direct')
                }
              }}
            >
              {interactionMode === 'trace-direct' ? labels.finishOffGrid : labels.drawOffGrid}
            </button>
            <button type="button" className="ghost-button" disabled={plan.controls.length < 2} onClick={() => commit(reverseRoutePlan, labels.routeReversed)}>
              {labels.reverseRoute}
            </button>
            <button type="button" className="ghost-button" disabled={plan.controls.length < 2} onClick={() => {
              fitAfterRoutingRef.current = true
              commit(closeRouteLoop, labels.loopAdded)
            }}>
              {labels.returnToStart}
            </button>
            <button type="button" className="ghost-button" disabled={!history.past.length} onClick={() => setHistory(undoRouteHistory)}>{labels.undo}</button>
            <button type="button" className="ghost-button" disabled={!history.future.length} onClick={() => setHistory(redoRouteHistory)}>{labels.redo}</button>
            <button type="button" className="ghost-button danger-button" disabled={!plan.controls.length} onClick={clearRoute}>{labels.clearRoute}</button>
          </div>
          <CoordinatePlacementForm
            labels={labels}
            nextRole={plan.controls.length === 0
              ? labels.start
              : plan.controls.length === 1
                ? labels.finish
                : labels.newFinish}
            onSubmit={addNextControlByCoordinates}
          />
          {traceAnchorId ? <p className="muted-text">{labels.clickDirect}</p> : null}
        </section>

        {plan.controls.length ? (
          <section className="panel">
            <div className="panel-header"><h2>{labels.routePoints}</h2><span>{plan.controls.length}</span></div>
            <ol className="route-point-list">
              {plan.controls.map((control, index) => (
                <RoutePointEditor
                  control={control}
                  index={index}
                  key={`${control.id}-${control.lat}-${control.lon}`}
                  labels={labels}
                  legMode={index < plan.controls.length - 1 ? getLegMode(plan.legModes, control.id) : null}
                  onMoveOnMap={() => {
                    setActiveControlId(control.id)
                    setInteractionMode('move-control')
                  }}
                  onRemove={() => commit((current) => removeRouteControl(current, control.id))}
                  onSubmit={(coordinate) => commit((current) => replaceRouteControl(current, control.id, coordinate), labels.pointMoved)}
                  onLegModeChange={(mode) => commit((current) => setRouteLegMode(current, control.id, mode))}
                  role={getControlRole(index, plan.controls.length, labels)}
                />
              ))}
            </ol>
          </section>
        ) : null}

        <section className="panel create-export-panel">
          <div className="panel-header"><h2>{labels.exportTitle}</h2></div>
          <p className="muted-text">{labels.exportHelp}</p>
          {directSectionCount ? (
            <p className="note note-warning">{formatCreateRouteCopy(labels.directWarning, { count: directSectionCount })}</p>
          ) : null}
          <button type="button" className="primary-button" disabled={Boolean(exportProblems.length)} onClick={exportRoute}>
            {labels.exportRoute}
          </button>
        </section>
      </aside>

      <div className="map-panel create-map-panel" aria-label={labels.mapRegion} role="region">
        <div className="map-layer-switch" role="group" aria-label={labels.mapLayer}>
          <button type="button" aria-pressed={mapLayer === 'scheme'} className={mapLayer === 'scheme' ? 'map-layer-button-active' : ''} onClick={() => onMapLayerChange('scheme')}>{labels.schemeLayer}</button>
          <button type="button" aria-pressed={mapLayer === 'satellite'} className={mapLayer === 'satellite' ? 'map-layer-button-active' : ''} onClick={() => onMapLayerChange('satellite')}>{labels.satelliteLayer}</button>
        </div>
        {banner ? <div className="map-mode-banner" role="status" aria-live="polite">{banner}</div> : null}
        <div className="create-map-status" aria-live="polite" title={message || undefined}>{message}</div>
        {effectivePreview.status === 'error' ? (
          <div className="create-routing-error" role="alert">
            <strong>{failedFromIndex >= 0 && failedToIndex >= 0
              ? formatCreateRouteCopy(labels.failedSection, { from: failedFromIndex + 1, to: failedToIndex + 1 })
              : effectivePreview.error}</strong>
            <div className="draft-actions">
              <button type="button" className="ghost-button" onClick={() => setRetryRequest((current) => current + 1)}>{labels.retryRouting}</button>
              {effectivePreview.failedLegId ? (
                <button type="button" className="primary-button" onClick={() => commit((current) => setRouteLegMode(current, effectivePreview.failedLegId, directLegMode))}>
                  {labels.useDirectForFailed}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {exportError ? <div className="create-export-error" role="alert">{exportError}</div> : null}
        {active ? <TrackMap
          activeWaypointId={activeControlId}
          anchorDraggable
          anchorLabel={labels.start}
          anchorPoint={anchorPoint}
          enableWaypointDoubleClickRemove={false}
          endpoint={endpoint}
          endpointLabel={labels.finish}
          fitRequest={fitRequest}
          highlightedTrackPoints={[]}
          initialView={initialView}
          interactionMode={interactionMode}
          layoutSignature={`create-${active}-${plan.controls.length}`}
          manualMiddleStartLabel=""
          manualMiddleStartPoint={null}
          mapLayer={mapLayer}
          offGridLabel={labels.direct}
          onAnchorMove={(latlng) => moveControl(anchorPoint.id, latlng)}
          onEndpointMove={(latlng) => moveControl(endpoint.id, latlng)}
          onMapClick={handleMapClick}
          onRouteSegmentClick={handleRouteSegmentClick}
          onTrackClick={() => {}}
          onWaypointIncomingModeToggle={toggleLeg}
          onWaypointMove={moveControl}
          onWaypointOutgoingModeToggle={toggleLeg}
          onWaypointRemove={(id) => commit((current) => removeRouteControl(current, id))}
          onWaypointSelect={setActiveControlId}
          rebuildDirection="create"
          routeSegments={effectivePreview.segments ?? []}
          selectedCutPoint={null}
          selectedCutPointLabel=""
          sourceTrack={null}
          suspiciousSegments={[]}
          track={null}
          viaPoints={viaPoints}
          waypointCardLabels={waypointCardLabels}
          waypointDetails={waypointDetails}
          waypointLabel={labels.waypoint}
        /> : null}
      </div>
        </>
      )}
    </section>
    {projectLibraryOpen && hydrationStatus === 'ready' && typeof document !== 'undefined'
      ? createPortal(
          <div className={`project-library-theme theme-${document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}`}>
          <ProjectLibraryDialog
            currentProjectId={currentProject?.id ?? null}
            error={projectsError}
            language={language}
            loading={projectsLoading}
            onArchive={handleArchiveProject}
            onClose={onProjectLibraryClose}
            onDelete={handleDeleteProject}
            onDuplicate={handleDuplicateProject}
            onNew={handleNewProject}
            onOpen={handleOpenProject}
            onRename={handleRenameProject}
            onRestore={handleRestoreProject}
            open={projectLibraryOpen}
            projects={projects}
            status={projectsStatus}
          />
          </div>,
          document.body,
        )
      : null}
    </>
  )
}

function RouteNameEditor({ name, onCommit }) {
  const [draftName, setDraftName] = useState(name)

  function commitName() {
    onCommit(draftName)
  }

  return (
    <input
      maxLength="120"
      value={draftName}
      onBlur={commitName}
      onChange={(event) => setDraftName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
        else if (event.key === 'Escape') {
          setDraftName(name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function CoordinatePlacementForm({ labels, nextRole, onSubmit }) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')

  return (
    <form
      className="coordinate-placement-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ lat: Number(latitude), lon: Number(longitude) })
        setLatitude('')
        setLongitude('')
      }}
    >
      <strong>{formatCreateRouteCopy(labels.addByCoordinates, { role: nextRole })}</strong>
      <div className="coordinate-grid">
        <label><span>{labels.latitude}</span><input type="number" min="-90" max="90" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
        <label><span>{labels.longitude}</span><input type="number" min="-180" max="180" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
      </div>
      <button type="submit" className="ghost-button">{labels.addCoordinatePoint}</button>
    </form>
  )
}

function serializeDraftSnapshot({ plan, session, preview }) {
  return JSON.stringify({ plan, session, preview })
}

function serializeProjectDocument(document) {
  return JSON.stringify(document)
}

function buildCreateWaypointDetails(viaPoints, plan, segments = []) {
  const details = []
  let cumulativeDistance = 0
  for (let index = 0; index < viaPoints.length; index += 1) {
    const point = viaPoints[index]
    const controlIndex = index + 1
    const incomingLegId = plan.controls[controlIndex - 1].id
    const segmentDistance = segments[controlIndex - 1]?.distanceMeters
    cumulativeDistance = Number.isFinite(cumulativeDistance) && Number.isFinite(segmentDistance)
      ? cumulativeDistance + segmentDistance
      : null
    const isIncomingOffGrid = getLegMode(plan.legModes, incomingLegId) === directLegMode
    const isOutgoingOffGrid = getLegMode(plan.legModes, point.id) === directLegMode
    details.push({
      ...point,
      distanceMeters: cumulativeDistance,
      elevation: null,
      incomingLegId,
      isIncomingOffGrid,
      isOffGrid: isIncomingOffGrid || isOutgoingOffGrid,
      isOutgoingOffGrid,
      outgoingLegId: point.id,
      number: controlIndex + 1,
    })
  }
  return details
}


function RoutePointEditor({
  control,
  index,
  labels,
  legMode,
  onLegModeChange,
  onMoveOnMap,
  onRemove,
  onSubmit,
  role,
}) {
  const [latitude, setLatitude] = useState(String(control.lat))
  const [longitude, setLongitude] = useState(String(control.lon))

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit({ lat: Number(latitude), lon: Number(longitude) })
  }

  return (
    <li className="route-point-item">
      <form onSubmit={handleSubmit}>
        <div className="route-point-heading"><strong>{index + 1}. {role}</strong><code>{control.id.slice(-8)}</code></div>
        <div className="coordinate-grid">
          <label><span>{labels.latitude}</span><input type="number" min="-90" max="90" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
          <label><span>{labels.longitude}</span><input type="number" min="-180" max="180" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
        </div>
        {legMode ? (
          <label className="field-label compact-field">
            <span>{labels.outgoingLeg}</span>
            <select value={legMode} onChange={(event) => onLegModeChange(event.target.value)}>
              <option value={routedLegMode}>{labels.routed}</option>
              <option value={directLegMode}>{labels.direct}</option>
            </select>
          </label>
        ) : null}
        <div className="route-point-actions">
          <button type="submit" className="ghost-button">{labels.updateCoordinates}</button>
          <button type="button" className="ghost-button" onClick={onMoveOnMap}>{labels.moveOnMap}</button>
          <button type="button" className="ghost-button danger-button" onClick={onRemove}>{labels.remove}</button>
        </div>
      </form>
    </li>
  )
}

function getControlRole(index, count, labels) {
  if (index === 0) {
    return labels.start
  }
  if (index === count - 1) {
    return labels.finish
  }
  return labels.waypoint
}

function getInteractionBanner(mode, labels) {
  return {
    'place-start': labels.clickStart,
    'place-finish': labels.clickFinish,
    'add-waypoint': labels.clickWaypoint,
    'extend-route': labels.clickExtend,
    'trace-direct': labels.clickDirect,
    'move-control': labels.clickMove,
  }[mode] ?? ''
}

function findNearestRouteSegment(point, segments = []) {
  let nearest = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    for (let index = 0; index < segment.geometry.length - 1; index += 1) {
      const distance = distanceToLineSquared(point, segment.geometry[index], segment.geometry[index + 1])
      if (distance < nearestDistance) {
        nearest = segment
        nearestDistance = distance
      }
    }
  }
  return nearest
}

function distanceToLineSquared(point, start, end) {
  const dx = end.lon - start.lon
  const dy = end.lat - start.lat
  const denominator = dx * dx + dy * dy
  const ratio = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, (
        ((point.lon - start.lon) * dx + (point.lat - start.lat) * dy) / denominator
      )))
  const lon = start.lon + dx * ratio
  const lat = start.lat + dy * ratio
  return (point.lon - lon) ** 2 + (point.lat - lat) ** 2
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return '—'
  }
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(2)} km`
    : `${Math.round(distanceMeters)} m`
}
