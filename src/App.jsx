import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { deleteRepairDraft, loadRepairDraft, saveRepairDraft } from './draftStore'
import { parseGpxDocument } from './gpx'
import { translate } from './i18n'
import {
  directLegMode,
  getLegMode,
  getRouteStartControlId,
  removeWaypointLeg,
  routedLegMode,
  setLegMode,
  splitLeg,
} from './routeLegs'
import { getRoutingRequests, parseRoutingResponse } from './routing'
import { getSuspiciousSegments } from './trackDetection'
import {
  anchorRouteGeometry,
  buildExportTrack,
  buildGpx,
  finalizeTrack,
  getPolylineLength,
  haversineDistance,
  isValidCoordinate,
} from './trackCore'
import packageMetadata from '../package.json'

const TrackCharts = lazy(() => import('./TrackCharts'))
const TrackMap = lazy(() => import('./TrackMap'))
const initialView = [55.751244, 37.618423]
const minimumSidebarWidth = 380
const instructionContent = {
  ru: {
    button: 'Инструкция',
    title: 'Как чинить трек',
    intro: 'Выберите сценарий, который похож на вашу поломку. Важно: сначала закончите активное исправление, потом переходите к следующему.',
    scenarios: [
      {
        title: 'Если потерян кусок в начале или в конце',
        steps: [
          'Загрузите GPX или FIT.',
          'Кликните по последней надёжной точке перед плохим концом или по первой надёжной точке после плохого начала.',
          'Для потерянного начала нажмите “Удалить всё до точки обрезки”. Для потерянного конца нажмите “Удалить всё после точки обрезки”.',
          'Кликните на карте, где должен быть реальный старт или финиш.',
          'Проверьте синюю предложенную линию. Если надо, кликните по линии, добавьте точки и перетащите их на реальный путь.',
          'Когда линия стала правильной, нажмите “Применить восстановленный участок”.',
        ],
      },
      {
        title: 'Если плохой участок в середине',
        steps: [
          'Выберите проблему в “Очереди исправлений” или нажмите “Исправить следующую проблему”.',
          'Приложение зафиксирует начало и конец повреждённого участка и покажет синюю замену.',
          'Кликните по синей линии, чтобы добавить точку. Перетащите точку туда, где реально проходил маршрут.',
          'Добавляйте столько точек, сколько нужно. Точки нумеруются по порядку маршрута.',
          'Если GPS начал плыть чуть раньше или позже, используйте “Захватить более ранний дрейф GPS” или “Захватить более поздний дрейф GPS”.',
          'Когда участок выглядит правильно, нажмите “Применить исправление участка”.',
        ],
      },
      {
        title: 'Если нужен off-grid участок',
        steps: [
          'Начните обычное исправление начала, конца или середины.',
          'До места, где есть дороги или тропы на карте, работайте обычными точками на синей линии.',
          'Когда нужно пройти там, где дороги нет, нажмите “Добавить точку ручной трассировки”.',
          'Каждый следующий клик по карте добавит прямой участок от предыдущей точки.',
          'Когда ручной участок закончился, нажмите “Завершить ручную трассировку”. Дальше маршрут снова будет следовать дорогам.',
          'Другой способ: кликните по номеру точки и включите “Следующий участок вне дорог” в карточке точки.',
        ],
      },
      {
        title: 'Если нужно поправить или удалить точки',
        steps: [
          'Перетащите номерную точку, чтобы изменить форму маршрута.',
          'Кликните по номеру точки, чтобы открыть карточку.',
          'В карточке можно удалить точку или переключить следующий участок между дорогами и off-grid.',
          'Если удалить off-grid точку, соединённый участок снова строится по дорогам. Если нужен прямой участок, включите off-grid заново для нужной точки.',
        ],
      },
      {
        title: 'Как экспортировать',
        steps: [
          'Сначала примените или отмените все активные исправления. Пока исправление открыто, экспорт заблокирован.',
          'Если нужна коррекция высоты по рельефу, включите её в “Настройках”.',
          'Нажмите “Экспортировать исправленный GPX”.',
          'Полученный GPX можно загружать в Strava, Komoot и другие сервисы.',
        ],
      },
      {
        title: 'Важное ограничение',
        steps: [
          'Если начало трека полностью отсутствует в файле, приложение пока не может создать полноценный новый старт.',
          'Причина: в файле нет записей времени, скорости, пульса, мощности и дистанции для отсутствующего участка.',
          'Если GPS-точки плохие, но записи в файле есть, такой участок можно заменить. Если записей вообще нет, сейчас можно только продолжить работу с имеющейся частью трека.',
        ],
      },
    ],
  },
  en: {
    button: 'Instructions',
    title: 'How to repair a track',
    intro: 'Pick the scenario that matches your broken track. Finish the current repair before starting the next one.',
    scenarios: [
      {
        title: 'If a piece is missing at the start or end',
        steps: [
          'Load a GPX or FIT file.',
          'Click the last trusted point before a bad ending, or the first trusted point after a bad start.',
          'For a missing start, click “Delete everything before cut point”. For a missing end, click “Delete everything after cut point”.',
          'Click the map where the real start or finish should be.',
          'Check the blue suggested line. If needed, click the line, add points, and drag them onto the real route.',
          'When the line is correct, click “Apply rebuilt segment”.',
        ],
      },
      {
        title: 'If the bad section is in the middle',
        steps: [
          'Select an item in the repair queue, or click “Repair next issue”.',
          'The app fixes the start and end borders of the damaged section and shows a blue replacement.',
          'Click the blue line to add a point. Drag the point to where the real route went.',
          'Add as many points as needed. Points are numbered in route order.',
          'If GPS started drifting slightly earlier or later, use “Include earlier GPS drift” or “Include later GPS drift”.',
          'When the section looks correct, click “Apply middle segment”.',
        ],
      },
      {
        title: 'If you need an off-grid section',
        steps: [
          'Start a normal repair for the start, end, or middle.',
          'Use normal blue-line points while mapped roads or paths exist.',
          'When the real route goes where no road exists, click “Add direct trace point”.',
          'Each next map click adds a direct section from the previous point.',
          'When the manual section ends, click “Finish manual tracing”. After that the route follows roads again.',
          'Alternative: click a point number and enable “Set following segment as off-grid” in its card.',
        ],
      },
      {
        title: 'If you need to adjust or delete points',
        steps: [
          'Drag a numbered point to reshape the route.',
          'Click a point number to open its card.',
          'The card can remove the point or switch the following section between roads and off-grid.',
          'Deleting an off-grid point rebuilds the joined section along roads. If you still need a direct section, enable off-grid again on the correct point.',
        ],
      },
      {
        title: 'How to export',
        steps: [
          'Apply or cancel every active repair first. Export is blocked while a repair is open.',
          'If terrain elevation correction is needed, enable it in Settings.',
          'Click “Export cleaned GPX”.',
          'Upload the exported GPX to Strava, Komoot, or another service.',
        ],
      },
      {
        title: 'Important limit',
        steps: [
          'If the track start is completely absent from the file, the app cannot yet create a full new start.',
          'Reason: the file has no time, speed, heart-rate, power, or distance records for that missing section.',
          'If GPS positions are wrong but records still exist, that section can be replaced. If records do not exist at all, only the existing recorded part can be repaired right now.',
        ],
      },
    ],
  },
}

