import { useEffect, useId, useRef, useState } from 'react'

import {
  filterProjectLibraryProjects,
  formatProjectLibraryText,
  formatProjectSummary,
  getProjectLibraryCopy,
  normalizeProjectLibraryLanguage,
} from './projectLibraryCopy.js'

const noop = () => {}
const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export default function ProjectLibraryDialog({
  open,
  onClose = noop,
  language = 'en',
  projects = [],
  currentProjectId = null,
  loading = false,
  error = '',
  status = '',
  onNew = noop,
  onOpen = noop,
  onRename = noop,
  onDuplicate = noop,
  onArchive = noop,
  onRestore = noop,
  onDelete = noop,
}) {
  const normalizedLanguage = normalizeProjectLibraryLanguage(language)
  const labels = getProjectLibraryCopy(normalizedLanguage)
  const reactId = useId()
  const titleId = `${reactId}-title`
  const introId = `${reactId}-intro`
  const activeTabId = `${reactId}-active-tab`
  const archivedTabId = `${reactId}-archived-tab`
  const activePanelId = `${reactId}-active-panel`
  const archivedPanelId = `${reactId}-archived-panel`
  const dialogRef = useRef(null)
  const searchInputRef = useRef(null)
  const renameInputRef = useRef(null)
  const confirmationCancelRef = useRef(null)
  const lastActionTriggerRef = useRef(null)
  const tabRefs = useRef({ active: null, archived: null })
  const [activeTab, setActiveTab] = useState('active')
  const [queries, setQueries] = useState({ active: '', archived: '' })
  const [editingProjectId, setEditingProjectId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [busyAction, setBusyAction] = useState('')
  const [actionError, setActionError] = useState('')

  const activeProjects = filterProjectLibraryProjects(projects, {
    tab: 'active',
    language: normalizedLanguage,
  })
  const archivedProjects = filterProjectLibraryProjects(projects, {
    tab: 'archived',
    language: normalizedLanguage,
  })
  const visibleProjects = filterProjectLibraryProjects(projects, {
    tab: activeTab,
    query: queries[activeTab],
    language: normalizedLanguage,
  })
  const currentQuery = queries[activeTab]
  const externallyReportedError = typeof error === 'string' ? error.trim() : ''
  const displayedError = externallyReportedError || actionError
  const liveStatus = status || (loading ? labels.loading : busyAction ? labels.working : '')
  const interactionsDisabled = loading || Boolean(busyAction)

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined
    }

    const previouslyFocused = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousBodyOverflow
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined
    }

    function focusLastActionTrigger() {
      window.requestAnimationFrame(() => {
        if (lastActionTriggerRef.current?.isConnected) {
          lastActionTriggerRef.current.focus()
        }
        else {
          dialogRef.current?.focus()
        }
      })
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (busyAction) {
          return
        }
        if (editingProjectId) {
          setEditingProjectId(null)
          setRenameValue('')
          setActionError('')
          focusLastActionTrigger()
          return
        }
        if (confirmation) {
          setConfirmation(null)
          setActionError('')
          focusLastActionTrigger()
          return
        }
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }
      const focusable = getFocusableElements(dialogRef.current)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      const activeElement = document.activeElement
      if (!dialogRef.current.contains(activeElement)) {
        event.preventDefault()
        first.focus()
      }
      else if (event.shiftKey && (activeElement === first || activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      }
      else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [busyAction, confirmation, editingProjectId, onClose, open])

  useEffect(() => {
    if (!editingProjectId) {
      return undefined
    }
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editingProjectId])

  useEffect(() => {
    if (!confirmation) {
      return undefined
    }
    const frame = window.requestAnimationFrame(() => confirmationCancelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [confirmation])

  if (!open) {
    return null
  }

  function resetTransientState() {
    setEditingProjectId(null)
    setRenameValue('')
    setConfirmation(null)
    setActionError('')
  }

  function requestClose() {
    if (busyAction) {
      return
    }
    resetTransientState()
    onClose()
  }

  function cancelInlineInteraction() {
    resetTransientState()
    window.requestAnimationFrame(() => {
      if (lastActionTriggerRef.current?.isConnected) {
        lastActionTriggerRef.current.focus()
      }
      else {
        dialogRef.current?.focus()
      }
    })
  }

  function handleBackdropClick(event) {
    if (event.target !== event.currentTarget) {
      return
    }
    if (busyAction) {
      return
    }
    if (editingProjectId || confirmation) {
      cancelInlineInteraction()
      return
    }
    requestClose()
  }

  function selectTab(nextTab, { focus = false } = {}) {
    setActiveTab(nextTab)
    resetTransientState()
    if (focus) {
      window.requestAnimationFrame(() => tabRefs.current[nextTab]?.focus())
    }
  }

  function handleTabKeyDown(event) {
    let nextTab = null
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      nextTab = activeTab === 'active' ? 'archived' : 'active'
    }
    else if (event.key === 'Home') {
      nextTab = 'active'
    }
    else if (event.key === 'End') {
      nextTab = 'archived'
    }
    if (nextTab) {
      event.preventDefault()
      selectTab(nextTab, { focus: true })
    }
  }

  function beginRename(project, trigger) {
    lastActionTriggerRef.current = trigger
    setConfirmation(null)
    setActionError('')
    setRenameValue(project.name)
    setEditingProjectId(project.id)
  }

  function beginConfirmation(kind, project, trigger) {
    lastActionTriggerRef.current = trigger
    setEditingProjectId(null)
    setRenameValue('')
    setActionError('')
    setConfirmation({ kind, projectId: project.id })
  }

  async function performAction(actionName, callback, args, onSuccess = noop) {
    if (interactionsDisabled) {
      return
    }
    setBusyAction(actionName)
    setActionError('')
    try {
      await callback(...args)
      onSuccess()
    }
    catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : labels.actionFailed)
    }
    finally {
      setBusyAction('')
    }
  }

  function submitRename(event, project) {
    event.preventDefault()
    const nextName = renameValue.trim()
    if (!nextName || nextName === project.name) {
      return
    }
    performAction(`rename:${project.id}`, onRename, [project, nextName], () => {
      setEditingProjectId(null)
      setRenameValue('')
      window.requestAnimationFrame(() => dialogRef.current?.focus())
    })
  }

  const selectedTabCount = activeTab === 'active' ? activeProjects.length : archivedProjects.length
  const searchLabel = activeTab === 'active' ? labels.searchActive : labels.searchArchived
  const emptyMessage = currentQuery
    ? formatProjectLibraryText(labels.noSearchResults, { query: currentQuery })
    : activeTab === 'active'
      ? labels.emptyActive
      : labels.emptyArchived
  const resultAnnouncement = formatProjectLibraryText(
    visibleProjects.length === 1 ? labels.resultCountOne : labels.resultCount,
    { count: visibleProjects.length },
  )

  return (
    <div className="instruction-backdrop" onMouseDown={handleBackdropClick}>
      <section
        aria-busy={loading || Boolean(busyAction)}
        aria-describedby={introId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="instruction-sheet"
        ref={dialogRef}
        role="dialog"
        style={styles.dialog}
        tabIndex="-1"
      >
        <header className="instruction-sheet-header">
          <div>
            <p className="eyebrow">{labels.eyebrow}</p>
            <h2 id={titleId}>{labels.title}</h2>
            <p id={introId}>{labels.intro}</p>
          </div>
          <button
            aria-label={labels.close}
            className="instruction-close"
            disabled={interactionsDisabled}
            onClick={requestClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div style={styles.content}>
          <div style={styles.topActions}>
            <div
              aria-label={labels.title}
              onKeyDown={handleTabKeyDown}
              role="tablist"
              style={styles.tabs}
            >
              <button
                aria-controls={activePanelId}
                aria-label={formatProjectLibraryText(labels.activeTabLabel, { count: activeProjects.length })}
                aria-selected={activeTab === 'active'}
                className="ghost-button"
                id={activeTabId}
                onClick={() => selectTab('active')}
                ref={(element) => {
                  tabRefs.current.active = element
                }}
                role="tab"
                style={activeTab === 'active' ? styles.selectedTab : undefined}
                tabIndex={activeTab === 'active' ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true">{labels.activeTab} ({activeProjects.length})</span>
              </button>
              <button
                aria-controls={archivedPanelId}
                aria-label={formatProjectLibraryText(labels.archivedTabLabel, { count: archivedProjects.length })}
                aria-selected={activeTab === 'archived'}
                className="ghost-button"
                id={archivedTabId}
                onClick={() => selectTab('archived')}
                ref={(element) => {
                  tabRefs.current.archived = element
                }}
                role="tab"
                style={activeTab === 'archived' ? styles.selectedTab : undefined}
                tabIndex={activeTab === 'archived' ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true">{labels.archivedTab} ({archivedProjects.length})</span>
              </button>
            </div>

            <button
              className="primary-button"
              disabled={interactionsDisabled}
              onClick={() => performAction('new', onNew, [])}
              type="button"
            >
              {labels.newProject}
            </button>
          </div>

          <div style={styles.searchAndStatus}>
            <label className="field-label" style={styles.searchLabel}>
              <span>{searchLabel}</span>
              <input
                autoComplete="off"
                onChange={(event) => setQueries((current) => ({
                  ...current,
                  [activeTab]: event.target.value,
                }))}
                placeholder={labels.searchPlaceholder}
                ref={searchInputRef}
                type="search"
                value={currentQuery}
              />
            </label>
            <p aria-live="polite" className="status-text" style={styles.status}>
              {liveStatus}
            </p>
            {displayedError ? (
              <p className="error-text" role="alert" style={styles.error}>
                {displayedError}
              </p>
            ) : null}
            <p aria-live="polite" style={styles.screenReaderOnly}>
              {resultAnnouncement}
            </p>
          </div>

          <div
            aria-labelledby={activeTab === 'active' ? activeTabId : archivedTabId}
            id={activeTab === 'active' ? activePanelId : archivedPanelId}
            role="tabpanel"
            tabIndex="0"
          >
            {loading && !selectedTabCount ? (
              <p className="muted-text" style={styles.empty}>{labels.loading}</p>
            ) : visibleProjects.length ? (
              <ul aria-label={searchLabel} style={styles.list}>
                {visibleProjects.map((project) => {
                  const nameId = `${reactId}-${safeDomId(project.id)}-name`
                  const confirmationTitleId = `${reactId}-${safeDomId(project.id)}-confirmation-title`
                  const confirmationBodyId = `${reactId}-${safeDomId(project.id)}-confirmation-body`
                  const isCurrent = project.id === currentProjectId
                  const isReadOnly = Boolean(project.readOnly || project.compatibility)
                  const isEditing = editingProjectId === project.id
                  const pendingConfirmation = confirmation?.projectId === project.id
                    ? confirmation.kind
                    : null

                  return (
                    <li key={project.id} style={styles.listItem}>
                      <article aria-labelledby={nameId} style={styles.projectCard}>
                        <div style={styles.projectHeading}>
                          <div style={styles.projectIdentity}>
                            <h3 id={nameId} style={styles.projectName}>{project.name}</h3>
                            <div style={styles.badges}>
                              {isCurrent ? <span style={styles.currentBadge}>{labels.current}</span> : null}
                              {isReadOnly ? (
                                <span style={styles.readOnlyBadge}>
                                  {project.compatibility === 'unsupported'
                                    ? labels.unsupported
                                    : project.compatibility === 'corrupt'
                                      ? labels.corrupt
                                      : labels.readOnly}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <p style={styles.summary}>{formatProjectSummary(project, normalizedLanguage)}</p>
                        </div>

                        {isEditing ? (
                          <form
                            aria-label={formatProjectLibraryText(labels.renameNamed, { name: project.name })}
                            onSubmit={(event) => submitRename(event, project)}
                            style={styles.inlinePanel}
                          >
                            <label className="field-label" style={styles.renameLabel}>
                              <span>{formatProjectLibraryText(labels.renameField, { name: project.name })}</span>
                              <input
                                aria-invalid={!renameValue.trim()}
                                maxLength="120"
                                onChange={(event) => setRenameValue(event.target.value)}
                                ref={renameInputRef}
                                required
                                value={renameValue}
                              />
                            </label>
                            <div style={styles.inlineActions}>
                              <button
                                className="primary-button"
                                disabled={
                                  interactionsDisabled ||
                                  !renameValue.trim() ||
                                  renameValue.trim() === project.name
                                }
                                type="submit"
                              >
                                {labels.saveName}
                              </button>
                              <button
                                className="ghost-button"
                                disabled={interactionsDisabled}
                                onClick={cancelInlineInteraction}
                                type="button"
                              >
                                {labels.cancel}
                              </button>
                            </div>
                          </form>
                        ) : pendingConfirmation ? (
                          <div
                            aria-describedby={confirmationBodyId}
                            aria-labelledby={confirmationTitleId}
                            role="group"
                            style={styles.confirmation}
                          >
                            <strong id={confirmationTitleId}>
                              {formatProjectLibraryText(
                                pendingConfirmation === 'archive'
                                  ? labels.confirmArchiveTitle
                                  : labels.confirmDeleteTitle,
                                { name: project.name },
                              )}
                            </strong>
                            <p id={confirmationBodyId} style={styles.confirmationBody}>
                              {pendingConfirmation === 'archive'
                                ? labels.confirmArchiveBody
                                : labels.confirmDeleteBody}
                            </p>
                            <div style={styles.inlineActions}>
                              <button
                                className="ghost-button"
                                disabled={interactionsDisabled}
                                onClick={cancelInlineInteraction}
                                ref={confirmationCancelRef}
                                type="button"
                              >
                                {labels.cancel}
                              </button>
                              <button
                                className="ghost-button danger-button"
                                disabled={interactionsDisabled}
                                onClick={() => performAction(
                                  `${pendingConfirmation}:${project.id}`,
                                  pendingConfirmation === 'archive' ? onArchive : onDelete,
                                  [project],
                                  () => {
                                    setConfirmation(null)
                                    window.requestAnimationFrame(() => dialogRef.current?.focus())
                                  },
                                )}
                                type="button"
                              >
                                {pendingConfirmation === 'archive'
                                  ? labels.confirmArchive
                                  : labels.confirmDelete}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            aria-label={formatProjectLibraryText(labels.actionsFor, { name: project.name })}
                            role="group"
                            style={styles.projectActions}
                          >
                            {activeTab === 'active' ? (
                              <>
                                <button
                                  aria-label={formatProjectLibraryText(labels.openNamed, { name: project.name })}
                                  className="primary-button"
                                  disabled={interactionsDisabled || isReadOnly || isCurrent}
                                  onClick={() => performAction(`open:${project.id}`, onOpen, [project])}
                                  type="button"
                                >
                                  {labels.open}
                                </button>
                                <button
                                  aria-label={formatProjectLibraryText(labels.renameNamed, { name: project.name })}
                                  className="ghost-button"
                                  disabled={interactionsDisabled || isReadOnly}
                                  onClick={(event) => beginRename(project, event.currentTarget)}
                                  type="button"
                                >
                                  {labels.rename}
                                </button>
                                <button
                                  aria-label={formatProjectLibraryText(labels.duplicateNamed, { name: project.name })}
                                  className="ghost-button"
                                  disabled={interactionsDisabled || isReadOnly}
                                  onClick={() => performAction(`duplicate:${project.id}`, onDuplicate, [project])}
                                  type="button"
                                >
                                  {labels.duplicate}
                                </button>
                                <button
                                  aria-label={formatProjectLibraryText(labels.archiveNamed, { name: project.name })}
                                  className="ghost-button"
                                  disabled={interactionsDisabled || isReadOnly}
                                  onClick={(event) => beginConfirmation('archive', project, event.currentTarget)}
                                  type="button"
                                >
                                  {labels.archive}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  aria-label={formatProjectLibraryText(labels.restoreNamed, { name: project.name })}
                                  className="primary-button"
                                  disabled={interactionsDisabled || isReadOnly}
                                  onClick={() => performAction(`restore:${project.id}`, onRestore, [project])}
                                  type="button"
                                >
                                  {labels.restore}
                                </button>
                                <button
                                  aria-label={formatProjectLibraryText(labels.deleteNamed, { name: project.name })}
                                  className="ghost-button danger-button"
                                  disabled={interactionsDisabled || isReadOnly}
                                  onClick={(event) => beginConfirmation('delete', project, event.currentTarget)}
                                  type="button"
                                >
                                  {labels.delete}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </article>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted-text" style={styles.empty}>{emptyMessage}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => (
    !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true'
  ))
}

function safeDomId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-')
}

const styles = {
  dialog: {
    width: 'min(920px, 100%)',
  },
  content: {
    display: 'grid',
    gap: 16,
    padding: '16px 20px 22px',
  },
  topActions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tabs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedTab: {
    borderColor: 'var(--accent)',
    boxShadow: 'inset 0 -2px 0 var(--accent)',
    fontWeight: 800,
  },
  searchAndStatus: {
    display: 'grid',
    gap: 4,
  },
  searchLabel: {
    maxWidth: 560,
    margin: 0,
  },
  status: {
    minHeight: '1.25em',
    margin: '4px 0 0',
  },
  error: {
    margin: '4px 0 0',
  },
  list: {
    display: 'grid',
    gap: 10,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  listItem: {
    minWidth: 0,
  },
  projectCard: {
    display: 'grid',
    gap: 12,
    minWidth: 0,
    padding: 14,
    border: '1px solid rgba(93, 111, 105, 0.32)',
    borderRadius: 4,
  },
  projectHeading: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'start',
    justifyContent: 'space-between',
    gap: '6px 16px',
  },
  projectIdentity: {
    display: 'grid',
    gap: 5,
    minWidth: 0,
  },
  projectName: {
    margin: 0,
    overflowWrap: 'anywhere',
    color: 'var(--text-h)',
    fontSize: '1rem',
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  currentBadge: {
    width: 'fit-content',
    padding: '2px 6px',
    borderRadius: 3,
    background: 'rgba(28, 93, 84, 0.14)',
    color: 'var(--text-h)',
    fontSize: '0.72rem',
    fontWeight: 800,
  },
  readOnlyBadge: {
    width: 'fit-content',
    padding: '2px 6px',
    borderRadius: 3,
    background: 'rgba(176, 54, 24, 0.13)',
    color: 'var(--text-h)',
    fontSize: '0.72rem',
    fontWeight: 800,
  },
  summary: {
    margin: 0,
    color: 'var(--text)',
    fontSize: '0.82rem',
  },
  projectActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 7,
  },
  inlinePanel: {
    display: 'grid',
    gap: 10,
    padding: 12,
    border: '1px solid rgba(93, 111, 105, 0.34)',
    borderRadius: 4,
  },
  renameLabel: {
    margin: 0,
  },
  confirmation: {
    display: 'grid',
    gap: 8,
    padding: 12,
    border: '1px solid rgba(176, 54, 24, 0.38)',
    borderRadius: 4,
  },
  confirmationBody: {
    margin: 0,
    color: 'var(--text)',
    fontSize: '0.86rem',
  },
  inlineActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 7,
  },
  empty: {
    margin: 0,
    padding: '28px 12px',
    textAlign: 'center',
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
}
