import { useEffect, useMemo, useRef, useState } from 'react'
import FitParser from 'fit-file-parser'
import { gpx as toGeoJsonGpx } from '@tmcw/togeojson'
import './App.css'
import { deleteRepairDraft, loadRepairDraft, saveRepairDraft } from './draftStore'
import { translate } from './i18n'
import TrackMap from './TrackMap'
import TrackCharts from './TrackCharts'
import packageMetadata from '../package.json'

const initialView = [55.751244, 37.618423]
const minimumSidebarWidth = 380

function App() {
  const [language, setLanguage] = useState(getStoredLanguage)
  const [theme, setTheme] = useState(getStoredTheme)
  const [track, setTrack] = useState(null)
  const [sourceTrack, setSourceTrack] = useState(null)
  const [selectedCutPointIndex, setSelectedCutPointIndex] = useState(null)
  const [tailAnchorPointIndex, setTailAnchorPointIndex] = useState(null)
  const [removedSegmentSamples, setRemovedSegmentSamples] = useState([])
  const [rebuildDirection, setRebuildDirection] = useState(null)
  const [middleRepairRange, setMiddleRepairRange] = useState(null)
  const [routeProfile, setRouteProfile] = useState(getStoredRouteProfile)
  const [mapLayer, setMapLayer] = useState(getStoredMapLayer)
  const [mapMode, setMapMode] = useState('inspect')
  const [endpoint, setEndpoint] = useState(null)
  const [viaPoints, setViaPoints] = useState([])
  const [activeWaypointId, setActiveWaypointId] = useState(null)
  const [routePreview, setRoutePreview] = useState({
    status: 'idle',
    error: '',
    segments: [],
    geometry: [],
    distanceMeters: 0,
  })
  const [message, setMessage] = useState(() => translate(getStoredLanguage(), 'ready'))
  const [error, setError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [correctElevationOnExport, setCorrectElevationOnExport] = useState(getStoredElevationPreference)
  const [fitRequest, setFitRequest] = useState(0)
  const [repairHistory, setRepairHistory] = useState([])
  const [availableDraft, setAvailableDraft] = useState(null)
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const pendingRouteFitRef = useRef(false)
  const workspaceRef = useRef(null)
  const sidebarResizeCleanupRef = useRef(null)
  const [collapsedPanels, setCollapsedPanels] = useState(getStoredCollapsedPanels)
  const [sidebarWidth, setSidebarWidth] = useState(minimumSidebarWidth)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [chartHighlightedPoints, setChartHighlightedPoints] = useState([])
  const t = (key, values) => translate(language, key, values)

  const suspiciousSegments = useMemo(() => {
    if (!track) {
      return []
    }

    return getSuspiciousSegments(track.points).map((segment) => ({
      ...segment,
      id: `${segment.startIndex}-${segment.endIndex}`,
      severity: getIssueSeverity(segment),
    }))
  }, [track])

  const nextIssueAfterRepair = useMemo(() => {
    if (!middleRepairRange) {
      return null
    }

    return suspiciousSegments.find((segment) => (
      segment.startSampleIndex > middleRepairRange.endSampleIndex
    )) ?? null
  }, [middleRepairRange, suspiciousSegments])

  const anchorPoint = useMemo(() => {
    if (!track || tailAnchorPointIndex === null) {
      return null
    }

    return track.points[tailAnchorPointIndex] ?? null
  }, [tailAnchorPointIndex, track])

  const selectedCutPoint = useMemo(() => {
    if (!track || selectedCutPointIndex === null) {
      return null
    }

    return track.points[selectedCutPointIndex] ?? null
  }, [selectedCutPointIndex, track])

  const controlPoints = useMemo(() => {
    if (!anchorPoint || !endpoint) {
      return []
    }

    if (rebuildDirection === 'before') {
      return [
        { id: 'endpoint', lat: endpoint.lat, lon: endpoint.lon, kind: 'endpoint', offGrid: false },
        ...viaPoints.map((point) => ({ ...point, kind: 'via' })),
        { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon, kind: 'anchor', offGrid: false },
      ]
    }

    return [
      { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon, kind: 'anchor', offGrid: false },
      ...viaPoints.map((point) => ({ ...point, kind: 'via' })),
      { id: 'endpoint', lat: endpoint.lat, lon: endpoint.lon, kind: 'endpoint', offGrid: false },
    ]
  }, [anchorPoint, endpoint, rebuildDirection, viaPoints])

  const effectiveRoutePreview = useMemo(() => (
    controlPoints.length
      ? routePreview
      : {
          status: endpoint ? 'idle' : 'empty',
          error: '',
          segments: [],
          geometry: [],
          distanceMeters: 0,
        }
  ), [controlPoints.length, endpoint, routePreview])

  const routeWarning = useMemo(() => {
    if (!removedSegmentSamples.length || effectiveRoutePreview.distanceMeters <= 0) {
      return ''
    }

    const anchorSample = rebuildDirection === 'before'
      ? track?.samples?.[0] ?? null
      : rebuildDirection === 'middle'
        ? removedSegmentSamples[0] ?? null
        : track?.samples?.[track.samples.length - 1] ?? null
    if (!anchorSample) {
      return ''
    }

    const previousDistance = Number.isFinite(anchorSample.distance) ? anchorSample.distance : null
    const comparisonSample = rebuildDirection === 'before'
      ? removedSegmentSamples[0]
      : removedSegmentSamples[removedSegmentSamples.length - 1]
    const lastDistance = Number.isFinite(comparisonSample?.distance)
      ? comparisonSample.distance
      : null

    if (previousDistance === null || lastDistance === null) {
      return ''
    }

    const recordedTailDistance = rebuildDirection === 'before'
      ? previousDistance - lastDistance
      : lastDistance - previousDistance
    if (recordedTailDistance <= 0) {
      return ''
    }
    const deltaRatio = Math.abs(effectiveRoutePreview.distanceMeters - recordedTailDistance) / recordedTailDistance
    if (deltaRatio < 0.18) {
      return ''
    }

    return translate(language, 'routeWarning', {
      suggested: formatDistance(effectiveRoutePreview.distanceMeters),
      recorded: formatDistance(recordedTailDistance),
    })
  }, [effectiveRoutePreview.distanceMeters, language, rebuildDirection, removedSegmentSamples, track])

  const repairQuality = useMemo(() => {
    if (effectiveRoutePreview.status !== 'ready' || effectiveRoutePreview.geometry.length < 2) {
      return null
    }

    const removedGeometry = removedSegmentSamples.filter((sample) => (
      Number.isFinite(sample.lat) && Number.isFinite(sample.lon)
    ))
    const removedDistance = removedGeometry.length > 1 ? getPolylineLength(removedGeometry) : 0
    const differencePercent = removedDistance > 0
      ? Math.round(((effectiveRoutePreview.distanceMeters - removedDistance) / removedDistance) * 100)
      : null

    return {
      directSegments: effectiveRoutePreview.segments.filter((segment) => segment.mode === 'direct').length,
      differencePercent,
      largeDetour: differencePercent !== null && differencePercent > 80,
    }
  }, [effectiveRoutePreview, removedSegmentSamples])

  const completedRepairs = useMemo(
    () => countAcceptedRepairGroups(track?.samples ?? []),
    [track],
  )
  const visualizationTrack = useMemo(() => {
    if (
      !track ||
      effectiveRoutePreview.status !== 'ready' ||
      effectiveRoutePreview.geometry.length < 2
    ) {
      return track
    }

    return buildExportTrack(
      track,
      removedSegmentSamples,
      effectiveRoutePreview.geometry,
      rebuildDirection,
      middleRepairRange,
    )
  }, [effectiveRoutePreview, middleRepairRange, rebuildDirection, removedSegmentSamples, track])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-language', language)
  }, [language])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-route-profile', routeProfile)
  }, [routeProfile])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-map-layer', mapLayer)
  }, [mapLayer])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-correct-elevation', String(correctElevationOnExport))
  }, [correctElevationOnExport])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-collapsed-panels', JSON.stringify(collapsedPanels))
  }, [collapsedPanels])

  useEffect(() => () => sidebarResizeCleanupRef.current?.(), [])

  useEffect(() => {
    let active = true

    loadRepairDraft()
      .then((draft) => {
        if (active && draft) {
          setAvailableDraft(draft)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!sourceTrack || !track) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      saveRepairDraft(sourceTrack, track)
        .then((savedAt) => setDraftSavedAt(savedAt))
        .catch(() => {})
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [sourceTrack, track])

  useEffect(() => {
    if (!controlPoints.length) {
      return
    }

    let cancelled = false
    const abortController = new AbortController()

    async function buildRoutePreview() {
      setRoutePreview((current) => ({
        ...current,
        status: 'loading',
        error: '',
      }))

      try {
        const segments = []
        let geometry = []
        let distanceMeters = 0

        for (let index = 0; index < controlPoints.length - 1; index += 1) {
          const from = controlPoints[index]
          const to = controlPoints[index + 1]
          const forceDirect = to.offGrid
          const segment = forceDirect
            ? buildDirectSegment(from, to)
            : await fetchRouteSegment(from, to, routeProfile, abortController.signal)

          segments.push({
            ...segment,
            id: `${from.id}-${to.id}`,
            insertAfterId: from.id,
          })
          geometry = appendSegmentGeometry(geometry, segment.geometry)
          distanceMeters += segment.distanceMeters
        }

        if (!cancelled) {
          setRoutePreview({
            status: 'ready',
            error: '',
            segments,
            geometry,
            distanceMeters,
          })
          if (pendingRouteFitRef.current) {
            pendingRouteFitRef.current = false
            setFitRequest((current) => current + 1)
          }
        }
      }
      catch (nextError) {
        if (abortController.signal.aborted || cancelled) {
          return
        }

        setRoutePreview({
          status: 'error',
          error: nextError instanceof Error ? nextError.message : 'Could not build route preview.',
          segments: [],
          geometry: [],
          distanceMeters: 0,
        })
      }
    }

    buildRoutePreview()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [controlPoints, endpoint, routeProfile])

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      setError('')
      setMessage(t('readingFile', { file: file.name }))
      const loadedTrack = await loadTrack(file)
      setSourceTrack(loadedTrack)
      setTrack(loadedTrack)
      setSelectedCutPointIndex(null)
      setTailAnchorPointIndex(null)
      setRemovedSegmentSamples([])
      setRebuildDirection(null)
      setMiddleRepairRange(null)
      setEndpoint(null)
      setViaPoints([])
      setActiveWaypointId(null)
      setMapMode('inspect')
      setRepairHistory([])
      setAvailableDraft(null)
      setDraftSavedAt(null)
      setFitRequest((current) => current + 1)
      setMessage(t('loadedFile', { file: file.name }))
    }
    catch (nextError) {
      setSourceTrack(null)
      setTrack(null)
      setSelectedCutPointIndex(null)
      setTailAnchorPointIndex(null)
      setRemovedSegmentSamples([])
      setRebuildDirection(null)
      setMiddleRepairRange(null)
      setEndpoint(null)
      setViaPoints([])
      setActiveWaypointId(null)
      setMapMode('inspect')
      setError(nextError instanceof Error ? nextError.message : 'Could not read the track file.')
      setRepairHistory([])
      setMessage(t('loadFailed'))
    }
    finally {
      event.target.value = ''
    }
  }

  function selectCutPoint(pointIndex) {
    if (!track) {
      return
    }

    const point = track.points[pointIndex]
    if (!point) {
      return
    }

    setSelectedCutPointIndex(pointIndex)
    setMessage(t('cutSelected', { point: pointIndex + 1 }))
  }

  function deleteAfterCutPoint() {
    if (!track || selectedCutPointIndex === null) {
      return
    }

    const anchor = track.points[selectedCutPointIndex]
    if (!anchor) {
      return
    }

    const anchorSampleIndex = anchor.sampleIndex
    const nextSamples = track.samples.slice(0, anchorSampleIndex + 1)
    const removedSamples = track.samples.slice(anchorSampleIndex + 1)

    if (nextSamples.length < 2) {
      setError(t('keepBefore'))
      return
    }

    const trimmedTrack = finalizeTrack({
      ...track,
      samples: nextSamples,
    })

    pushRepairHistory('deleteAfter', track)
    setTrack(trimmedTrack)
    setSelectedCutPointIndex(trimmedTrack.points.length - 1)
    setTailAnchorPointIndex(trimmedTrack.points.length - 1)
    setRemovedSegmentSamples(removedSamples)
    setRebuildDirection('after')
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('pick-endpoint')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage(t('deletedAfter'))
  }

  function deleteBeforeCutPoint() {
    if (!track || selectedCutPointIndex === null) {
      return
    }

    const cutPoint = track.points[selectedCutPointIndex]
    if (!cutPoint) {
      return
    }

    const cutSampleIndex = cutPoint.sampleIndex
    const removedSamples = track.samples.slice(0, cutSampleIndex)
    const nextSamples = track.samples.slice(cutSampleIndex)

    if (nextSamples.length < 2) {
      setError(t('keepAfter'))
      return
    }

    const trimmedTrack = finalizeTrack({
      ...track,
      samples: nextSamples,
    })

    pushRepairHistory('deleteBefore', track)
    setTrack(trimmedTrack)
    setSelectedCutPointIndex(0)
    setTailAnchorPointIndex(0)
    setRemovedSegmentSamples(removedSamples)
    setRebuildDirection('before')
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('pick-endpoint')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage(t('deletedBefore'))
  }

  function restoreOriginalTrack() {
    if (!sourceTrack) {
      return
    }

    pushRepairHistory('restore', track)
    setTrack(sourceTrack)
    setSelectedCutPointIndex(null)
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage(t('originalRestored'))
  }

  function pushRepairHistory(type, previousTrack, details = {}) {
    if (!previousTrack) {
      return
    }

    setRepairHistory((current) => [
      ...current.slice(-11),
      {
        id: crypto.randomUUID(),
        type,
        track: previousTrack,
        details,
      },
    ])
  }

  function undoLastChange() {
    const previous = repairHistory[repairHistory.length - 1]
    if (!previous) {
      return
    }

    setTrack(previous.track)
    setRepairHistory((current) => current.slice(0, -1))
    setSelectedCutPointIndex(null)
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setError('')
    setMessage(t('changeUndone'))
  }

  function changeLanguage(nextLanguage) {
    setLanguage(nextLanguage)
    setMessage(translate(
      nextLanguage,
      track ? 'loadedFile' : 'ready',
      track ? { file: track.name } : {},
    ))
  }

  function resumeDraft() {
    if (!availableDraft) {
      return
    }

    try {
      const restoredSource = finalizeTrack(availableDraft.sourceTrack)
      const restoredWorkingDraft = finalizeTrack(availableDraft.workingTrack)
      const restoredWorking = areTrackSamplesEquivalent(restoredSource, restoredWorkingDraft)
        ? restoredSource
        : restoredWorkingDraft

      setSourceTrack(restoredSource)
      setTrack(restoredWorking)
      setSelectedCutPointIndex(null)
      setTailAnchorPointIndex(null)
      setRemovedSegmentSamples([])
      setRebuildDirection(null)
      setMiddleRepairRange(null)
      setEndpoint(null)
      setViaPoints([])
      setActiveWaypointId(null)
      setMapMode('inspect')
      setRepairHistory([])
      setDraftSavedAt(availableDraft.savedAt)
      setAvailableDraft(null)
      setFitRequest((current) => current + 1)
      setError('')
      setMessage(t('draftRestored'))
    }
    catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('loadFailed'))
    }
  }

  async function discardDraft() {
    try {
      await deleteRepairDraft()
      setAvailableDraft(null)
      setDraftSavedAt(null)
      setMessage(t('draftDiscarded'))
    }
    catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('loadFailed'))
    }
  }

  function repairNextIssue() {
    const nextIssue = suspiciousSegments[0]
    if (nextIssue) {
      beginMiddleRepair(nextIssue)
    }
  }

  function beginMiddleRepair(segment) {
    if (!track) {
      return
    }

    if (rebuildDirection) {
      setError(t('finishCurrentRepair'))
      return
    }

    const startPoint = track.points[segment.startIndex]
    const endPoint = track.points[segment.endIndex]
    if (!startPoint || !endPoint || endPoint.sampleIndex <= startPoint.sampleIndex) {
      setError(t('invalidBorders'))
      return
    }

    setSelectedCutPointIndex(null)
    setTailAnchorPointIndex(segment.startIndex)
    setRemovedSegmentSamples(track.samples.slice(startPoint.sampleIndex, endPoint.sampleIndex + 1))
    setRebuildDirection('middle')
    setMiddleRepairRange({
      startSampleIndex: startPoint.sampleIndex,
      endSampleIndex: endPoint.sampleIndex,
    })
    setEndpoint({ lat: endPoint.lat, lon: endPoint.lon })
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setError('')
    setMessage(t('middleActive'))
  }

  function cancelMiddleRepair() {
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setError('')
    setMessage(t('middleCancelled'))
  }

  function extendMiddleRepairToNextIssue() {
    if (!track || !middleRepairRange || !nextIssueAfterRepair) {
      return
    }

    const endPoint = track.points[nextIssueAfterRepair.endIndex]
    if (!endPoint) {
      setError(t('invalidBorders'))
      return
    }

    setMiddleRepairRange((current) => ({
      ...current,
      endSampleIndex: nextIssueAfterRepair.endSampleIndex,
    }))
    setRemovedSegmentSamples(track.samples.slice(
      middleRepairRange.startSampleIndex,
      nextIssueAfterRepair.endSampleIndex + 1,
    ))
    setEndpoint({ lat: endPoint.lat, lon: endPoint.lon })
    setActiveWaypointId(null)
    setError('')
    setMessage(t('middleExtended'))
  }

  function expandMiddleRepairStart() {
    if (!track || !middleRepairRange) {
      return
    }

    const currentPointIndex = track.points.findIndex((point) => (
      point.sampleIndex === middleRepairRange.startSampleIndex
    ))
    const nextPointIndex = Math.max(0, currentPointIndex - 15)
    const nextStartPoint = track.points[nextPointIndex]
    if (currentPointIndex <= 0 || !nextStartPoint) {
      return
    }

    setTailAnchorPointIndex(nextPointIndex)
    setMiddleRepairRange((current) => ({
      ...current,
      startSampleIndex: nextStartPoint.sampleIndex,
    }))
    setRemovedSegmentSamples(track.samples.slice(
      nextStartPoint.sampleIndex,
      middleRepairRange.endSampleIndex + 1,
    ))
    setError('')
    setMessage(t('middleStartExpanded'))
  }

  function expandMiddleRepairEnd() {
    if (!track || !middleRepairRange) {
      return
    }

    const currentPointIndex = track.points.findIndex((point) => (
      point.sampleIndex === middleRepairRange.endSampleIndex
    ))
    const nextPointIndex = Math.min(track.points.length - 1, currentPointIndex + 15)
    const nextEndPoint = track.points[nextPointIndex]
    if (currentPointIndex < 0 || currentPointIndex >= track.points.length - 1 || !nextEndPoint) {
      return
    }

    setMiddleRepairRange((current) => ({
      ...current,
      endSampleIndex: nextEndPoint.sampleIndex,
    }))
    setRemovedSegmentSamples(track.samples.slice(
      middleRepairRange.startSampleIndex,
      nextEndPoint.sampleIndex + 1,
    ))
    setEndpoint({ lat: nextEndPoint.lat, lon: nextEndPoint.lon })
    setError('')
    setMessage(t('middleEndExpanded'))
  }

  function applyMiddleRepair() {
    if (!track || !middleRepairRange || effectiveRoutePreview.status !== 'ready') {
      setError(t('waitForRoute'))
      return
    }

    const repairedTrack = buildExportTrack(
      track,
      removedSegmentSamples,
      effectiveRoutePreview.geometry,
      rebuildDirection,
      middleRepairRange,
    )

    pushRepairHistory('middle', track, {
      distanceMeters: effectiveRoutePreview.distanceMeters,
      waypoints: viaPoints.length,
    })
    setTrack(repairedTrack)
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setError('')
    setMessage(t('middleApplied'))
  }

  function handleMapClick(latlng) {
    if (!track) {
      return
    }

    if (mapMode === 'pick-endpoint') {
      placeEndpoint(latlng)
      return
    }

    if (mapMode === 'add-offgrid-waypoint' && endpoint) {
      addWaypointAtLocation(latlng, true)
    }
  }

  function placeEndpoint(latlng) {
    const isInitialPlacement = !endpoint
    setEndpoint({ lat: latlng.lat, lon: latlng.lng })
    if (isInitialPlacement) {
      setViaPoints([])
      setActiveWaypointId(null)
    }
    setMapMode('inspect')
    pendingRouteFitRef.current = isInitialPlacement
    setMessage(
      isInitialPlacement
        ? t('endpointPlaced', {
            point: rebuildDirection === 'before' ? t('startPoint') : t('endpoint'),
          })
        : t('endpointMoved', {
            point: rebuildDirection === 'before' ? t('startPoint') : t('endpoint'),
          }),
    )
  }

  function handleTrackClick(latlng) {
    if (!track) {
      return
    }

    if (mapMode === 'pick-endpoint') {
      placeEndpoint(latlng)
      return
    }

    if (mapMode === 'add-offgrid-waypoint') {
      return
    }

    if (rebuildDirection === 'middle') {
      setMessage(t('clickBlueThread'))
      return
    }

    const suspiciousSegment = findNearestSuspiciousSegment(suspiciousSegments, track.points, latlng, 160)
    if (suspiciousSegment) {
      beginMiddleRepair(suspiciousSegment)
      return
    }

    const nearestPointIndex = findNearestPointIndex(track.points, latlng, 160)
    if (nearestPointIndex === null) {
      setMessage(t('clickCloser'))
      return
    }

    selectCutPoint(nearestPointIndex)
  }

  function handleRouteSegmentClick(segment, latlng) {
    if (!endpoint) {
      return
    }

    addWaypointAtLocation(latlng, false, segment.insertAfterId)
  }

  function addWaypointAtLocation(latlng, offGrid, preferredInsertAfterId = null) {
    const nextWaypoint = createWaypoint(latlng, offGrid)
    const insertAfterId = preferredInsertAfterId ?? getNearestRouteInsertAfterId(latlng, effectiveRoutePreview.segments)
    const insertIndex = resolveInsertIndexFromControlId(insertAfterId, viaPoints, rebuildDirection)

    setViaPoints((current) => {
      const next = [...current]
      next.splice(insertIndex, 0, nextWaypoint)
      return next
    })
    setActiveWaypointId(nextWaypoint.id)
    setMapMode(offGrid ? 'add-offgrid-waypoint' : 'inspect')
    setMessage(
      offGrid
        ? t('offGridAdded')
        : t('waypointAdded'),
    )
  }

  function handleWaypointMove(waypointId, latlng) {
    setViaPoints((current) => current.map((point) => (
      point.id === waypointId
        ? { ...point, lat: latlng.lat, lon: latlng.lng }
        : point
    )))
  }

  function setWaypointOffGrid(waypointId, checked) {
    setViaPoints((current) => current.map((point) => (
      point.id === waypointId
        ? { ...point, offGrid: checked }
        : point
    )))
  }

  function removeWaypoint(waypointId) {
    setViaPoints((current) => current.filter((point) => point.id !== waypointId))
    setActiveWaypointId((current) => (current === waypointId ? null : current))
    setMessage(t('waypointRemoved'))
  }

  function togglePanel(panelKey) {
    setCollapsedPanels((current) => ({
      ...current,
      [panelKey]: !current[panelKey],
    }))
  }

  function getMaximumSidebarWidth() {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth
    return Math.max(
      minimumSidebarWidth,
      Math.min(window.innerWidth / 2, workspaceWidth - minimumSidebarWidth),
    )
  }

  function resizeSidebar(clientX) {
    const workspaceLeft = workspaceRef.current?.getBoundingClientRect().left ?? 0
    const nextWidth = Math.max(
      minimumSidebarWidth,
      Math.min(clientX - workspaceLeft, getMaximumSidebarWidth()),
    )
    setSidebarWidth(Math.round(nextWidth))
  }

  function handleSidebarResizeStart(event) {
    event.preventDefault()
    sidebarResizeCleanupRef.current?.()
    setIsResizingSidebar(true)
    resizeSidebar(event.clientX)

    const handlePointerMove = (moveEvent) => resizeSidebar(moveEvent.clientX)
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      sidebarResizeCleanupRef.current = null
    }
    const handlePointerEnd = () => {
      cleanup()
      setIsResizingSidebar(false)
    }

    sidebarResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
  }

  function handleSidebarResizeKeyDown(event) {
    const step = event.shiftKey ? 50 : 20
    let nextWidth = sidebarWidth

    if (event.key === 'ArrowLeft') {
      nextWidth -= step
    } else if (event.key === 'ArrowRight') {
      nextWidth += step
    } else if (event.key === 'Home') {
      nextWidth = minimumSidebarWidth
    } else if (event.key === 'End') {
      nextWidth = getMaximumSidebarWidth()
    } else {
      return
    }

    event.preventDefault()
    setSidebarWidth(Math.max(minimumSidebarWidth, Math.min(nextWidth, getMaximumSidebarWidth())))
  }

  async function exportTrack() {
    if (!track || isExporting) {
      return
    }

    try {
      setIsExporting(true)
      setError('')

      let exportableTrack = buildExportTrack(
        track,
        removedSegmentSamples,
        effectiveRoutePreview.geometry,
        rebuildDirection,
        middleRepairRange,
      )

      if (correctElevationOnExport) {
        setMessage(t('correctingElevation'))
        exportableTrack = await correctTrackElevation(exportableTrack)
      }

      const gpxContent = buildGpx(exportableTrack)
      const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sanitizeFilename(exportableTrack.name || 'fixed-track')}.gpx`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(t('exported'))
    }
    catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Export failed.')
      setMessage(t('exportFailed'))
    }
    finally {
      setIsExporting(false)
    }
  }

  const activeWaypoint = activeWaypointId
    ? viaPoints.find((point) => point.id === activeWaypointId) ?? null
    : null
  const hasTrackEdits = Boolean(sourceTrack && track && sourceTrack !== track)
  const isPickingEndpoint = mapMode === 'pick-endpoint'
  const isAddingOffGrid = mapMode === 'add-offgrid-waypoint'
  const endpointLabel = rebuildDirection === 'before'
    ? t('newStartLabel')
    : rebuildDirection === 'middle'
      ? t('repairEndBorder')
      : t('newEndpointLabel')
  const layoutSignature = `${collapsedPanels.track}-${collapsedPanels.visualization}-${collapsedPanels.suspicious}-${collapsedPanels.rebuild}-${collapsedPanels.waypoints}-${collapsedPanels.history}`
  const middleStartPointIndex = middleRepairRange && track
    ? track.points.findIndex((point) => point.sampleIndex === middleRepairRange.startSampleIndex)
    : -1
  const middleEndPointIndex = middleRepairRange && track
    ? track.points.findIndex((point) => point.sampleIndex === middleRepairRange.endSampleIndex)
    : -1

  return (
    <div className={`app-shell theme-${theme}`}>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            {t('appEyebrow')}
            <span>v{packageMetadata.version}</span>
          </p>
          <h1>{t('appTitle')}</h1>
          <p className="lead">{t('appLead')}</p>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <label className="file-picker">
              <input type="file" accept=".gpx,.fit" onChange={handleFileChange} />
              <span>{t('loadTrack')}</span>
            </label>

            <button type="button" className="ghost-button" onClick={exportTrack} disabled={!track || isExporting}>
              {t('exportGpx')}
            </button>

            <label className="language-picker">
              <span>{t('language')}</span>
              <select value={language} onChange={(event) => changeLanguage(event.target.value)}>
                <option value="en">EN</option>
                <option value="ru">RU</option>
              </select>
            </label>

            <button
              aria-label={theme === 'dark' ? t('useLightTheme') : t('useDarkTheme')}
              aria-pressed={theme === 'dark'}
              className="theme-toggle"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? t('useLightTheme') : t('useDarkTheme')}
              type="button"
            >
              <span className="theme-toggle-track" aria-hidden="true">
                <span className="theme-toggle-thumb" />
              </span>
            </button>
          </div>

          <label className="checkbox-row checkbox-row-compact">
            <input
              type="checkbox"
              checked={correctElevationOnExport}
              onChange={(event) => setCorrectElevationOnExport(event.target.checked)}
            />
            <span>{t('correctElevation')}</span>
          </label>

          <p className="status-text status-text-compact">{message}</p>
          {error ? <p className="error-text">{error}</p> : null}
          {track && draftSavedAt ? (
            <div className="draft-saved">{t('draftSaved')}</div>
          ) : null}
          {!track && availableDraft ? (
            <div className="draft-card">
              <strong>{t('draftAvailable', {
                date: formatDraftDate(availableDraft.savedAt, language),
              })}</strong>
              <div className="draft-actions">
                <button type="button" className="primary-button" onClick={resumeDraft}>
                  {t('resumeDraft')}
                </button>
                <button type="button" className="ghost-button" onClick={discardDraft}>
                  {t('discardDraft')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className={`workspace${isResizingSidebar ? ' workspace-resizing' : ''}`}
        ref={workspaceRef}
        style={{ '--sidebar-width': `${sidebarWidth}px` }}
      >
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{t('track')}</h2>
                {track ? <span>{track.format.toUpperCase()}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('track')} aria-label={t('togglePanel', { panel: t('track') })}>
                {collapsedPanels.track ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.track && track ? (
              <>
                <dl className="stats-grid">
                  <div>
                    <dt>{t('name')}</dt>
                    <dd>{track.name}</dd>
                  </div>
                  <div>
                    <dt>{t('points')}</dt>
                    <dd>{track.points.length}</dd>
                  </div>
                  <div>
                    <dt>{t('distance')}</dt>
                    <dd>{formatDistance(track.distanceMeters)}</dd>
                  </div>
                  <div>
                    <dt>{t('detectedIssues')}</dt>
                    <dd>{suspiciousSegments.length}</dd>
                  </div>
                  <div>
                    <dt>{t('completedRepairs')}</dt>
                    <dd>{completedRepairs}</dd>
                  </div>
                </dl>

                <div className="step-box">
                  <div className="step-title">{t('chooseCutTitle')}</div>
                  <p className="muted-text">{t('chooseCutHelp')}</p>
                  <div className="stack">
                    <button type="button" className="ghost-button" onClick={deleteBeforeCutPoint} disabled={!selectedCutPoint}>
                      {t('deleteBefore')}
                    </button>
                    <button type="button" className="primary-button" onClick={deleteAfterCutPoint} disabled={!selectedCutPoint}>
                      {t('deleteAfter')}
                    </button>
                    <button type="button" className="ghost-button" onClick={undoLastChange} disabled={!repairHistory.length}>
                      {t('undoLast')}
                    </button>
                    {hasTrackEdits ? (
                      <button type="button" className="ghost-button" onClick={restoreOriginalTrack}>
                        {t('restoreOriginal')}
                      </button>
                    ) : null}
                  </div>
                  {selectedCutPoint ? (
                    <div className="note note-neutral">
                      {t('selectedCutPoint', {
                        point: selectedCutPointIndex + 1,
                        location: formatLatLon(selectedCutPoint),
                      })}
                    </div>
                  ) : null}
                </div>
              </>
            ) : !collapsedPanels.track ? (
              <p className="muted-text">{t('loadTrackToStart')}</p>
            ) : null}
          </div>

          {track ? (
            <div className="panel visualization-panel">
              <div className="panel-header">
                <div className="panel-header-main">
                  <h2>{t('visualization')}</h2>
                  <span>{t('trackProfile')}</span>
                </div>
                <button type="button" className="panel-toggle" onClick={() => togglePanel('visualization')} aria-label={t('togglePanel', { panel: t('visualization') })}>
                  {collapsedPanels.visualization ? '+' : '-'}
                </button>
              </div>

              {!collapsedPanels.visualization ? (
                <TrackCharts
                  onSelectionChange={setChartHighlightedPoints}
                  samples={visualizationTrack.samples}
                  t={t}
                />
              ) : null}
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{t('suspiciousJumps')}</h2>
                {suspiciousSegments.length ? <span>{t('jumpHints', { count: suspiciousSegments.length })}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('suspicious')} aria-label={t('togglePanel', { panel: t('suspiciousJumps') })}>
                {collapsedPanels.suspicious ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.suspicious && suspiciousSegments.length ? (
              <>
                <button
                  type="button"
                  className="primary-button queue-action"
                  onClick={repairNextIssue}
                  disabled={Boolean(rebuildDirection)}
                >
                  {t('repairNext')}
                </button>
                <div className="segment-list">
                  {suspiciousSegments.map((segment, index) => (
                    <button
                      key={segment.id}
                      type="button"
                      className={`segment-button ${
                        middleRepairRange?.startSampleIndex === segment.startSampleIndex &&
                        middleRepairRange?.endSampleIndex === segment.endSampleIndex
                          ? 'segment-button-active'
                          : ''
                      }`}
                      onClick={() => beginMiddleRepair(segment)}
                    >
                      <div className="segment-title-row">
                        <strong>{t('issue', { number: index + 1 })}</strong>
                        <span className={`severity-badge severity-${segment.severity}`}>
                          {t(`severity${capitalize(segment.severity)}`)}
                        </span>
                      </div>
                      <span>{t('fixedBorders', {
                        start: segment.startIndex + 1,
                        end: segment.endIndex + 1,
                      })}</span>
                      <span>{t('issueMetrics', {
                        distance: formatDistance(segment.distance),
                        duration: formatDuration(segment.seconds),
                      })}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : !collapsedPanels.suspicious ? (
              <p className="muted-text">{t('noIssues')}</p>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{rebuildDirection === 'middle' ? t('middleRepair') : t('routeRebuild')}</h2>
                {anchorPoint ? <span>{t('routing')}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('rebuild')} aria-label={t('togglePanel', { panel: t('routeRebuild') })}>
                {collapsedPanels.rebuild ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.rebuild && anchorPoint ? (
              <>
                <div className="inspector-grid">
                  <div>
                    <dt>{rebuildDirection === 'middle' ? t('startBorder') : t('anchor')}</dt>
                    <dd>{formatLatLon(anchorPoint)}</dd>
                  </div>
                  <div>
                    <dt>{t('removedSamples')}</dt>
                    <dd>{removedSegmentSamples.length}</dd>
                  </div>
                  <div>
                    <dt>
                      {rebuildDirection === 'before'
                        ? t('startPoint')
                        : rebuildDirection === 'middle'
                          ? t('endBorder')
                          : t('endpoint')}
                    </dt>
                    <dd>{endpoint ? formatLatLon(endpoint) : t('notSet')}</dd>
                  </div>
                  <div>
                    <dt>{t('waypoints')}</dt>
                    <dd>{viaPoints.length}</dd>
                  </div>
                </div>

                {isPickingEndpoint ? (
                  <div className="note note-action">
                    {t('endpointPlacementActive', {
                      point: rebuildDirection === 'before' ? t('startPoint') : t('endpoint'),
                    })}
                  </div>
                ) : null}
                {isAddingOffGrid ? (
                  <div className="note note-warning">
                    {t('offGridPlacementActive')}
                  </div>
                ) : null}

                <div className="mode-chip-row">
                  <span className={`mode-chip ${isPickingEndpoint || isAddingOffGrid ? 'mode-chip-active' : ''}`}>
                    {t('mode', {
                      mode: isPickingEndpoint
                        ? t('modePlacingEndpoint')
                        : isAddingOffGrid
                          ? t('modeOffGrid')
                          : t('modeInspect'),
                    })}
                  </span>
                </div>

                <div className="field-group">
                  <label htmlFor="route-profile">{t('navigatorProfile')}</label>
                  <select
                    id="route-profile"
                    value={routeProfile}
                    onChange={(event) => setRouteProfile(event.target.value)}
                  >
                    <option value="cycling">{t('cycling')}</option>
                    <option value="walking">{t('walking')}</option>
                    <option value="driving">{t('driving')}</option>
                  </select>
                </div>

                <div className="stack">
                  {rebuildDirection !== 'middle' ? (
                    <button type="button" className="primary-button" onClick={() => setMapMode('pick-endpoint')}>
                      {endpoint
                        ? t('movePoint', {
                            point: rebuildDirection === 'before' ? t('newStartPoint') : t('newEndpoint'),
                          })
                        : t('placePoint', {
                            point: rebuildDirection === 'before' ? t('newStartPoint') : t('newEndpoint'),
                          })}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setMapMode((current) => (current === 'add-offgrid-waypoint' ? 'inspect' : 'add-offgrid-waypoint'))}
                    disabled={!endpoint}
                  >
                    {isAddingOffGrid ? t('cancelOffGrid') : t('addOffGrid')}
                  </button>
                  {rebuildDirection === 'middle' ? (
                    <>
                      <div className="border-expand-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={expandMiddleRepairStart}
                          disabled={middleStartPointIndex <= 0}
                        >
                          {t('includeEarlierDrift')}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={expandMiddleRepairEnd}
                          disabled={middleEndPointIndex < 0 || middleEndPointIndex >= track.points.length - 1}
                        >
                          {t('includeLaterDrift')}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={extendMiddleRepairToNextIssue}
                        disabled={!nextIssueAfterRepair}
                      >
                        {t('extendToNext')}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={applyMiddleRepair}
                        disabled={effectiveRoutePreview.status !== 'ready'}
                      >
                        {t('applyMiddle')}
                      </button>
                      <button type="button" className="ghost-button" onClick={cancelMiddleRepair}>
                        {t('cancelMiddle')}
                      </button>
                    </>
                  ) : null}
                </div>

                {effectiveRoutePreview.status === 'loading' ? (
                  <div className="note note-neutral">{t('buildingRoute')}</div>
                ) : null}
                {effectiveRoutePreview.status === 'error' ? (
                  <div className="note note-danger">{effectiveRoutePreview.error}</div>
                ) : null}
                {effectiveRoutePreview.status === 'ready' ? (
                  <div className="note note-good">
                    {t('suggestedLength', { distance: formatDistance(effectiveRoutePreview.distanceMeters) })}
                  </div>
                ) : null}
                {routeWarning ? <div className="note note-warning">{routeWarning}</div> : null}

                <div className="quality-card">
                  <div className="quality-title">{t('repairQuality')}</div>
                  {repairQuality ? (
                    <>
                      <div className="quality-row">
                        <span className={`quality-dot ${repairQuality.directSegments ? 'quality-dot-warning' : ''}`} />
                        <span>
                          {repairQuality.directSegments
                            ? t('qualityMixed', { count: repairQuality.directSegments })
                            : t('qualityRoadRouted')}
                        </span>
                      </div>
                      {repairQuality.differencePercent !== null ? (
                        <div className="quality-row">
                          <span className={`quality-dot ${repairQuality.largeDetour ? 'quality-dot-danger' : ''}`} />
                          <span>{t('qualityDifference', { percent: repairQuality.differencePercent })}</span>
                        </div>
                      ) : null}
                      {repairQuality.largeDetour ? (
                        <div className="note note-warning">{t('qualityLargeDetour')}</div>
                      ) : (
                        <div className="quality-ready">{t('qualityReady')}</div>
                      )}
                    </>
                  ) : (
                    <p className="muted-text">{t('qualityNeedsRoute')}</p>
                  )}
                </div>
              </>
            ) : !collapsedPanels.rebuild ? (
              <p className="muted-text">{t('selectRepairHelp')}</p>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{t('waypointEditor')}</h2>
                {activeWaypoint ? <span>{t('selected')}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('waypoints')} aria-label={t('togglePanel', { panel: t('waypointEditor') })}>
                {collapsedPanels.waypoints ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.waypoints && viaPoints.length ? (
              <div className="segment-list">
                {viaPoints.map((point, index) => (
                  <button
                    key={point.id}
                    type="button"
                    className={`segment-button ${activeWaypointId === point.id ? 'segment-button-active' : ''}`}
                    onClick={() => setActiveWaypointId(point.id)}
                  >
                    <strong>
                      {point.offGrid
                        ? t('offGridWaypointNumber', { number: index + 1 })
                        : t('waypoint', { number: index + 1 })}
                    </strong>
                    <span>{formatLatLon(point)}</span>
                  </button>
                ))}
              </div>
            ) : !collapsedPanels.waypoints ? (
              <p className="muted-text">{t('waypointHelp')}</p>
            ) : null}

            {!collapsedPanels.waypoints && activeWaypoint ? (
              <div className="waypoint-box">
                <p className="muted-text">{t('waypointSelectedHelp')}</p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={activeWaypoint.offGrid}
                    onChange={(event) => setWaypointOffGrid(activeWaypoint.id, event.target.checked)}
                  />
                  <span>{t('offGridWaypoint')}</span>
                </label>
                <button type="button" className="ghost-button" onClick={() => removeWaypoint(activeWaypoint.id)}>
                  {t('removeWaypoint')}
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{t('history')}</h2>
                {repairHistory.length ? <span>{repairHistory.length}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('history')} aria-label={t('togglePanel', { panel: t('history') })}>
                {collapsedPanels.history ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.history && repairHistory.length ? (
              <>
                <div className="history-list">
                  {[...repairHistory].reverse().map((entry, index) => (
                    <div className="history-item" key={entry.id}>
                      <span className="history-index">{repairHistory.length - index}</span>
                      <div>
                        <strong>{t(getHistoryTranslationKey(entry.type))}</strong>
                        {entry.details.distanceMeters ? (
                          <span>{formatDistance(entry.details.distanceMeters)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="ghost-button history-undo" onClick={undoLastChange}>
                  {t('undoLast')}
                </button>
              </>
            ) : !collapsedPanels.history ? (
              <p className="muted-text">{t('historyEmpty')}</p>
            ) : null}
          </div>
        </aside>

        <div
          aria-label={t('resizeSidebar')}
          aria-orientation="vertical"
          aria-valuemax={Math.round(getMaximumSidebarWidth())}
          aria-valuemin={minimumSidebarWidth}
          aria-valuenow={sidebarWidth}
          className="sidebar-resizer"
          onDoubleClick={() => setSidebarWidth(minimumSidebarWidth)}
          onKeyDown={handleSidebarResizeKeyDown}
          onPointerDown={handleSidebarResizeStart}
          role="separator"
          tabIndex="0"
        />

        <div className="map-panel">
          <div className="map-layer-switch" role="group" aria-label={t('mapLayer')}>
            <button
              type="button"
              className={mapLayer === 'scheme' ? 'map-layer-button-active' : ''}
              onClick={() => setMapLayer('scheme')}
            >
              {t('schemeLayer')}
            </button>
            <button
              type="button"
              className={mapLayer === 'satellite' ? 'map-layer-button-active' : ''}
              onClick={() => setMapLayer('satellite')}
            >
              {t('satelliteLayer')}
            </button>
          </div>
          {isPickingEndpoint || isAddingOffGrid ? (
            <div className="map-mode-banner">
              {isPickingEndpoint
                ? t('endpointPlacementActive', {
                    point: rebuildDirection === 'before' ? t('startPoint') : t('endpoint'),
                  })
                : t('offGridPlacementActive')}
            </div>
          ) : null}
          <TrackMap
            activeWaypointId={activeWaypointId}
            anchorPoint={anchorPoint}
            anchorLabel={rebuildDirection === 'middle' ? t('repairStartBorder') : t('lastKnownPoint')}
            endpoint={endpoint}
            endpointLabel={endpointLabel}
            fitRequest={fitRequest}
            hasTrackEdits={hasTrackEdits}
            initialView={initialView}
            interactionMode={mapMode}
            layoutSignature={layoutSignature}
            mapLayer={mapLayer}
            offGridLabel={t('offGridLabel')}
            onEndpointMove={placeEndpoint}
            onMapClick={handleMapClick}
            onRouteSegmentClick={handleRouteSegmentClick}
            onTrackClick={handleTrackClick}
            onWaypointMove={handleWaypointMove}
            onWaypointRemove={removeWaypoint}
            onWaypointSelect={setActiveWaypointId}
            rebuildDirection={rebuildDirection}
            routeSegments={effectiveRoutePreview.segments}
            selectedCutPoint={selectedCutPoint}
            selectedCutPointLabel={t('cutPoint')}
            sourceTrack={sourceTrack}
            suspiciousSegments={suspiciousSegments}
            track={track}
            highlightedTrackPoints={chartHighlightedPoints}
            viaPoints={viaPoints}
            waypointLabel={t('waypointLabel')}
          />
        </div>
      </section>
    </div>
  )
}

function getStoredLanguage() {
  if (typeof window === 'undefined') {
    return 'en'
  }

  const stored = window.localStorage.getItem('fixyourtrack-language')
  if (stored === 'en' || stored === 'ru') {
    return stored
  }

  return window.navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

function getStoredTheme() {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored = window.localStorage.getItem('fixyourtrack-theme')
  if (stored === 'light' || stored === 'dark') {
    return stored
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredRouteProfile() {
  if (typeof window === 'undefined') {
    return 'cycling'
  }

  const stored = window.localStorage.getItem('fixyourtrack-route-profile')
  return ['cycling', 'walking', 'driving'].includes(stored) ? stored : 'cycling'
}

function getStoredMapLayer() {
  if (typeof window === 'undefined') {
    return 'scheme'
  }

  return window.localStorage.getItem('fixyourtrack-map-layer') === 'satellite'
    ? 'satellite'
    : 'scheme'
}

function getStoredElevationPreference() {
  return typeof window !== 'undefined' &&
    window.localStorage.getItem('fixyourtrack-correct-elevation') === 'true'
}

function getStoredCollapsedPanels() {
  const defaults = {
    track: false,
    visualization: false,
    suspicious: false,
    rebuild: false,
    waypoints: false,
    history: false,
  }

  if (typeof window === 'undefined') {
    return defaults
  }

  try {
    return {
      ...defaults,
      ...JSON.parse(window.localStorage.getItem('fixyourtrack-collapsed-panels') ?? '{}'),
    }
  }
  catch {
    return defaults
  }
}

function countAcceptedRepairGroups(samples) {
  let groups = 0
  let inAcceptedGroup = false

  for (const sample of samples) {
    if (sample.repairAccepted && !inAcceptedGroup) {
      groups += 1
      inAcceptedGroup = true
    }
    else if (!sample.repairAccepted) {
      inAcceptedGroup = false
    }
  }

  return groups
}

function areTrackSamplesEquivalent(firstTrack, secondTrack) {
  if (firstTrack.samples.length !== secondTrack.samples.length) {
    return false
  }

  return firstTrack.samples.every((sample, index) => {
    const comparison = secondTrack.samples[index]
    return sample.lat === comparison.lat &&
      sample.lon === comparison.lon &&
      Boolean(sample.repairAccepted) === Boolean(comparison.repairAccepted)
  })
}

function getIssueSeverity(segment) {
  if (segment.distance >= 1000 || segment.seconds >= 600 || segment.calcSpeedKmh >= 120) {
    return 'high'
  }

  if (segment.distance >= 300 || segment.seconds >= 60 || segment.calcSpeedKmh >= 60) {
    return 'medium'
  }

  return 'low'
}

function getHistoryTranslationKey(type) {
  return {
    middle: 'historyMiddle',
    deleteBefore: 'historyDeleteBefore',
    deleteAfter: 'historyDeleteAfter',
    restore: 'historyRestored',
  }[type] ?? 'historyMiddle'
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : ''
}

function createWaypoint(latlng, offGrid) {
  return {
    id: `waypoint-${crypto.randomUUID()}`,
    lat: latlng.lat,
    lon: latlng.lng,
    offGrid,
  }
}

function resolveInsertIndexFromControlId(controlId, viaPoints, rebuildDirection) {
  const startControlId = rebuildDirection === 'before' ? 'endpoint' : 'anchor'

  if (controlId === startControlId) {
    return 0
  }

  const waypointIndex = viaPoints.findIndex((point) => point.id === controlId)
  if (waypointIndex === -1) {
    return viaPoints.length
  }

  return waypointIndex + 1
}

function getNearestRouteInsertAfterId(latlng, segments) {
  if (!segments.length) {
    return 'anchor'
  }

  let bestInsertAfterId = segments[0].insertAfterId
  let bestDistance = Number.POSITIVE_INFINITY

  for (const segment of segments) {
    const distance = getDistanceToPolyline(latlng, segment.geometry)
    if (distance < bestDistance) {
      bestDistance = distance
      bestInsertAfterId = segment.insertAfterId
    }
  }

  return bestInsertAfterId
}

function getDistanceToPolyline(latlng, points) {
  if (!points.length) {
    return Number.POSITIVE_INFINITY
  }

  if (points.length === 1) {
    return haversineDistance({ lat: latlng.lat, lon: latlng.lng }, points[0])
  }

  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = getDistanceToLineSegment(
      { lat: latlng.lat, lon: latlng.lng },
      points[index],
      points[index + 1],
    )
    if (distance < bestDistance) {
      bestDistance = distance
    }
  }

  return bestDistance
}

function getDistanceToLineSegment(point, start, end) {
  const x = point.lon
  const y = point.lat
  const x1 = start.lon
  const y1 = start.lat
  const x2 = end.lon
  const y2 = end.lat
  const dx = x2 - x1
  const dy = y2 - y1

  if (dx === 0 && dy === 0) {
    return haversineDistance(point, start)
  }

  const projection = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
  const clamped = Math.max(0, Math.min(1, projection))

  return haversineDistance(point, {
    lat: y1 + dy * clamped,
    lon: x1 + dx * clamped,
  })
}

async function fetchRouteSegment(from, to, profile, signal) {
  const profileName = ['cycling', 'walking', 'driving'].includes(profile) ? profile : 'cycling'
  const coordinates = `${from.lon},${from.lat};${to.lon},${to.lat}`
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
    continue_straight: 'true',
  })

  let response
  try {
    response = await fetch(`https://router.project-osrm.org/route/v1/${profileName}/${coordinates}?${params.toString()}`, {
      signal,
    })
  }
  catch (networkError) {
    const detail = networkError instanceof Error ? networkError.message : 'network error'
    throw new Error(`Routing service is unreachable: ${detail}`, {
      cause: networkError,
    })
  }

  if (!response.ok) {
    throw new Error(`Routing service returned ${response.status}.`)
  }

  const data = await response.json()
  const route = Array.isArray(data.routes) ? data.routes[0] : null
  const routeCoordinates = route?.geometry?.coordinates

  if (!route || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    throw new Error('No routable street path was found for one of the route segments.')
  }

  return {
    mode: 'routed',
    geometry: routeCoordinates.map((coordinate) => ({
      lat: coordinate[1],
      lon: coordinate[0],
    })),
    distanceMeters: Number.isFinite(route.distance) ? route.distance : getPolylineLength([
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ]),
  }
}