function App() {
  const [language, setLanguage] = useState(getStoredLanguage)
  const [theme, setTheme] = useState(getStoredTheme)
  const [isInstructionOpen, setIsInstructionOpen] = useState(false)
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
  const [legModes, setLegModes] = useState({})
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
  const manualTraceAnchorIdRef = useRef(null)
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
        { id: 'endpoint', lat: endpoint.lat, lon: endpoint.lon, kind: 'endpoint' },
        ...viaPoints.map((point) => ({ ...point, kind: 'via' })),
        { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon, kind: 'anchor' },
      ]
    }

    return [
      { id: 'anchor', lat: anchorPoint.lat, lon: anchorPoint.lon, kind: 'anchor' },
      ...viaPoints.map((point) => ({ ...point, kind: 'via' })),
      { id: 'endpoint', lat: endpoint.lat, lon: endpoint.lon, kind: 'endpoint' },
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

  const routeStartDistanceMeters = useMemo(() => {
    if (rebuildDirection === 'before' || !anchorPoint) {
      return 0
    }
    if (Number.isFinite(anchorPoint.distance)) {
      return anchorPoint.distance
    }
    return getTrackDistanceToSample(track?.points ?? [], anchorPoint.sampleIndex)
  }, [anchorPoint, rebuildDirection, track?.points])

  const waypointDetails = useMemo(() => {
    let cumulativeDistance = routeStartDistanceMeters
    return viaPoints.map((point, index) => {
      const segmentDistance = effectiveRoutePreview.segments[index]?.distanceMeters
      cumulativeDistance = Number.isFinite(cumulativeDistance) && Number.isFinite(segmentDistance)
        ? cumulativeDistance + segmentDistance
        : null
      return {
        ...point,
        distanceMeters: cumulativeDistance,
        elevation: findNearestRecordedElevation(point, track?.points ?? []),
        isOffGrid: getLegMode(legModes, point.id) === directLegMode,
        number: index + 2,
      }
    })
  }, [effectiveRoutePreview.segments, legModes, routeStartDistanceMeters, track?.points, viaPoints])

  const waypointCardLabels = useMemo(() => ({
    close: translate(language, 'closeWaypointCard'),
    distance: translate(language, 'waypointDistance'),
    elevation: translate(language, 'waypointElevation'),
    notAvailable: translate(language, 'notAvailable'),
    offGridSegment: translate(language, 'setOffGridSegment'),
    remove: translate(language, 'removeWaypoint'),
    title: translate(language, 'waypointCardTitle'),
  }), [language])

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
  const activeRepairDraft = useMemo(() => (
    rebuildDirection
      ? {
          selectedCutPointIndex,
          tailAnchorPointIndex,
          removedSegmentSamples,
          rebuildDirection,
          middleRepairRange,
          endpoint,
          viaPoints,
          legModes,
          activeWaypointId,
          mapMode,
          routePreview,
        }
      : null
  ), [
    activeWaypointId,
    endpoint,
    mapMode,
    legModes,
    middleRepairRange,
    rebuildDirection,
    removedSegmentSamples,
    routePreview,
    selectedCutPointIndex,
    tailAnchorPointIndex,
    viaPoints,
  ])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-language', language)
  }, [language])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!isInstructionOpen) {
      return undefined
    }

    function handleInstructionKeyDown(event) {
      if (event.key === 'Escape') {
        setIsInstructionOpen(false)
      }
    }

    window.addEventListener('keydown', handleInstructionKeyDown)
    return () => window.removeEventListener('keydown', handleInstructionKeyDown)
  }, [isInstructionOpen])

  useEffect(() => {
    window.localStorage.setItem('fixyourtrack-route-profile', routeProfile)
  }, [routeProfile])

  useEffect(() => {
    if (mapMode !== 'add-offgrid-waypoint') {
      manualTraceAnchorIdRef.current = null
    }
  }, [mapMode])

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
      saveRepairDraft(sourceTrack, track, activeRepairDraft)
        .then((savedAt) => setDraftSavedAt(savedAt))
        .catch(() => {})
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [activeRepairDraft, sourceTrack, track])

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
          const forceDirect = getLegMode(legModes, from.id) === directLegMode
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
  }, [controlPoints, endpoint, legModes, routeProfile])

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
      setLegModes({})
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
      setLegModes({})
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
    setLegModes({})
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
    setLegModes({})
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
    setLegModes({})
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
    setLegModes({})
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
      const repairSession = availableDraft.repairSession
      const hasRepairSession = ['before', 'after', 'middle'].includes(repairSession?.rebuildDirection)

      setSourceTrack(restoredSource)
      setTrack(restoredWorking)
      setSelectedCutPointIndex(hasRepairSession ? repairSession.selectedCutPointIndex ?? null : null)
      setTailAnchorPointIndex(hasRepairSession ? repairSession.tailAnchorPointIndex ?? null : null)
      setRemovedSegmentSamples(hasRepairSession ? repairSession.removedSegmentSamples ?? [] : [])
      setRebuildDirection(hasRepairSession ? repairSession.rebuildDirection : null)
      setMiddleRepairRange(hasRepairSession ? repairSession.middleRepairRange ?? null : null)
      setEndpoint(hasRepairSession ? repairSession.endpoint ?? null : null)
      setViaPoints(hasRepairSession ? repairSession.viaPoints ?? [] : [])
      setLegModes(hasRepairSession ? repairSession.legModes ?? {} : {})
      setActiveWaypointId(hasRepairSession ? repairSession.activeWaypointId ?? null : null)
      setMapMode(hasRepairSession ? repairSession.mapMode ?? 'inspect' : 'inspect')
      setRoutePreview(hasRepairSession && repairSession.routePreview
        ? repairSession.routePreview
        : {
            status: 'idle',
            error: '',
            segments: [],
            geometry: [],
            distanceMeters: 0,
          })
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
    setLegModes({})
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
    setLegModes({})
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
    setLegModes({})
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
      addWaypointAtLocation(latlng, {
        continueManualTracing: true,
        insertAfterId: manualTraceAnchorIdRef.current,
        manualPoint: true,
        incomingMode: directLegMode,
        outgoingMode: routedLegMode,
      })
    }
  }

  function placeEndpoint(latlng) {
    const isInitialPlacement = !endpoint
    setEndpoint({ lat: latlng.lat, lon: latlng.lng })
    if (isInitialPlacement) {
      setViaPoints([])
      setLegModes({})
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

    addWaypointAtLocation(latlng, {
      insertAfterId: segment.insertAfterId,
      manualPoint: segment.mode === 'direct',
      incomingMode: segment.mode,
      outgoingMode: segment.mode,
    })
  }

  function addWaypointAtLocation(latlng, {
    continueManualTracing = false,
    insertAfterId: preferredInsertAfterId = null,
    manualPoint = false,
    incomingMode = null,
    outgoingMode = null,
  } = {}) {
    const nextWaypoint = createWaypoint(latlng, manualPoint)
    const insertAfterId = preferredInsertAfterId ?? getNearestRouteInsertAfterId(
      latlng,
      effectiveRoutePreview.segments,
      getRouteStartControlId(rebuildDirection),
    )
    const insertIndex = resolveInsertIndexFromControlId(insertAfterId, viaPoints, rebuildDirection)

    setViaPoints((current) => {
      const next = [...current]
      next.splice(insertIndex, 0, nextWaypoint)
      return next
    })
    setLegModes((current) => splitLeg(
      current,
      insertAfterId,
      nextWaypoint.id,
      incomingMode,
      outgoingMode,
    ))
    setActiveWaypointId(null)
    manualTraceAnchorIdRef.current = continueManualTracing ? nextWaypoint.id : null
    setMapMode(continueManualTracing ? 'add-offgrid-waypoint' : 'inspect')
    setMessage(
      manualPoint
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
    setMessage(t('waypointMovedPreserved'))
  }

  function removeWaypoint(waypointId) {
    if (manualTraceAnchorIdRef.current === waypointId) {
      const waypointIndex = viaPoints.findIndex((point) => point.id === waypointId)
      manualTraceAnchorIdRef.current = waypointIndex > 0
        ? viaPoints[waypointIndex - 1].id
        : getRouteStartControlId(rebuildDirection)
    }
    setLegModes((current) => removeWaypointLeg(current, viaPoints, waypointId, rebuildDirection))
    setViaPoints((current) => current.filter((point) => point.id !== waypointId))
    setActiveWaypointId((current) => (current === waypointId ? null : current))
    setMessage(t('waypointRemoved'))
  }

  function toggleRouteLeg(fromId) {
    const nextMode = getLegMode(legModes, fromId) === directLegMode
      ? routedLegMode
      : directLegMode
    setLegModes((current) => setLegMode(current, fromId, nextMode))
    setMessage(nextMode === directLegMode ? t('legSetManual') : t('legSetRouted'))
  }

  function toggleManualTracing() {
    if (mapMode === 'add-offgrid-waypoint') {
      manualTraceAnchorIdRef.current = null
      setMapMode('inspect')
      return
    }

    manualTraceAnchorIdRef.current = activeWaypointId
    setActiveWaypointId(null)
    setMapMode('add-offgrid-waypoint')
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

    if (rebuildDirection) {
      setError(t('finishRepairBeforeExport'))
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

  function applyTailRepair() {
    if (
      !track ||
      !['before', 'after'].includes(rebuildDirection) ||
      effectiveRoutePreview.status !== 'ready'
    ) {
      setError(t('waitForRoute'))
      return
    }

    const repairedTrack = buildExportTrack(
      track,
      removedSegmentSamples,
      effectiveRoutePreview.geometry,
      rebuildDirection,
    )

    setRepairHistory((current) => {
      const previous = current[current.length - 1]
      const completedEntry = {
        id: crypto.randomUUID(),
        type: rebuildDirection === 'before' ? 'rebuildBefore' : 'rebuildAfter',
        track: previous?.track ?? track,
        details: {
          distanceMeters: effectiveRoutePreview.distanceMeters,
          waypoints: viaPoints.length,
        },
      }
      return previous && ['deleteBefore', 'deleteAfter'].includes(previous.type)
        ? [...current.slice(0, -1), completedEntry]
        : [...current.slice(-11), completedEntry]
    })
    setTrack(repairedTrack)
    clearRepairSession()
    setMessage(t('tailApplied'))
  }

  function cancelTailRepair() {
    const previous = repairHistory[repairHistory.length - 1]
    if (previous && ['deleteBefore', 'deleteAfter'].includes(previous.type)) {
      setTrack(previous.track)
      setRepairHistory((current) => current.slice(0, -1))
    }
    else if (track && rebuildDirection === 'before') {
      setTrack(finalizeTrack({
        ...track,
        samples: [...removedSegmentSamples, ...track.samples],
      }))
    }
    else if (track && rebuildDirection === 'after') {
      setTrack(finalizeTrack({
        ...track,
        samples: [...track.samples, ...removedSegmentSamples],
      }))
    }

    clearRepairSession()
    setMessage(t('tailCancelled'))
  }

  function clearRepairSession() {
    setSelectedCutPointIndex(null)
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setMiddleRepairRange(null)
    setEndpoint(null)
    setViaPoints([])
    setLegModes({})
    setActiveWaypointId(null)
    setMapMode('inspect')
    setError('')
  }

  const activeWaypoint = activeWaypointId
    ? viaPoints.find((point) => point.id === activeWaypointId) ?? null
    : null
  const hasTrackEdits = Boolean(sourceTrack && track && sourceTrack !== track)
  const exportBlockedByRepair = Boolean(rebuildDirection)
  const isPickingEndpoint = mapMode === 'pick-endpoint'
  const isAddingOffGrid = mapMode === 'add-offgrid-waypoint'
  const endpointLabel = rebuildDirection === 'before'
    ? t('newStartLabel')
    : rebuildDirection === 'middle'
      ? t('repairEndBorder')
      : t('newEndpointLabel')
  const layoutSignature = `${collapsedPanels.track}-${collapsedPanels.visualization}-${collapsedPanels.suspicious}-${collapsedPanels.rebuild}-${collapsedPanels.waypoints}-${collapsedPanels.history}-${collapsedPanels.settings}`
  const middleStartPointIndex = middleRepairRange && track
    ? track.points.findIndex((point) => point.sampleIndex === middleRepairRange.startSampleIndex)
    : -1
  const middleEndPointIndex = middleRepairRange && track
    ? track.points.findIndex((point) => point.sampleIndex === middleRepairRange.endSampleIndex)
    : -1
  const instruction = instructionContent[language] ?? instructionContent.en

  return (
    <div className={`app-shell theme-${theme}`}>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{t('appEyebrow')}</p>
          <h1>{t('appTitle')}</h1>
          <p className="lead">{t('appLead')}</p>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="ghost-button instruction-button"
              onClick={() => setIsInstructionOpen(true)}
            >
              {instruction.button}
            </button>

            <label className="file-picker">
              <input type="file" accept=".gpx,.fit" onChange={handleFileChange} />
              <span>{t('loadTrack')}</span>
            </label>

            <button
              type="button"
              className="ghost-button"
              onClick={exportTrack}
              disabled={!track || isExporting || exportBlockedByRepair}
              title={exportBlockedByRepair ? t('finishRepairBeforeExport') : undefined}
            >
              {t('exportGpx')}
            </button>

            <label className="language-picker">
              <span>{t('language')}</span>
              <select value={language} onChange={(event) => changeLanguage(event.target.value)}>
                <option value="en">EN</option>
                <option value="ru">RU</option>
              </select>
            </label>

          </div>

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

      {isInstructionOpen ? (
        <div className="instruction-backdrop" onClick={() => setIsInstructionOpen(false)}>
          <article
            className="instruction-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instruction-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="instruction-sheet-header">
              <div>
                <p className="eyebrow">FixYourTrack</p>
                <h2 id="instruction-sheet-title">{instruction.title}</h2>
                <p>{instruction.intro}</p>
              </div>
              <button
                type="button"
                className="instruction-close"
                aria-label="Close instructions"
                onClick={() => setIsInstructionOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="instruction-scenarios">
              {instruction.scenarios.map((scenario) => (
                <section className="instruction-scenario" key={scenario.title}>
                  <h3>{scenario.title}</h3>
                  <ol>
                    {scenario.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </article>
        </div>
      ) : null}

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
                <Suspense fallback={<div className="component-loading">{t('loading')}</div>}>
                  <TrackCharts
                    onSelectionChange={setChartHighlightedPoints}
                    samples={visualizationTrack.samples}
                    t={t}
                  />
                </Suspense>
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
                    onClick={toggleManualTracing}
                    disabled={!endpoint}
                  >
                    {isAddingOffGrid ? t('cancelOffGrid') : t('addOffGrid')}
                  </button>
                  {rebuildDirection !== 'middle' ? (
                    <>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={applyTailRepair}
                        disabled={effectiveRoutePreview.status !== 'ready'}
                      >
                        {t('applyTail')}
                      </button>
                      <button type="button" className="ghost-button" onClick={cancelTailRepair}>
                        {t('cancelTail')}
                      </button>
                    </>
                  ) : null}
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

            {!collapsedPanels.waypoints && waypointDetails.length ? (
              <div className="segment-list">
                {waypointDetails.map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    className={`segment-button waypoint-list-button ${activeWaypointId === point.id ? 'segment-button-active' : ''}`}
                    onClick={() => setActiveWaypointId(point.id)}
                  >
                    <span className="waypoint-list-number">{point.number}</span>
                    <span className="waypoint-list-copy">
                      <strong>{t('waypoint', { number: point.number })}</strong>
                      <span>{formatLatLon(point)}</span>
                      <span>
                        {formatDistance(point.distanceMeters)}
                        {' · '}
                        {formatElevation(point.elevation, t('notAvailable'))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : !collapsedPanels.waypoints ? (
              <p className="muted-text">{t('waypointHelp')}</p>
            ) : null}

            {!collapsedPanels.waypoints && activeWaypoint ? (
              <p className="muted-text">{t('waypointCardOpen')}</p>
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

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>{t('settings')}</h2>
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('settings')} aria-label={t('togglePanel', { panel: t('settings') })}>
                {collapsedPanels.settings ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.settings ? (
              <div className="settings-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong>{t('interfaceTheme')}</strong>
                    <span>{t('interfaceThemeHelp')}</span>
                  </div>
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

                <label className="setting-row setting-row-checkbox">
                  <div className="setting-copy">
                    <strong>{t('correctElevation')}</strong>
                    <span>{t('correctElevationHelp')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={correctElevationOnExport}
                    onChange={(event) => setCorrectElevationOnExport(event.target.checked)}
                  />
                </label>

                <div className="setting-section-gap" aria-hidden="true" />

                <div className="setting-version">
                  <span>{t('version')}</span>
                  <strong>{packageMetadata.version}</strong>
                </div>
              </div>
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
          <Suspense fallback={<div className="map-loading">{t('loading')}</div>}>
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
            onWaypointOutgoingModeToggle={toggleRouteLeg}
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
            waypointCardLabels={waypointCardLabels}
            waypointDetails={waypointDetails}
            waypointLabel={t('waypointLabel')}
            />
          </Suspense>
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
  return ['cycling', 'walking'].includes(stored) ? stored : 'cycling'
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
    settings: false,
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
    rebuildBefore: 'historyRebuildBefore',
    rebuildAfter: 'historyRebuildAfter',
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
  const startControlId = getRouteStartControlId(rebuildDirection)

  if (controlId === startControlId) {
    return 0
  }

  const waypointIndex = viaPoints.findIndex((point) => point.id === controlId)
  if (waypointIndex === -1) {
    return viaPoints.length
  }

  return waypointIndex + 1
}

function getNearestRouteInsertAfterId(latlng, segments, fallbackInsertAfterId) {
  if (!segments.length) {
    return fallbackInsertAfterId
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
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) {
    throw new Error('Route segment contains invalid coordinates.')
  }

  const failures = []
  const requests = getRoutingRequests(from, to, profile)

  for (const [requestIndex, request] of requests.entries()) {
    const attempts = requestIndex === 0 ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(request.url, { signal }, 12000)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const route = parseRoutingResponse(await response.json(), request.provider)
        if (!Array.isArray(route.coordinates) || route.coordinates.length < 2) {
          throw new Error('no route geometry')
        }

        const routeGeometry = route.coordinates.map((coordinate) => ({
          lat: coordinate[1],
          lon: coordinate[0],
        }))
        const geometry = anchorRouteGeometry(routeGeometry, from, to)
        return {
          mode: 'routed',
          geometry,
          distanceMeters: Number.isFinite(route.distanceMeters) ? route.distanceMeters : getPolylineLength([
            { lat: from.lat, lon: from.lon },
            { lat: to.lat, lon: to.lon },
          ]),
        }
      }
      catch (networkError) {
        if (signal?.aborted) {
          throw networkError
        }
        failures.push(networkError instanceof Error ? networkError.message : 'network error')
      }
    }
  }

  throw new Error(`Routing services are unreachable: ${failures.at(-1) ?? 'no route found'}`)
}

function buildDirectSegment(from, to) {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) {
    throw new Error('Direct segment contains invalid coordinates.')
  }

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
    response = await fetchWithTimeout('https://api.open-elevation.com/api/v1/lookup', {
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
    }, 25000)
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
      response = await fetchWithTimeout(`https://api.open-meteo.com/v1/elevation?${params.toString()}`, {
        method: 'GET',
      }, 25000)
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

async function fetchWithTimeout(resource, options = {}, timeoutMs = 20000) {
  const timeoutController = new AbortController()
  const upstreamSignal = options.signal
  const abortFromUpstream = () => timeoutController.abort()
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs)

  if (upstreamSignal?.aborted) {
    timeoutController.abort()
  }
  else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })
  }

  try {
    return await fetch(resource, {
      ...options,
      signal: timeoutController.signal,
    })
  }
  catch (error) {
    if (timeoutController.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`, {
        cause: error,
      })
    }
    throw error
  }
  finally {
    window.clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
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
  return finalizeTrack(parseGpxDocument(xml, file.name.replace(/\.gpx$/i, '')))
}

async function readFitFile(file) {
  const { default: FitParser } = await import('fit-file-parser')
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

  const samples = records.map((record, index) => ({
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
    segmentStart: index === 0,
  }))

  if (!samples.some(isValidCoordinate)) {
    throw new Error('No valid GPS points were found in the FIT file.')
  }

  return finalizeTrack({
    name: file.name.replace(/\.fit$/i, ''),
    format: 'fit',
    samples,
  })
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

function normalizeFitCoordinate(value) {
  if (!Number.isFinite(value)) {
    return value
  }

  if (Math.abs(value) <= 180) {
    return value
  }

  return (value * 180) / 2147483648
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

function formatElevation(elevation, unavailableLabel) {
  return Number.isFinite(elevation) ? `~${Math.round(elevation)} m` : unavailableLabel
}

function findNearestRecordedElevation(point, trackPoints, maxDistanceMeters = 500) {
  let closestElevation = null
  let closestDistance = Number.POSITIVE_INFINITY

  for (const candidate of trackPoints) {
    if (!Number.isFinite(candidate.ele)) {
      continue
    }

    const distance = haversineDistance(point, candidate)
    if (distance < closestDistance) {
      closestDistance = distance
      closestElevation = candidate.ele
    }
  }

  return closestDistance <= maxDistanceMeters ? closestElevation : null
}

function getTrackDistanceToSample(points, targetSampleIndex) {
  let distance = 0

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].sampleIndex > targetSampleIndex) {
      break
    }
    if (!points[index].segmentStart) {
      distance += haversineDistance(points[index - 1], points[index])
    }
  }

  return distance
}

function roundCoordinate(value) {
  return Number.parseFloat(value.toFixed(6))
}

function sanitizeFilename(name) {
  return Array.from(name, (char) => (
    /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? '-' : char
  )).join('')
}

export default App
