import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import FitParser from 'fit-file-parser'
import { gpx as toGeoJsonGpx } from '@tmcw/togeojson'
import './App.css'

const initialView = [55.751244, 37.618423]

const anchorIcon = L.divIcon({
  className: 'map-pin map-pin-anchor',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const endpointIcon = L.divIcon({
  className: 'map-pin map-pin-endpoint',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

const viaIcon = L.divIcon({
  className: 'map-pin map-pin-via',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const offGridIcon = L.divIcon({
  className: 'map-pin map-pin-offgrid',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function App() {
  const [track, setTrack] = useState(null)
  const [sourceTrack, setSourceTrack] = useState(null)
  const [selectedCutPointIndex, setSelectedCutPointIndex] = useState(null)
  const [tailAnchorPointIndex, setTailAnchorPointIndex] = useState(null)
  const [removedSegmentSamples, setRemovedSegmentSamples] = useState([])
  const [rebuildDirection, setRebuildDirection] = useState(null)
  const [routeProfile, setRouteProfile] = useState('cycling')
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
  const [message, setMessage] = useState('Load a GPX or FIT track to start cleaning the broken tail.')
  const [error, setError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [correctElevationOnExport, setCorrectElevationOnExport] = useState(false)
  const [fitRequest, setFitRequest] = useState(0)
  const pendingRouteFitRef = useRef(false)
  const [collapsedPanels, setCollapsedPanels] = useState({
    track: false,
    suspicious: false,
    rebuild: false,
    waypoints: false,
  })

  const suspiciousSegments = useMemo(() => {
    if (!sourceTrack) {
      return []
    }

    return getSuspiciousSegments(sourceTrack.points).map((segment) => ({
      ...segment,
      id: `${segment.startIndex}-${segment.endIndex}`,
    }))
  }, [sourceTrack])

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

  const effectiveRoutePreview = controlPoints.length
    ? routePreview
    : {
        status: endpoint ? 'idle' : 'empty',
        error: '',
        segments: [],
        geometry: [],
        distanceMeters: 0,
      }

  const trackBounds = useMemo(() => {
    if (!track) {
      return null
    }

    const pointsForBounds = effectiveRoutePreview.geometry.length > 1
      ? [...track.points, ...effectiveRoutePreview.geometry]
      : track.points

    return getBounds(pointsForBounds)
  }, [effectiveRoutePreview.geometry, track])

  const routeWarning = useMemo(() => {
    if (!removedSegmentSamples.length || effectiveRoutePreview.distanceMeters <= 0) {
      return ''
    }

    const anchorSample = rebuildDirection === 'before'
      ? track?.samples?.[0] ?? null
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

    return `Suggested route is ${formatDistance(effectiveRoutePreview.distanceMeters)}, while removed segment distance was ${formatDistance(recordedTailDistance)}.`
  }, [effectiveRoutePreview.distanceMeters, rebuildDirection, removedSegmentSamples, track])

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
          const forceDirect = from.offGrid || to.offGrid
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
      setMessage(`Reading ${file.name}...`)
      const loadedTrack = await loadTrack(file)
      setSourceTrack(loadedTrack)
      setTrack(loadedTrack)
      setSelectedCutPointIndex(null)
      setTailAnchorPointIndex(null)
      setRemovedSegmentSamples([])
      setRebuildDirection(null)
      setEndpoint(null)
      setViaPoints([])
      setActiveWaypointId(null)
      setMapMode('inspect')
      setFitRequest((current) => current + 1)
      setMessage(`Loaded ${file.name}. Click the track line to choose a cut point, then delete before it or after it.`)
    }
    catch (nextError) {
      setSourceTrack(null)
      setTrack(null)
      setSelectedCutPointIndex(null)
      setTailAnchorPointIndex(null)
      setRemovedSegmentSamples([])
      setRebuildDirection(null)
      setEndpoint(null)
      setViaPoints([])
      setActiveWaypointId(null)
      setMapMode('inspect')
      setError(nextError instanceof Error ? nextError.message : 'Could not read the track file.')
      setMessage('Track loading failed.')
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
    setMessage(`Cut point selected at point ${pointIndex + 1}. Choose whether to delete everything before it or after it.`)
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
      setError('Keep at least two valid points before rebuilding the tail.')
      return
    }

    const trimmedTrack = finalizeTrack({
      ...track,
      samples: nextSamples,
    })

    setTrack(trimmedTrack)
    setSelectedCutPointIndex(trimmedTrack.points.length - 1)
    setTailAnchorPointIndex(trimmedTrack.points.length - 1)
    setRemovedSegmentSamples(removedSamples)
    setRebuildDirection('after')
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('pick-endpoint')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage('Everything after the cut point was removed. The selected point is now the redraw anchor. Click the map to place the new end point.')
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
      setError('Keep at least two valid points after the cut point.')
      return
    }

    const trimmedTrack = finalizeTrack({
      ...track,
      samples: nextSamples,
    })

    setTrack(trimmedTrack)
    setSelectedCutPointIndex(0)
    setTailAnchorPointIndex(0)
    setRemovedSegmentSamples(removedSamples)
    setRebuildDirection('before')
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('pick-endpoint')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage('Everything before the cut point was removed. The selected point is now the redraw anchor. Click the map to place the new start point.')
  }

  function restoreOriginalTrack() {
    if (!sourceTrack) {
      return
    }

    setTrack(sourceTrack)
    setSelectedCutPointIndex(null)
    setTailAnchorPointIndex(null)
    setRemovedSegmentSamples([])
    setRebuildDirection(null)
    setEndpoint(null)
    setViaPoints([])
    setActiveWaypointId(null)
    setMapMode('inspect')
    setFitRequest((current) => current + 1)
    setError('')
    setMessage('Original track restored. Click the track line to choose a new cut point.')
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
    pendingRouteFitRef.current = true
    setMessage(
      isInitialPlacement
        ? `${rebuildDirection === 'before' ? 'Start point' : 'Endpoint'} placed. Click the suggested line to add waypoints, then drag them onto the real street or path.`
        : `${rebuildDirection === 'before' ? 'Start point' : 'Endpoint'} moved. Existing waypoints were kept and the route was recalculated.`,
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

    const nearestPointIndex = findNearestPointIndex(track.points, latlng, 160)
    if (nearestPointIndex === null) {
      setMessage('Click closer to the track line to choose a cut point.')
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
    setMapMode('inspect')
    setMessage(
      offGrid
        ? 'Off-grid waypoint added on the nearest route segment. The route will use direct geometry around this point.'
        : 'Waypoint added. Drag it to refine the rebuilt route.',
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
    setMessage('Waypoint removed.')
  }

  function togglePanel(panelKey) {
    setCollapsedPanels((current) => ({
      ...current,
      [panelKey]: !current[panelKey],
    }))
  }

  async function exportTrack() {
    if (!track || isExporting) {
      return
    }

    try {
      setIsExporting(true)
      setError('')

      let exportableTrack = buildExportTrack(track, removedSegmentSamples, effectiveRoutePreview.geometry, rebuildDirection)

      if (correctElevationOnExport) {
        setMessage('Correcting elevation from terrain data before export...')
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
      setMessage('Cleaned GPX exported.')
    }
    catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Export failed.')
      setMessage('Could not export the repaired track.')
    }
    finally {
      setIsExporting(false)
    }
  }

  const activeWaypoint = activeWaypointId
    ? viaPoints.find((point) => point.id === activeWaypointId) ?? null
    : null
  const hasTrackEdits = Boolean(sourceTrack && track && sourceTrack.samples.length !== track.samples.length)
  const isPickingEndpoint = mapMode === 'pick-endpoint'
  const isAddingOffGrid = mapMode === 'add-offgrid-waypoint'
  const endpointLabel = rebuildDirection === 'before' ? 'New start point' : 'New endpoint'
  const layoutSignature = `${collapsedPanels.track}-${collapsedPanels.suspicious}-${collapsedPanels.rebuild}-${collapsedPanels.waypoints}`

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">FixYourTrack / Tail Rebuild</p>
          <h1>Rebuild the broken end of a GPS track.</h1>
          <p className="lead">Trim tail. Place endpoint. Refine route.</p>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <label className="file-picker">
              <input type="file" accept=".gpx,.fit" onChange={handleFileChange} />
              <span>Load GPX or FIT</span>
            </label>

            <button type="button" className="ghost-button" onClick={exportTrack} disabled={!track || isExporting}>
              Export cleaned GPX
            </button>
          </div>

          <label className="checkbox-row checkbox-row-compact">
            <input
              type="checkbox"
              checked={correctElevationOnExport}
              onChange={(event) => setCorrectElevationOnExport(event.target.checked)}
            />
            <span>Correct elevation on export using terrain data</span>
          </label>

          <p className="status-text status-text-compact">{message}</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>Track</h2>
                {track ? <span>{track.format.toUpperCase()}</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('track')} aria-label="Toggle Track panel">
                {collapsedPanels.track ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.track && track ? (
              <>
                <dl className="stats-grid">
                  <div>
                    <dt>Name</dt>
                    <dd>{track.name}</dd>
                  </div>
                  <div>
                    <dt>Points</dt>
                    <dd>{track.points.length}</dd>
                  </div>
                  <div>
                    <dt>Distance</dt>
                    <dd>{formatDistance(track.distanceMeters)}</dd>
                  </div>
                  <div>
                    <dt>Suspicious jumps</dt>
                    <dd>{suspiciousSegments.length}</dd>
                  </div>
                </dl>

                <div className="step-box">
                  <div className="step-title">1. Click the track to choose a cut point</div>
                  <p className="muted-text">
                    Click directly on the recorded track line. Then delete everything before that point or after it.
                    Whichever side you delete, the kept boundary point becomes the redraw anchor.
                  </p>
                  <div className="stack">
                    <button type="button" className="ghost-button" onClick={deleteBeforeCutPoint} disabled={!selectedCutPoint}>
                      Delete everything before cut point
                    </button>
                    <button type="button" className="primary-button" onClick={deleteAfterCutPoint} disabled={!selectedCutPoint}>
                      Delete everything after cut point
                    </button>
                    {hasTrackEdits ? (
                      <button type="button" className="ghost-button" onClick={restoreOriginalTrack}>
                        Restore original track
                      </button>
                    ) : null}
                  </div>
                  {selectedCutPoint ? (
                    <div className="note note-neutral">
                      Selected cut point: {selectedCutPointIndex + 1} at {formatLatLon(selectedCutPoint)}
                    </div>
                  ) : null}
                </div>
              </>
            ) : !collapsedPanels.track ? (
              <p className="muted-text">Load a track to start.</p>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>Suspicious jumps</h2>
                {suspiciousSegments.length ? <span>jump hints</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('suspicious')} aria-label="Toggle Suspicious jumps panel">
                {collapsedPanels.suspicious ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.suspicious && suspiciousSegments.length ? (
              <div className="segment-list">
                {suspiciousSegments.map((segment, index) => (
                  <button
                    key={segment.id}
                    type="button"
                    className={`segment-button ${selectedCutPointIndex === segment.startIndex ? 'segment-button-active' : ''}`}
                    onClick={() => selectCutPoint(segment.startIndex)}
                  >
                    <strong>Jump {index + 1}</strong>
                    <span>
                      Suggested cut near points {segment.startIndex + 1} {'->'} {segment.endIndex + 1}
                    </span>
                    <span>
                      {formatDistance(segment.distance)} in {formatDuration(segment.seconds)}
                    </span>
                  </button>
                ))}
              </div>
            ) : !collapsedPanels.suspicious ? (
              <p className="muted-text">No obvious spoofed tail was detected automatically.</p>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>Tail rebuild</h2>
                {anchorPoint ? <span>routing</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('rebuild')} aria-label="Toggle Tail rebuild panel">
                {collapsedPanels.rebuild ? '+' : '-'}
              </button>
            </div>

            {!collapsedPanels.rebuild && anchorPoint ? (
              <>
                <div className="inspector-grid">
                  <div>
                    <dt>Anchor</dt>
                    <dd>{formatLatLon(anchorPoint)}</dd>
                  </div>
                  <div>
                    <dt>Removed samples</dt>
                    <dd>{removedSegmentSamples.length}</dd>
                  </div>
                  <div>
                    <dt>{rebuildDirection === 'before' ? 'Start point' : 'Endpoint'}</dt>
                    <dd>{endpoint ? formatLatLon(endpoint) : 'not set'}</dd>
                  </div>
                  <div>
                    <dt>Waypoints</dt>
                    <dd>{viaPoints.length}</dd>
                  </div>
                </div>

                {isPickingEndpoint ? (
                  <div className="note note-action">
                    Endpoint placement is active. Click on the map to set the missing {rebuildDirection === 'before' ? 'start point' : 'end point'}.
                  </div>
                ) : null}
                {isAddingOffGrid ? (
                  <div className="note note-warning">
                    Off-grid placement is active. Click on the map to place an off-grid waypoint, then continue shaping the route.
                  </div>
                ) : null}

                <div className="mode-chip-row">
                  <span className={`mode-chip ${isPickingEndpoint || isAddingOffGrid ? 'mode-chip-active' : ''}`}>
                    Mode: {isPickingEndpoint ? 'placing endpoint' : isAddingOffGrid ? 'adding off-grid waypoint' : mapMode}
                  </span>
                </div>

                <div className="field-group">
                  <label htmlFor="route-profile">Navigator profile</label>
                  <select
                    id="route-profile"
                    value={routeProfile}
                    onChange={(event) => setRouteProfile(event.target.value)}
                  >
                    <option value="cycling">Cycling</option>
                    <option value="walking">Walking</option>
                    <option value="driving">Driving</option>
                  </select>
                </div>

                <div className="stack">
                  <button type="button" className="primary-button" onClick={() => setMapMode('pick-endpoint')}>
                    {endpoint
                      ? `Move ${rebuildDirection === 'before' ? 'start point' : 'endpoint'} on map`
                      : `Place ${rebuildDirection === 'before' ? 'start point' : 'endpoint'} on map`}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setMapMode((current) => (current === 'add-offgrid-waypoint' ? 'inspect' : 'add-offgrid-waypoint'))}
                    disabled={!endpoint}
                  >
                    {isAddingOffGrid ? 'Cancel off-grid placement' : 'Add off-grid waypoint'}
                  </button>
                </div>

                {effectiveRoutePreview.status === 'loading' ? (
                  <div className="note note-neutral">Building route suggestion...</div>
                ) : null}
                {effectiveRoutePreview.status === 'error' ? (
                  <div className="note note-danger">{effectiveRoutePreview.error}</div>
                ) : null}
                {effectiveRoutePreview.status === 'ready' ? (
                  <div className="note note-good">
                    Suggested rebuild length: {formatDistance(effectiveRoutePreview.distanceMeters)}
                  </div>
                ) : null}
                {routeWarning ? <div className="note note-warning">{routeWarning}</div> : null}
              </>
            ) : !collapsedPanels.rebuild ? (
              <p className="muted-text">Delete either side of the cut point to start redrawing from the kept boundary point.</p>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-main">
                <h2>Waypoint editor</h2>
                {activeWaypoint ? <span>selected</span> : null}
              </div>
              <button type="button" className="panel-toggle" onClick={() => togglePanel('waypoints')} aria-label="Toggle Waypoint editor panel">
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
                      {point.offGrid ? 'Off-grid' : 'Waypoint'} {index + 1}
                    </strong>
                    <span>{formatLatLon(point)}</span>
                  </button>
                ))}
              </div>
            ) : !collapsedPanels.waypoints ? (
              <p className="muted-text">Click the preview line to add a normal waypoint, or use “Add off-grid waypoint” and then click the map.</p>
            ) : null}

            {!collapsedPanels.waypoints && activeWaypoint ? (
              <div className="waypoint-box">
                <p className="muted-text">Select any waypoint and toggle off-grid when that part of the route should ignore roads.</p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={activeWaypoint.offGrid}
                    onChange={(event) => setWaypointOffGrid(activeWaypoint.id, event.target.checked)}
                  />
                  <span>Off-grid waypoint</span>
                </label>
                <button type="button" className="ghost-button" onClick={() => removeWaypoint(activeWaypoint.id)}>
                  Remove selected waypoint
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="map-panel">
          {isPickingEndpoint || isAddingOffGrid ? (
            <div className="map-mode-banner">
              {isPickingEndpoint
                ? `Click on the map to place the new ${rebuildDirection === 'before' ? 'start point' : 'endpoint'}.`
                : 'Click on the map to place an off-grid waypoint.'}
            </div>
          ) : null}
          <MapContainer center={initialView} zoom={11} scrollWheelZoom className="map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapClickBridge onMapClick={handleMapClick} />
            <MapSizeInvalidator request={layoutSignature} />
            <MapResizeObserver />
            <FitBounds bounds={trackBounds} request={fitRequest} />

            {hasTrackEdits ? sourceTrack?.pointSegments.map((segment, index) => (
              <Polyline
                key={`source-${index}`}
                positions={segment.map((point) => [point.lat, point.lon])}
                pathOptions={{ color: '#6d7c78', weight: 4, opacity: 0.32, interactive: false }}
              />
            )) : null}

            {track?.pointSegments.map((segment, index) => (
              <Polyline
                key={`track-${index}`}
                positions={segment.map((point) => [point.lat, point.lon])}
                pathOptions={{ color: '#1d5f56', weight: 5, opacity: 0.9 }}
                eventHandlers={{
                  click: (event) => handleTrackClick(event.latlng),
                }}
              />
            ))}

            {suspiciousSegments.map((segment) => (
              <Polyline
                key={`jump-${segment.id}`}
                positions={[
                  [sourceTrack.points[segment.startIndex].lat, sourceTrack.points[segment.startIndex].lon],
                  [sourceTrack.points[segment.endIndex].lat, sourceTrack.points[segment.endIndex].lon],
                ]}
                pathOptions={{ color: '#cf4920', weight: 4, opacity: 0.95, dashArray: '10 8', interactive: false }}
              />
            ))}

            {effectiveRoutePreview.segments.map((segment) => (
              <Polyline
                key={segment.id}
                positions={segment.geometry.map((point) => [point.lat, point.lon])}
                pathOptions={{
                  color: segment.mode === 'direct' ? '#8f5d1b' : '#2454d2',
                  weight: segment.mode === 'direct' ? 4 : 5,
                  opacity: 0.95,
                  dashArray: segment.mode === 'direct' ? '7 7' : undefined,
                }}
                eventHandlers={{
                  click: (event) => handleRouteSegmentClick(segment, event.latlng),
                }}
              />
            ))}

            {selectedCutPoint ? (
              <CircleMarker
                center={[selectedCutPoint.lat, selectedCutPoint.lon]}
                radius={9}
                pathOptions={{
                  color: '#ffffff',
                  weight: 3,
                  fillColor: '#cf4920',
                  fillOpacity: 0.96,
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} permanent>
                  Cut point
                </Tooltip>
              </CircleMarker>
            ) : null}

            {anchorPoint ? (
              <Marker position={[anchorPoint.lat, anchorPoint.lon]} icon={anchorIcon}>
                <Tooltip direction="top" offset={[0, -10]} permanent>
                  Last known point
                </Tooltip>
              </Marker>
            ) : null}

            {endpoint ? (
              <Marker
                position={[endpoint.lat, endpoint.lon]}
                icon={endpointIcon}
                draggable
                eventHandlers={{
                  dragend: (event) => placeEndpoint(event.target.getLatLng()),
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} permanent>
                  {endpointLabel}
                </Tooltip>
              </Marker>
            ) : null}

            {viaPoints.map((point, index) => (
              <Marker
                key={point.id}
                position={[point.lat, point.lon]}
                icon={point.offGrid ? offGridIcon : viaIcon}
                draggable
                eventHandlers={{
                  click: () => setActiveWaypointId(point.id),
                  dblclick: () => removeWaypoint(point.id),
                  dragend: (event) => handleWaypointMove(point.id, event.target.getLatLng()),
                }}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  {point.offGrid ? 'Off-grid' : 'Waypoint'} {index + 1}
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </section>
    </div>
  )
}

function MapClickBridge({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng)
    },
  })

  return null
}

function MapSizeInvalidator({ request }) {
  const map = useMap()
  const previousRequestRef = useRef(null)

  useEffect(() => {
    if (request === previousRequestRef.current) {
      return
    }

    previousRequestRef.current = request
    requestAnimationFrame(() => {
      map.invalidateSize(false)
    })
  }, [map, request])

  return null
}

function MapResizeObserver() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        map.invalidateSize(false)
      })
    })

    observer.observe(container)

    return () => observer.disconnect()
  }, [map])

  return null
}

function FitBounds({ bounds, request }) {
  const map = useMap()
  const previousRequestRef = useRef(null)

  useEffect(() => {
    if (!bounds || request === previousRequestRef.current) {
      return
    }

    previousRequestRef.current = request
    map.fitBounds(bounds, {
      padding: [36, 36],
    })
  }, [bounds, map, request])

  return null
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

function buildExportTrack(track, removedSegmentSamples, routeGeometry, rebuildDirection) {
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
      name: `${track.name}-cleaned`,
      samples: [...repairedStart, ...track.samples],
    })
  }

  const anchorSample = track.samples[track.samples.length - 1]
  const repairedTail = rebuildSegmentSamples(anchorSample, removedSegmentSamples, routeGeometry, 'after')

  return finalizeTrack({
    ...track,
    name: `${track.name}-cleaned`,
    samples: [...track.samples, ...repairedTail],
  })
}

async function correctTrackElevation(track) {
  const correctedElevations = await fetchElevationProfile(track.points)
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
  const batchSize = 250
  const elevations = []

  for (let offset = 0; offset < points.length; offset += batchSize) {
    const batch = points.slice(offset, offset + batchSize)
    const locations = batch
      .map((point) => `${roundCoordinate(point.lat)},${roundCoordinate(point.lon)}`)
      .join('|')

    const params = new URLSearchParams({
      locations,
      interpolation: 'cubic',
    })

    let response
    try {
      response = await fetch(`https://api.opentopodata.org/v1/mapzen?${params.toString()}`, {
        method: 'GET',
      })
    }
    catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : 'network error'
      throw new Error(`Terrain service is unreachable: ${detail}`, {
        cause: networkError,
      })
    }

    if (!response.ok) {
      throw new Error(`Terrain service returned ${response.status}.`)
    }

    const data = await response.json()
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      throw new Error('Could not get elevation data from the terrain service.')
    }

    data.results.forEach((item) => {
      elevations.push(Number.isFinite(item.elevation) ? item.elevation : null)
    })
  }

  return elevations
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
  const segments = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
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
      segments.push({
        startIndex: index,
        endIndex: index + 1,
        startSampleIndex: current.sampleIndex,
        endSampleIndex: next.sampleIndex,
        distance,
        seconds,
        calcSpeedKmh,
        deviceSpeedKmh,
      })
    }
  }

  return segments
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

function getBounds(points) {
  if (!points.length) {
    return null
  }

  let south = points[0].lat
  let north = points[0].lat
  let west = points[0].lon
  let east = points[0].lon

  for (const point of points) {
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
    west = Math.min(west, point.lon)
    east = Math.max(east, point.lon)
  }

  return [
    [south, west],
    [north, east],
  ]
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