function buildDirectSegment(from, to) {
  const geometry = [
    { lat: from.lat, lon: from.lon },
    { lat: to.lat, lon: to.lon },
  ]

  return {
    mode: 'direct',
    geometry,
    distanceMeters: getPolylineLength(geometry),
  }
}

function appendSegmentGeometry(currentGeometry, nextGeometry) {
  if (!currentGeometry.length) {
    return [...nextGeometry]
  }

  return [...currentGeometry, ...nextGeometry.slice(1)]
}

function buildExportTrack(track, removedSegmentSamples, routeGeometry, rebuildDirection, middleRepairRange = null) {
  if (!track) {
    throw new Error('No track loaded.')
  }

  if (!removedSegmentSamples.length || routeGeometry.length < 2 || !rebuildDirection) {
    return track
  }

  if (rebuildDirection === 'before') {
    const anchorSample = track.samples[0]
    const repairedStart = rebuildSegmentSamples(anchorSample, removedSegmentSamples, routeGeometry, 'before')

    return finalizeTrack({
      ...track,
      name: getCleanedTrackName(track.name),
      samples: [...repairedStart, ...track.samples],
    })
  }

  if (rebuildDirection === 'middle') {
    if (!middleRepairRange) {
      return track
    }

    const { startSampleIndex, endSampleIndex } = middleRepairRange
    const segmentSamples = track.samples.slice(startSampleIndex, endSampleIndex + 1)
    const repairedSegment = rebuildMiddleSegmentSamples(segmentSamples, routeGeometry)

    return finalizeTrack({
      ...track,
      name: getCleanedTrackName(track.name),
      samples: [
        ...track.samples.slice(0, startSampleIndex),
        ...repairedSegment,
        ...track.samples.slice(endSampleIndex + 1),
      ],
    })
  }

  const anchorSample = track.samples[track.samples.length - 1]
  const repairedTail = rebuildSegmentSamples(anchorSample, removedSegmentSamples, routeGeometry, 'after')

  return finalizeTrack({
    ...track,
    name: getCleanedTrackName(track.name),
    samples: [...track.samples, ...repairedTail],
  })
}

function getCleanedTrackName(name) {
  const baseName = name || 'fixed-track'
  return baseName.endsWith('-cleaned') ? baseName : `${baseName}-cleaned`
}

function rebuildMiddleSegmentSamples(segmentSamples, routeGeometry) {
  if (segmentSamples.length < 2 || routeGeometry.length < 2) {
    return segmentSamples
  }

  const progressRatios = getMiddleSegmentProgressRatios(segmentSamples)
  return segmentSamples.map((sample, index) => {
    const point = getPointOnPolyline(routeGeometry, progressRatios[index])
    return {
      ...sample,
      lat: point.lat,
      lon: point.lon,
      repairAccepted: true,
    }
  })
}

function getMiddleSegmentProgressRatios(segmentSamples) {
  const firstSample = segmentSamples[0]
  const lastSample = segmentSamples[segmentSamples.length - 1]
  const firstDistance = firstSample?.distance
  const lastDistance = lastSample?.distance

  if (
    Number.isFinite(firstDistance) &&
    Number.isFinite(lastDistance) &&
    lastDistance > firstDistance
  ) {
    const totalDistance = lastDistance - firstDistance
    return segmentSamples.map((sample, index) => {
      const fallback = index / (segmentSamples.length - 1)
      const progress = Number.isFinite(sample.distance)
        ? (sample.distance - firstDistance) / totalDistance
        : fallback
      return clamp01(progress)
    })
  }

  const firstTime = firstSample?.time ? new Date(firstSample.time).getTime() : null
  const lastTime = lastSample?.time ? new Date(lastSample.time).getTime() : null

  if (Number.isFinite(firstTime) && Number.isFinite(lastTime) && lastTime > firstTime) {
    const totalTime = lastTime - firstTime
    return segmentSamples.map((sample, index) => {
      const fallback = index / (segmentSamples.length - 1)
      const sampleTime = sample.time ? new Date(sample.time).getTime() : null
      const progress = Number.isFinite(sampleTime)
        ? (sampleTime - firstTime) / totalTime
        : fallback
      return clamp01(progress)
    })
  }

  return segmentSamples.map((_, index) => index / (segmentSamples.length - 1))
}

function interpolateNumber(from, to, ratio) {
  if (Number.isFinite(from) && Number.isFinite(to)) {
    return from + (to - from) * ratio
  }

  return Number.isFinite(from) ? from : Number.isFinite(to) ? to : null
}

async function correctTrackElevation(track) {
  const elevationProfile = buildElevationQueryProfile(track.points)
  const queriedElevations = await fetchElevationProfile(elevationProfile.queryPoints)
  const correctedElevations = interpolateElevationProfile(elevationProfile, queriedElevations)
  const nextSamples = track.samples.map((sample) => ({ ...sample }))

  track.points.forEach((point, index) => {
    const nextElevation = correctedElevations[index]
    if (Number.isFinite(nextElevation)) {
      nextSamples[point.sampleIndex] = {
        ...nextSamples[point.sampleIndex],
        ele: nextElevation,
      }
    }
  })

  return finalizeTrack({
    ...track,
    samples: nextSamples,
  })
}

async function fetchElevationProfile(points) {
  try {
    return await fetchOpenElevationProfile(points)
  }
  catch (primaryError) {
    try {
      return await fetchOpenMeteoElevationProfile(points)
    }
    catch (fallbackError) {
      const primaryDetail = primaryError instanceof Error ? primaryError.message : 'primary service failed'
      const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : 'fallback service failed'
      throw new Error(`Terrain services are unavailable. ${primaryDetail}. ${fallbackDetail}.`, {
        cause: fallbackError,
      })
    }
  }
}

async function fetchOpenElevationProfile(points) {
  let response
  try {
    response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations: points.map((point) => ({
          latitude: roundCoordinate(point.lat),
          longitude: roundCoordinate(point.lon),
        })),
      }),
    })
  }
  catch (networkError) {
    const detail = networkError instanceof Error ? networkError.message : 'network error'
    throw new Error(`Primary terrain service is unreachable: ${detail}`, {
      cause: networkError,
    })
  }

  if (!response.ok) {
    const detail = await readApiError(response)
    throw new Error(`Primary terrain service returned ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  const data = await response.json()
  if (!Array.isArray(data.results) || data.results.length !== points.length) {
    throw new Error('Primary terrain service returned incomplete elevation data')
  }

  return data.results.map((result) => (
    Number.isFinite(result.elevation) ? result.elevation : null
  ))
}

async function fetchOpenMeteoElevationProfile(points) {
  const batchSize = 100
  const elevations = []

  for (let offset = 0; offset < points.length; offset += batchSize) {
    const batch = points.slice(offset, offset + batchSize)
    const params = new URLSearchParams({
      latitude: batch.map((point) => roundCoordinate(point.lat)).join(','),
      longitude: batch.map((point) => roundCoordinate(point.lon)).join(','),
    })

    let response
    try {
      response = await fetch(`https://api.open-meteo.com/v1/elevation?${params.toString()}`, {
        method: 'GET',
      })
    }
    catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : 'network error'
      throw new Error(`Fallback terrain service is unreachable: ${detail}`, {
        cause: networkError,
      })
    }

    if (!response.ok) {
      const detail = await readApiError(response)
      throw new Error(`Fallback terrain service returned ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    const data = await response.json()
    if (!Array.isArray(data.elevation) || data.elevation.length !== batch.length) {
      throw new Error('Fallback terrain service returned incomplete elevation data')
    }

    data.elevation.forEach((elevation) => {
      elevations.push(Number.isFinite(elevation) ? elevation : null)
    })
  }

  return elevations
}

function buildElevationQueryProfile(points, minimumSpacingMeters = 50, maxQueryPoints = 450) {
  const pointDistances = [0]
  let totalDistance = 0

  for (let index = 1; index < points.length; index += 1) {
    totalDistance += haversineDistance(points[index - 1], points[index])
    pointDistances.push(totalDistance)
  }

  const spacingMeters = Math.max(
    minimumSpacingMeters,
    totalDistance / Math.max(1, maxQueryPoints - 1),
  )
  const queryPoints = [points[0]]
  const queryPointIndexes = [0]
  let lastQueryDistance = 0

  for (let index = 1; index < points.length; index += 1) {
    if (pointDistances[index] - lastQueryDistance >= spacingMeters || index === points.length - 1) {
      queryPoints.push(points[index])
      queryPointIndexes.push(index)
      lastQueryDistance = pointDistances[index]
    }
  }

  return {
    pointDistances,
    queryPoints,
    queryPointIndexes,
  }
}

function interpolateElevationProfile(profile, queriedElevations) {
  const { pointDistances, queryPointIndexes } = profile
  const elevations = new Array(pointDistances.length)

  for (let queryIndex = 0; queryIndex < queryPointIndexes.length - 1; queryIndex += 1) {
    const startIndex = queryPointIndexes[queryIndex]
    const endIndex = queryPointIndexes[queryIndex + 1]
    const startDistance = pointDistances[startIndex]
    const endDistance = pointDistances[endIndex]
    const startElevation = queriedElevations[queryIndex]
    const endElevation = queriedElevations[queryIndex + 1]
    const distanceDelta = endDistance - startDistance

    for (let pointIndex = startIndex; pointIndex <= endIndex; pointIndex += 1) {
      const ratio = distanceDelta > 0
        ? (pointDistances[pointIndex] - startDistance) / distanceDelta
        : 0
      elevations[pointIndex] = interpolateNumber(startElevation, endElevation, ratio)
    }
  }

  return elevations
}

async function readApiError(response) {
  try {
    const data = await response.json()
    return typeof data.reason === 'string' ? data.reason : ''
  }
  catch {
    return ''
  }
}

function rebuildSegmentSamples(anchorSample, segmentSamples, routeGeometry, rebuildDirection) {
  if (!segmentSamples.length) {
    return []
  }

  const ratios = getSegmentProgressRatios(anchorSample, segmentSamples, rebuildDirection)
  return segmentSamples.map((sample, index) => {
    const point = getPointOnPolyline(routeGeometry, ratios[index])
    return {
      ...sample,
      lat: point.lat,
      lon: point.lon,
    }
  })
}

function getSegmentProgressRatios(anchorSample, segmentSamples, rebuildDirection) {
  const allSamples = [anchorSample, ...segmentSamples]
  const lastSegmentSample = segmentSamples[segmentSamples.length - 1]
  const firstSegmentSample = segmentSamples[0]

  if (
    Number.isFinite(anchorSample?.distance) &&
    (
      (rebuildDirection === 'after' &&
        Number.isFinite(lastSegmentSample?.distance) &&
        lastSegmentSample.distance > anchorSample.distance) ||
      (rebuildDirection === 'before' &&
        Number.isFinite(firstSegmentSample?.distance) &&
        anchorSample.distance > firstSegmentSample.distance)
    )
  ) {
    const totalDistance = rebuildDirection === 'before'
      ? anchorSample.distance - firstSegmentSample.distance
      : lastSegmentSample.distance - anchorSample.distance
    return segmentSamples.map((sample, index) => {
      const delta = Number.isFinite(sample.distance)
        ? (rebuildDirection === 'before'
            ? sample.distance - firstSegmentSample.distance
            : sample.distance - anchorSample.distance)
        : ((index + 1) / segmentSamples.length) * totalDistance
      return clamp01(delta / totalDistance)
    })
  }

  const segmentStartTime = firstSegmentSample?.time ? new Date(firstSegmentSample.time).getTime() : null
  const anchorTime = anchorSample?.time ? new Date(anchorSample.time).getTime() : null
  const segmentEndTime = lastSegmentSample?.time ? new Date(lastSegmentSample.time).getTime() : null

  if (
    rebuildDirection === 'before' &&
    Number.isFinite(segmentStartTime) &&
    Number.isFinite(anchorTime) &&
    anchorTime > segmentStartTime
  ) {
    const totalTime = anchorTime - segmentStartTime
    return segmentSamples.map((sample, index) => {
      const sampleTime = sample.time ? new Date(sample.time).getTime() : null
      const value = Number.isFinite(sampleTime)
        ? sampleTime - segmentStartTime
        : ((index + 1) / segmentSamples.length) * totalTime
      return clamp01(value / totalTime)
    })
  }

  if (
    rebuildDirection === 'after' &&
    Number.isFinite(anchorTime) &&
    Number.isFinite(segmentEndTime) &&
    segmentEndTime > anchorTime
  ) {
    const totalTime = segmentEndTime - anchorTime
    return segmentSamples.map((sample, index) => {
      const sampleTime = sample.time ? new Date(sample.time).getTime() : null
      const value = Number.isFinite(sampleTime)
        ? sampleTime - anchorTime
        : ((index + 1) / segmentSamples.length) * totalTime
      return clamp01(value / totalTime)
    })
  }

  return allSamples.slice(1).map((_, index) => (index + 1) / segmentSamples.length)
}

async function loadTrack(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'gpx') {
    return readGpxFile(file)
  }

  if (extension === 'fit') {
    return readFitFile(file)
  }

  throw new Error('Only GPX and FIT files are supported.')
}

async function readGpxFile(file) {
  const content = await file.text()
  const xml = new DOMParser().parseFromString(content, 'application/xml')
  const geoJson = toGeoJsonGpx(xml)
  const feature = geoJson.features.find((item) => item.geometry?.type === 'LineString')

  if (!feature) {
    throw new Error('No track geometry was found in the GPX file.')
  }

  const coordinates = feature.geometry.coordinates
  const times = feature.properties?.coordinateProperties?.times ?? []
  const elevations = feature.properties?.coordinateProperties?.ele ?? []

  const samples = coordinates.map((coordinate, index) => ({
    lat: coordinate[1],
    lon: coordinate[0],
    ele: coordinate[2] ?? elevations[index] ?? null,
    time: times[index] ?? null,
    speed: null,
    distance: null,
    heartRate: readHeartRateFromGpx(xml, index),
    cadence: null,
    power: null,
    temperature: null,
  }))

  return finalizeTrack({
    name: file.name.replace(/\.gpx$/i, ''),
    format: 'gpx',
    samples,
  })
}

async function readFitFile(file) {
  const fitParser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    elapsedRecordField: true,
    mode: 'list',
  })

  const buffer = await file.arrayBuffer()
  const data = await fitParser.parseAsync(new Uint8Array(buffer))
  const records = Array.isArray(data.records) ? data.records : []

  const samples = records.map((record) => ({
    lat: Number.isFinite(record.position_lat) ? normalizeFitCoordinate(record.position_lat) : null,
    lon: Number.isFinite(record.position_long) ? normalizeFitCoordinate(record.position_long) : null,
    ele: Number.isFinite(record.altitude) ? record.altitude : null,
    time: record.timestamp ? new Date(record.timestamp).toISOString() : null,
    speed: Number.isFinite(record.speed) ? record.speed : null,
    distance: Number.isFinite(record.distance) ? record.distance : null,
    heartRate: Number.isFinite(record.heart_rate) ? record.heart_rate : null,
    cadence: Number.isFinite(record.cadence) ? record.cadence : null,
    power: Number.isFinite(record.power) ? record.power : null,
    temperature: Number.isFinite(record.temperature) ? record.temperature : null,
  }))

  if (!samples.some((sample) => Number.isFinite(sample.lat) && Number.isFinite(sample.lon))) {
    throw new Error('No valid GPS points were found in the FIT file.')
  }

  return finalizeTrack({
    name: file.name.replace(/\.fit$/i, ''),
    format: 'fit',
    samples,
  })
}

function finalizeTrack(track) {
  const samples = (track.samples ?? []).map((sample) => ({
    ...sample,
    heartRate: Number.isFinite(sample.heartRate) ? sample.heartRate : null,
    distance: Number.isFinite(sample.distance) ? sample.distance : null,
    speed: Number.isFinite(sample.speed) ? sample.speed : null,
    ele: Number.isFinite(sample.ele) ? sample.ele : null,
    cadence: Number.isFinite(sample.cadence) ? sample.cadence : null,
    power: Number.isFinite(sample.power) ? sample.power : null,
    temperature: Number.isFinite(sample.temperature) ? sample.temperature : null,
  }))

  const points = samples
    .map((sample, sampleIndex) => (
      Number.isFinite(sample.lat) && Number.isFinite(sample.lon)
        ? { ...sample, sampleIndex }
        : null
    ))
    .filter(Boolean)

  if (points.length < 2) {
    throw new Error('The track does not have enough valid GPS points.')
  }

  const pointSegments = buildPointSegments(points)

  return {
    ...track,
    samples,
    points,
    pointSegments,
    distanceMeters: pointSegments.reduce((total, segment) => total + getPolylineLength(segment), 0),
  }
}

function buildPointSegments(points) {
  if (!points.length) {
    return []
  }

  return [points]
}

function buildGpx(track) {
  const trackName = escapeXml(track.name || 'Fixed Track')
  const pointSegments = track.pointSegments ?? buildPointSegments(track.points ?? [])
  const segmentsXml = pointSegments
    .map((segment) => {
      const pointsXml = segment
        .map((point) => {
          const ele = point.ele !== null && point.ele !== undefined ? `<ele>${point.ele}</ele>` : ''
          const time = point.time ? `<time>${escapeXml(point.time)}</time>` : ''
          const extensions = buildTrackPointExtensions(point)
          return `<trkpt lat="${point.lat}" lon="${point.lon}">${ele}${time}${extensions}</trkpt>`
        })
        .join('')

      return `<trkseg>${pointsXml}</trkseg>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fix Your Track" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:fixtrack="https://fixyourtrack.local/extensions/v1">
  <trk>
    <name>${trackName}</name>
    ${segmentsXml}
  </trk>
</gpx>`
}

function buildTrackPointExtensions(point) {
  const extensionFields = []
  const customFields = []

  if (Number.isFinite(point.heartRate)) {
    extensionFields.push(`<gpxtpx:hr>${Math.round(point.heartRate)}</gpxtpx:hr>`)
  }

  if (Number.isFinite(point.speed)) {
    extensionFields.push(`<gpxtpx:speed>${point.speed}</gpxtpx:speed>`)
  }

  if (Number.isFinite(point.cadence)) {
    extensionFields.push(`<gpxtpx:cad>${Math.round(point.cadence)}</gpxtpx:cad>`)
  }

  if (Number.isFinite(point.temperature)) {
    extensionFields.push(`<gpxtpx:atemp>${point.temperature}</gpxtpx:atemp>`)
  }

  if (Number.isFinite(point.power)) {
    customFields.push(`<fixtrack:power>${Math.round(point.power)}</fixtrack:power>`)
  }

  if (!extensionFields.length && !customFields.length) {
    return ''
  }

  const parts = []

  if (extensionFields.length) {
    parts.push(`<gpxtpx:TrackPointExtension>${extensionFields.join('')}</gpxtpx:TrackPointExtension>`)
  }

  if (customFields.length) {
    parts.push(customFields.join(''))
  }

  return `<extensions>${parts.join('')}</extensions>`
}

function getSuspiciousSegments(points) {
  const detectedSegments = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    if (current.repairAccepted && next.repairAccepted) {
      continue
    }

    const distance = haversineDistance(current, next)
    const seconds = getSecondsBetween(current.time, next.time)
    const calcSpeedKmh = seconds > 0 ? (distance / seconds) * 3.6 : null
    const deviceSpeedKmh = maxSpeedKmh(current.speed, next.speed)
    const likelySignalLoss =
      distance >= 120 &&
      (
        seconds === null ||
        (seconds >= 30 && distance >= 120) ||
        (seconds >= 120 && distance >= 60) ||
        (calcSpeedKmh !== null && calcSpeedKmh > 42) ||
        (deviceSpeedKmh !== null && deviceSpeedKmh < 12 && distance > 180)
      )

    if (likelySignalLoss) {
      const expanded = expandSuspiciousSegment(points, index, index + 1)
      detectedSegments.push({
        ...expanded,
        distance,
        seconds,
        calcSpeedKmh,
        deviceSpeedKmh,
      })
    }
  }

  return mergeSuspiciousSegments(detectedSegments, points)
}

function expandSuspiciousSegment(points, startIndex, endIndex) {
  return {
    startIndex: findSignalContextBoundary(points, startIndex, -1),
    endIndex: findSignalContextBoundary(points, endIndex, 1),
  }
}

function findSignalContextBoundary(points, originIndex, direction) {
  const origin = points[originIndex]
  let boundaryIndex = originIndex
  let travelledDistance = 0

  for (let step = 1; step <= 15; step += 1) {
    const candidateIndex = originIndex + step * direction
    const previousIndex = candidateIndex - direction
    const candidate = points[candidateIndex]
    const previous = points[previousIndex]

    if (!candidate || !previous || candidate.repairAccepted) {
      break
    }

    const elapsedSeconds = getContextElapsedSeconds(candidate.time, origin.time)
    travelledDistance += haversineDistance(candidate, previous)
    if (elapsedSeconds > 20 || travelledDistance > 120) {
      break
    }

    boundaryIndex = candidateIndex
  }

  return boundaryIndex
}

function getContextElapsedSeconds(firstTime, secondTime) {
  if (!firstTime || !secondTime) {
    return 0
  }

  const firstMs = new Date(firstTime).getTime()
  const secondMs = new Date(secondTime).getTime()
  return Number.isFinite(firstMs) && Number.isFinite(secondMs)
    ? Math.abs(secondMs - firstMs) / 1000
    : 0
}

function mergeSuspiciousSegments(segments, points) {
  const merged = []

  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (!previous || segment.startIndex > previous.endIndex) {
      merged.push({
        ...segment,
        startSampleIndex: points[segment.startIndex].sampleIndex,
        endSampleIndex: points[segment.endIndex].sampleIndex,
      })
      continue
    }

    previous.endIndex = Math.max(previous.endIndex, segment.endIndex)
    previous.endSampleIndex = points[previous.endIndex].sampleIndex
    previous.distance = Math.max(previous.distance, segment.distance)
    previous.seconds = Math.max(previous.seconds ?? 0, segment.seconds ?? 0)
    previous.calcSpeedKmh = Math.max(previous.calcSpeedKmh ?? 0, segment.calcSpeedKmh ?? 0)
    previous.deviceSpeedKmh = Math.max(previous.deviceSpeedKmh ?? 0, segment.deviceSpeedKmh ?? 0)
  }

  return merged
}

function getPointOnPolyline(points, ratio) {
  if (ratio <= 0) {
    return { lat: points[0].lat, lon: points[0].lon }
  }

  if (ratio >= 1) {
    const lastPoint = points[points.length - 1]
    return { lat: lastPoint.lat, lon: lastPoint.lon }
  }

  const totalLength = getPolylineLength(points)
  if (totalLength === 0) {
    return { lat: points[0].lat, lon: points[0].lon }
  }

  let targetDistance = totalLength * ratio

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const segmentLength = haversineDistance(from, to)

    if (targetDistance <= segmentLength || index === points.length - 2) {
      const localRatio = segmentLength === 0 ? 0 : targetDistance / segmentLength
      return {
        lat: from.lat + (to.lat - from.lat) * localRatio,
        lon: from.lon + (to.lon - from.lon) * localRatio,
      }
    }

    targetDistance -= segmentLength
  }

  const lastPoint = points[points.length - 1]
  return { lat: lastPoint.lat, lon: lastPoint.lon }
}

function getPolylineLength(points) {
  let totalLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += haversineDistance(points[index], points[index + 1])
  }

  return totalLength
}

function findNearestPointIndex(points, latlng, maxDistanceMeters = 100) {
  let bestIndex = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < points.length; index += 1) {
    const distance = haversineDistance(points[index], { lat: latlng.lat, lon: latlng.lng })
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestDistance <= maxDistanceMeters ? bestIndex : null
}

function findNearestSuspiciousSegment(segments, points, latlng, maxDistanceMeters = 100) {
  let bestSegment = null
  let bestDistance = Number.POSITIVE_INFINITY
  const clickedPoint = { lat: latlng.lat, lon: latlng.lng }

  for (const segment of segments) {
    const segmentPoints = points.slice(segment.startIndex, segment.endIndex + 1)
    if (segmentPoints.length < 2) {
      continue
    }

    const distance = getDistanceToPolyline(clickedPoint, segmentPoints)
    if (distance < bestDistance) {
      bestDistance = distance
      bestSegment = segment
    }
  }

  return bestDistance <= maxDistanceMeters ? bestSegment : null
}

function haversineDistance(from, to) {
  const earthRadius = 6371000
  const lat1 = degreesToRadians(from.lat)
  const lat2 = degreesToRadians(to.lat)
  const latDiff = degreesToRadians(to.lat - from.lat)
  const lonDiff = degreesToRadians(to.lon - from.lon)

  const value =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDiff / 2) * Math.sin(lonDiff / 2)

  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180
}

function maxSpeedKmh(firstSpeed, secondSpeed) {
  const values = [firstSpeed, secondSpeed].filter(Number.isFinite)
  if (!values.length) {
    return null
  }

  return Math.max(...values) * 3.6
}

function getSecondsBetween(firstTime, secondTime) {
  if (!firstTime || !secondTime) {
    return null
  }

  const firstMs = new Date(firstTime).getTime()
  const secondMs = new Date(secondTime).getTime()

  if (!Number.isFinite(firstMs) || !Number.isFinite(secondMs)) {
    return null
  }

  return Math.max(0, (secondMs - firstMs) / 1000)
}

function normalizeFitCoordinate(value) {
  if (!Number.isFinite(value)) {
    return value
  }

  if (Math.abs(value) <= 180) {
    return value
  }

  return (value * 180) / 2147483648
}

function readHeartRateFromGpx(xml, index) {
  const trackPoints = xml.getElementsByTagNameNS('*', 'trkpt')
  const point = trackPoints[index]
  if (!point) {
    return null
  }

  const hrNode = point.getElementsByTagNameNS('*', 'hr')[0]
  if (!hrNode) {
    return null
  }

  const value = Number.parseFloat(hrNode.textContent ?? '')
  return Number.isFinite(value) ? value : null
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return 'unknown'
  }

  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`
  }

  return `${Math.round(distanceMeters)} m`
}

function formatDraftDate(value, language) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return 'unknown time'
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function formatLatLon(point) {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function roundCoordinate(value) {
  return Number.parseFloat(value.toFixed(6))
}

function sanitizeFilename(name) {
  return Array.from(name, (char) => (
    /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? '-' : char
  )).join('')
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export default App
