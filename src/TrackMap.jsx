import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const EMPTY_COLLECTION = {
  type: 'FeatureCollection',
  features: [],
}

export default function TrackMap({
  activeWaypointId,
  anchorDraggable = false,
  anchorPoint,
  anchorLabel,
  enableWaypointDoubleClickRemove = true,
  endpoint,
  endpointLabel,
  fitRequest,
  hasTrackEdits,
  highlightedTrackPoints,
  initialView,
  interactionMode,
  layoutSignature,
  manualMiddleStartLabel,
  manualMiddleStartPoint,
  mapLayer,
  onAnchorMove,
  onEndpointMove,
  onMapClick,
  onRouteSegmentClick,
  onTrackClick,
  onWaypointMove,
  onWaypointIncomingModeToggle,
  onWaypointOutgoingModeToggle,
  onWaypointRemove,
  onWaypointSelect,
  rebuildDirection,
  routeSegments,
  selectedCutPoint,
  selectedCutPointLabel,
  sourceTrack,
  suspiciousSegments,
  track,
  viaPoints,
  waypointCardLabels,
  waypointDetails,
  waypointLabel,
  offGridLabel,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const routeInsertionMarkerRef = useRef(null)
  const waypointPopupRef = useRef(null)
  const initialMapLayerRef = useRef(mapLayer)
  const initialViewRef = useRef(initialView)
  const previousFitRequestRef = useRef(null)
  const interactionModeRef = useRef(interactionMode)
  const routeSegmentsRef = useRef(routeSegments)
  const activeWaypointIdRef = useRef(activeWaypointId)
  const suppressMapClickRef = useRef(false)
  const handlersRef = useRef({})
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    routeSegmentsRef.current = routeSegments
  }, [routeSegments])

  useEffect(() => {
    activeWaypointIdRef.current = activeWaypointId
  }, [activeWaypointId])

  useEffect(() => {
    interactionModeRef.current = interactionMode
    if (interactionMode !== 'inspect') {
      routeInsertionMarkerRef.current
        ?.getElement()
        .classList.remove('route-insertion-preview-visible')
    }
  }, [interactionMode])

  useEffect(() => {
    handlersRef.current = {
      onEndpointMove,
      onAnchorMove,
      onMapClick,
      onRouteSegmentClick,
      onTrackClick,
      onWaypointMove,
      onWaypointIncomingModeToggle,
      onWaypointOutgoingModeToggle,
      onWaypointRemove,
      onWaypointSelect,
    }
  }, [
    onEndpointMove,
    onAnchorMove,
    onMapClick,
    onRouteSegmentClick,
    onTrackClick,
    onWaypointMove,
    onWaypointIncomingModeToggle,
    onWaypointOutgoingModeToggle,
    onWaypointRemove,
    onWaypointSelect,
  ])

  useEffect(() => {
    if (!containerRef.current) {
      return undefined
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [initialViewRef.current[1], initialViewRef.current[0]],
      zoom: 11,
      style: createMapStyle(initialMapLayerRef.current),
      attributionControl: true,
    })

    map.addControl(new maplibregl.NavigationControl({
      showCompass: false,
      visualizePitch: false,
    }), 'top-left')
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()

    function handleClick(event) {
      if (suppressMapClickRef.current) {
        suppressMapClickRef.current = false
        return
      }
      if (activeWaypointIdRef.current) {
        activeWaypointIdRef.current = null
        handlersRef.current.onWaypointSelect(null)
        return
      }
      const latlng = { lat: event.lngLat.lat, lng: event.lngLat.lng }
      if (interactionModeRef.current !== 'inspect') {
        handlersRef.current.onMapClick(latlng)
        return
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: ['route-hitbox', 'track-hitbox'],
      })
      const routeFeature = features.find((feature) => feature.layer.id === 'route-hitbox')

      if (routeFeature) {
        const segment = routeSegmentsRef.current.find(({ id }) => id === routeFeature.properties?.id)
        if (segment) {
          handlersRef.current.onRouteSegmentClick(segment, getClosestRoutePoint(map, event.point, segment.geometry))
        }
        return
      }

      if (features.some((feature) => feature.layer.id === 'track-hitbox')) {
        handlersRef.current.onTrackClick(latlng)
        return
      }

      handlersRef.current.onMapClick(latlng)
    }

    function showPointer() {
      map.getCanvas().style.cursor = 'pointer'
    }

    function clearPointer() {
      map.getCanvas().style.cursor = ''
    }

    function showRouteInsertionPreview(event) {
      if (interactionModeRef.current !== 'inspect') {
        hideRouteInsertionPreview()
        return
      }

      const routeFeature = map.queryRenderedFeatures(event.point, {
        layers: ['route-hitbox'],
      })[0]
      const segmentId = routeFeature?.properties?.id
      const segment = routeSegmentsRef.current.find(({ id }) => id === segmentId)
      if (!segment) {
        hideRouteInsertionPreview()
        return
      }

      const point = getClosestRoutePoint(map, event.point, segment.geometry)
      routeInsertionMarkerRef.current
        ?.setLngLat([point.lng, point.lat])
        .getElement()
        .classList.add('route-insertion-preview-visible')
    }

    function hideRouteInsertionPreview() {
      routeInsertionMarkerRef.current
        ?.getElement()
        .classList.remove('route-insertion-preview-visible')
    }

    map.on('load', () => {
      const previewElement = document.createElement('div')
      previewElement.className = 'route-insertion-preview'
      routeInsertionMarkerRef.current = new maplibregl.Marker({
        anchor: 'center',
        element: previewElement,
      })
        .setLngLat([initialViewRef.current[1], initialViewRef.current[0]])
        .addTo(map)

      map.on('click', handleClick)
      map.on('mousemove', showRouteInsertionPreview)
      map.on('mouseenter', 'route-hitbox', showPointer)
      map.on('mouseleave', 'route-hitbox', clearPointer)
      map.on('mouseenter', 'track-hitbox', showPointer)
      map.on('mouseleave', 'track-hitbox', clearPointer)
      setMapReady(true)
    })

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => requestAnimationFrame(() => map.resize()))
    observer?.observe(containerRef.current)
    mapRef.current = map

    return () => {
      waypointPopupRef.current?.remove()
      waypointPopupRef.current = null
      routeInsertionMarkerRef.current?.remove()
      routeInsertionMarkerRef.current = null
      observer?.disconnect()
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    map.setLayoutProperty('scheme-base', 'visibility', mapLayer === 'scheme' ? 'visible' : 'none')
    map.setLayoutProperty('satellite-base', 'visibility', mapLayer === 'satellite' ? 'visible' : 'none')
  }, [mapLayer, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    setSourceData(map, 'source-track', hasTrackEdits ? trackToGeoJson(sourceTrack) : EMPTY_COLLECTION)
  }, [hasTrackEdits, mapReady, sourceTrack])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    setSourceData(map, 'track', trackToGeoJson(track))
  }, [mapReady, track])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    setSourceData(map, 'suspicious', suspiciousToGeoJson(suspiciousSegments, track))
  }, [mapReady, suspiciousSegments, track])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    setSourceData(map, 'route', routeToGeoJson(routeSegments))
  }, [mapReady, routeSegments])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    setSourceData(map, 'track-highlight', pointsToGeoJson(highlightedTrackPoints))
  }, [highlightedTrackPoints, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const selectedIsManualStart = selectedCutPoint && manualMiddleStartPoint
      && selectedCutPoint.sampleIndex === manualMiddleStartPoint.sampleIndex

    if (selectedCutPoint && !selectedIsManualStart) {
      markersRef.current.push(addMarker(map, selectedCutPoint, {
        className: 'map-pin-cut',
        label: selectedCutPointLabel,
      }))
    }

    if (manualMiddleStartPoint) {
      markersRef.current.push(addMarker(map, manualMiddleStartPoint, {
        className: 'map-pin-manual-middle-start',
        label: manualMiddleStartLabel,
      }))
    }

    if (anchorPoint) {
      markersRef.current.push(addMarker(map, anchorPoint, {
        className: 'map-pin-anchor',
        draggable: anchorDraggable,
        label: anchorLabel,
        number: rebuildDirection === 'before' ? viaPoints.length + 2 : 1,
        onMove: anchorDraggable
          ? (latlng) => handlersRef.current.onAnchorMove?.(latlng)
          : undefined,
      }))
    }

    if (endpoint) {
      markersRef.current.push(addMarker(map, endpoint, {
        className: 'map-pin-endpoint',
        draggable: rebuildDirection !== 'middle',
        label: endpointLabel,
        number: rebuildDirection === 'before' ? 1 : viaPoints.length + 2,
        onMove: (latlng) => handlersRef.current.onEndpointMove(latlng),
      }))
    }

    viaPoints.forEach((point, index) => {
      const details = waypointDetails.find(({ id }) => id === point.id)
      markersRef.current.push(addMarker(map, point, {
        className: details?.isOffGrid ? 'map-pin-offgrid' : 'map-pin-via',
        draggable: true,
        number: index + 2,
        title: `${details?.isOffGrid ? offGridLabel : waypointLabel} ${index + 2}`,
        waypointId: point.id,
        onDragEnd: () => handlersRef.current.onWaypointSelect(null),
        onDragStart: () => {
          waypointPopupRef.current?.remove()
          waypointPopupRef.current = null
        },
        onClick: () => handlersRef.current.onWaypointSelect(point.id),
        onDoubleClick: enableWaypointDoubleClickRemove
          ? () => handlersRef.current.onWaypointRemove?.(point.id)
          : undefined,
        onMove: (latlng) => handlersRef.current.onWaypointMove(point.id, latlng),
      }))
    })

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
    }
  }, [
    anchorDraggable,
    anchorLabel,
    anchorPoint,
    endpoint,
    endpointLabel,
    enableWaypointDoubleClickRemove,
    manualMiddleStartLabel,
    manualMiddleStartPoint,
    mapReady,
    offGridLabel,
    rebuildDirection,
    selectedCutPoint,
    selectedCutPointLabel,
    viaPoints,
    waypointLabel,
    waypointDetails,
  ])

  useEffect(() => {
    for (const marker of markersRef.current) {
      const element = marker.getElement()
      if (element.dataset.waypointId) {
        element.classList.toggle('map-marker-active', element.dataset.waypointId === activeWaypointId)
      }
    }
  }, [activeWaypointId, mapReady, viaPoints])

  useEffect(() => {
    if (!activeWaypointId) return undefined

    const closeFromOutside = (event) => {
      const popupElement = waypointPopupRef.current?.getElement()
      const clickedMarker = markersRef.current
        .map((marker) => marker.getElement())
        .find((element) => element.contains(event.target))
      if (
        popupElement?.contains(event.target) ||
        clickedMarker
      ) {
        return
      }
      if (containerRef.current?.contains(event.target)) {
        suppressMapClickRef.current = true
        globalThis.setTimeout(() => {
          suppressMapClickRef.current = false
        }, 0)
      }
      activeWaypointIdRef.current = null
      handlersRef.current.onWaypointSelect(null)
    }

    document.addEventListener('pointerdown', closeFromOutside)
    return () => document.removeEventListener('pointerdown', closeFromOutside)
  }, [activeWaypointId])

  useEffect(() => {
    const map = mapRef.current
    const details = waypointDetails.find(({ id }) => id === activeWaypointId)
    waypointPopupRef.current?.remove()
    waypointPopupRef.current = null

    if (!mapReady || !map || !details) {
      return
    }

    const placement = getWaypointPopupPlacement(map, details)
    const card = createWaypointCard(details, waypointCardLabels, {
      onClose: () => handlersRef.current.onWaypointSelect(null),
      onRemove: () => handlersRef.current.onWaypointRemove(details.id),
      onToggleIncomingOffGrid: () => handlersRef.current.onWaypointIncomingModeToggle(details.incomingLegId),
      onToggleOutgoingOffGrid: () => handlersRef.current.onWaypointOutgoingModeToggle(details.outgoingLegId),
    })
    card.style.maxHeight = `${placement.maxContentHeight}px`
    const popup = new maplibregl.Popup({
      anchor: placement.anchor,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '330px',
      offset: 20,
    })
      .setLngLat([details.lon, details.lat])
      .setDOMContent(card)
      .addTo(map)

    waypointPopupRef.current = popup

    return () => {
      popup.remove()
      if (waypointPopupRef.current === popup) {
        waypointPopupRef.current = null
      }
    }
  }, [activeWaypointId, mapReady, waypointCardLabels, waypointDetails])

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return
    }

    requestAnimationFrame(() => mapRef.current?.resize())
  }, [layoutSignature, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || fitRequest === previousFitRequestRef.current) {
      return
    }

    const controlPoints = [anchorPoint, ...viaPoints, endpoint].filter(Boolean)
    const hasRouteGeometry = routeSegments.some((segment) => segment.geometry?.length >= 2)
    if (!track?.points?.length && !hasRouteGeometry && controlPoints.length === 1) {
      previousFitRequestRef.current = fitRequest
      map.easeTo({
        center: [controlPoints[0].lon, controlPoints[0].lat],
        duration: 0,
        zoom: Math.min(map.getZoom(), 12),
      })
      return
    }
    if (!track?.points?.length && !hasRouteGeometry && controlPoints.length < 2) {
      return
    }

    const bounds = getTrackBounds(track, routeSegments, controlPoints)
    if (!bounds) {
      return
    }

    previousFitRequestRef.current = fitRequest
    map.fitBounds(bounds, { padding: 36, duration: 0 })
  }, [anchorPoint, endpoint, fitRequest, mapReady, routeSegments, track, viaPoints])

  return <div ref={containerRef} className="map" data-map-ready={mapReady ? 'true' : 'false'} />
}

function createMapStyle(activeLayer) {
  return {
    version: 8,
    sources: {
      scheme: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>',
      },
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      'source-track': geoJsonSource(),
      track: geoJsonSource(),
      suspicious: geoJsonSource(),
      route: geoJsonSource(),
      'track-highlight': geoJsonSource(),
    },
    layers: [
      rasterLayer('scheme-base', 'scheme', activeLayer === 'scheme'),
      rasterLayer('satellite-base', 'satellite', activeLayer === 'satellite'),
      lineLayer('source-track-line', 'source-track', '#6d7c78', 4, 0.32),
      lineLayer('track-outline', 'track', '#ffffff', 9, 0.72),
      lineLayer('track-line', 'track', '#1d5f56', 5, 0.9),
      lineLayer('track-hitbox', 'track', '#1d5f56', 22, 0.01),
      {
        ...lineLayer('suspicious-line', 'suspicious', '#cf4920', 4, 0.95),
        paint: {
          'line-color': '#cf4920',
          'line-width': 4,
          'line-opacity': 0.95,
          'line-dasharray': [2.5, 2],
        },
      },
      lineLayer('route-outline', 'route', '#ffffff', 9, 0.82),
      {
        ...lineLayer('route-routed', 'route', '#2454d2', 5, 0.95),
        filter: ['==', ['get', 'mode'], 'routed'],
      },
      {
        ...lineLayer('route-direct', 'route', '#8f5d1b', 4, 0.95),
        filter: ['==', ['get', 'mode'], 'direct'],
        paint: {
          'line-color': '#8f5d1b',
          'line-width': 4,
          'line-opacity': 0.95,
          'line-dasharray': [1.75, 1.75],
        },
      },
      {
        ...lineLayer('route-unresolved', 'route', '#cf4920', 4, 0.95),
        filter: ['==', ['get', 'mode'], 'unresolved'],
        paint: {
          'line-color': '#cf4920',
          'line-width': 4,
          'line-opacity': 0.95,
          'line-dasharray': [1, 1.5],
        },
      },
      lineLayer('route-hitbox', 'route', '#2454d2', 24, 0.01),
      lineLayer('track-highlight-outline', 'track-highlight', '#ffffff', 13, 0.96),
      lineLayer('track-highlight-line', 'track-highlight', '#f06a20', 8, 0.98),
    ],
  }
}

function geoJsonSource() {
  return {
    type: 'geojson',
    data: EMPTY_COLLECTION,
  }
}

function rasterLayer(id, source, visible) {
  return {
    id,
    type: 'raster',
    source,
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
  }
}

function lineLayer(id, source, color, width, opacity) {
  return {
    id,
    type: 'line',
    source,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': color,
      'line-width': width,
      'line-opacity': opacity,
    },
  }
}

function trackToGeoJson(track) {
  if (!track?.pointSegments) {
    return EMPTY_COLLECTION
  }

  return {
    type: 'FeatureCollection',
    features: track.pointSegments
      .map((segment, index) => lineFeature(`track-${index}`, segment))
      .filter(Boolean),
  }
}

function suspiciousToGeoJson(segments, track) {
  if (!track?.points) {
    return EMPTY_COLLECTION
  }

  return {
    type: 'FeatureCollection',
    features: segments
      .map((segment) => lineFeature(
        segment.id,
        track.points.slice(segment.startIndex, segment.endIndex + 1),
      ))
      .filter(Boolean),
  }
}

function routeToGeoJson(segments) {
  return {
    type: 'FeatureCollection',
    features: segments
      .map((segment) => lineFeature(segment.id, segment.geometry, {
        id: segment.id,
        mode: segment.mode,
      }))
      .filter(Boolean),
  }
}

function pointsToGeoJson(points) {
  const feature = lineFeature('track-highlight', points)
  return feature
    ? { type: 'FeatureCollection', features: [feature] }
    : EMPTY_COLLECTION
}

function lineFeature(id, points, properties = {}) {
  if (!points || points.length < 2) {
    return null
  }

  return {
    type: 'Feature',
    id,
    properties,
    geometry: {
      type: 'LineString',
      coordinates: points.map((point) => [point.lon, point.lat]),
    },
  }
}

function setSourceData(map, sourceId, data) {
  map.getSource(sourceId)?.setData(data)
}

function addMarker(map, point, options) {
  const element = document.createElement('div')
  element.className = `map-marker${options.active ? ' map-marker-active' : ''}`
  let suppressClickUntil = 0
  if (options.title) {
    element.title = options.title
  }
  const accessibleName = options.title || options.label
  if (accessibleName) {
    element.setAttribute('aria-label', accessibleName)
  }
  if (options.waypointId) {
    element.dataset.waypointId = options.waypointId
  }

  const pin = document.createElement('div')
  pin.className = `map-pin ${options.className}${options.number ? ' map-pin-numbered' : ''}`
  if (options.number) {
    const number = document.createElement('span')
    number.className = 'map-pin-number'
    number.textContent = String(options.number)
    pin.append(number)
  }
  element.append(pin)

  if (options.label) {
    const label = document.createElement('span')
    label.className = 'map-marker-label'
    label.textContent = options.label
    element.append(label)
  }

  if (options.onClick) {
    element.setAttribute('role', 'button')
    element.tabIndex = 0
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      if (Date.now() >= suppressClickUntil) {
        options.onClick()
      }
    })
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        options.onClick()
      }
    })
  }

  if (options.onDoubleClick) {
    element.addEventListener('dblclick', (event) => {
      event.preventDefault()
      event.stopPropagation()
      options.onDoubleClick()
    })
  }

  const marker = new maplibregl.Marker({
    anchor: 'center',
    draggable: Boolean(options.draggable),
    element,
  })
    .setLngLat([point.lon, point.lat])
    .addTo(map)

  marker.on('dragstart', () => {
    suppressClickUntil = Date.now() + 600
    options.onDragStart?.()
  })

  if (options.onMove) {
    marker.on('dragend', () => {
      suppressClickUntil = Date.now() + 600
      const position = marker.getLngLat()
      options.onDragEnd?.()
      options.onMove({ lat: position.lat, lng: position.lng })
    })
  }

  return marker
}

function createWaypointCard(details, labels, handlers) {
  const card = document.createElement('section')
  card.className = 'waypoint-card'

  const header = document.createElement('header')
  header.className = 'waypoint-card-header'
  const title = document.createElement('h3')
  title.textContent = labels.title.replace('{number}', String(details.number))
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'waypoint-card-close'
  close.setAttribute('aria-label', labels.close)
  close.textContent = '×'
  close.addEventListener('click', handlers.onClose)
  header.append(title, close)

  const coordinates = document.createElement('div')
  coordinates.className = 'waypoint-card-coordinates'
  coordinates.textContent = `${details.lat.toFixed(6)}, ${details.lon.toFixed(6)}`

  const stats = document.createElement('dl')
  stats.className = 'waypoint-card-stats'
  appendStat(stats, labels.distance, formatCardDistance(details.distanceMeters))
  appendStat(stats, labels.elevation, formatCardElevation(details.elevation, labels.notAvailable))

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'waypoint-card-remove'
  remove.textContent = labels.remove
  remove.addEventListener('click', handlers.onRemove)

  const incomingOffGrid = createOffGridToggle(
    labels.incomingOffGridSegment,
    details.isIncomingOffGrid,
    handlers.onToggleIncomingOffGrid,
  )
  const outgoingOffGrid = createOffGridToggle(
    labels.outgoingOffGridSegment,
    details.isOutgoingOffGrid,
    handlers.onToggleOutgoingOffGrid,
  )

  card.append(header, coordinates, stats, remove, incomingOffGrid, outgoingOffGrid)
  return card
}

function getWaypointPopupPlacement(map, details) {
  const mapBounds = map.getContainer().getBoundingClientRect()
  const projected = map.project([details.lon, details.lat])
  const viewportWidth = globalThis.visualViewport?.width ?? globalThis.innerWidth
  const viewportHeight = globalThis.visualViewport?.height ?? globalThis.innerHeight
  const pointX = mapBounds.left + projected.x
  const pointY = mapBounds.top + projected.y
  const margin = 16
  const popupOffset = 28
  const spaceAbove = Math.max(0, pointY - margin)
  const spaceBelow = Math.max(0, viewportHeight - pointY - margin)
  const verticalAnchor = spaceAbove >= spaceBelow ? 'bottom' : 'top'
  const availableHeight = verticalAnchor === 'bottom' ? spaceAbove : spaceBelow
  const popupWidth = Math.min(330, Math.max(0, viewportWidth - margin * 2))
  const halfWidth = popupWidth / 2
  const horizontalAnchor = pointX - halfWidth < margin
    ? 'left'
    : pointX + halfWidth > viewportWidth - margin
      ? 'right'
      : ''

  return {
    anchor: horizontalAnchor ? `${verticalAnchor}-${horizontalAnchor}` : verticalAnchor,
    maxContentHeight: Math.max(80, Math.floor(availableHeight - popupOffset)),
  }
}

function createOffGridToggle(label, checked, onChange) {
  const offGrid = document.createElement('label')
  offGrid.className = 'waypoint-card-toggle'
  const offGridText = document.createElement('span')
  offGridText.textContent = label
  const offGridInput = document.createElement('input')
  offGridInput.type = 'checkbox'
  offGridInput.checked = checked
  offGridInput.addEventListener('change', onChange)
  offGrid.append(offGridText, offGridInput)
  return offGrid
}

function appendStat(container, label, value) {
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  description.textContent = value
  container.append(term, description)
}

function formatCardDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return '—'
  }
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(2)} km`
    : `${Math.round(distanceMeters)} m`
}

function formatCardElevation(elevation, notAvailable) {
  return Number.isFinite(elevation) ? `~${Math.round(elevation)} m` : notAvailable
}

function getClosestRoutePoint(map, mousePoint, geometry) {
  let closest = null
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const start = map.project([geometry[index].lon, geometry[index].lat])
    const end = map.project([geometry[index + 1].lon, geometry[index + 1].lat])
    const dx = end.x - start.x
    const dy = end.y - start.y
    const denominator = dx * dx + dy * dy
    const ratio = denominator === 0
      ? 0
      : Math.max(0, Math.min(1, (
          ((mousePoint.x - start.x) * dx + (mousePoint.y - start.y) * dy) / denominator
        )))
    const projected = {
      x: start.x + dx * ratio,
      y: start.y + dy * ratio,
    }
    const distanceSquared = (
      (mousePoint.x - projected.x) ** 2 +
      (mousePoint.y - projected.y) ** 2
    )

    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared
      closest = map.unproject(projected)
    }
  }

  return closest
    ? { lat: closest.lat, lng: closest.lng }
    : { lat: geometry[0].lat, lng: geometry[0].lon }
}

function getTrackBounds(track, routeSegments, controlPoints = []) {
  const points = [
    ...(track?.points ?? []),
    ...routeSegments.flatMap((segment) => segment.geometry ?? []),
    ...controlPoints.filter(Boolean),
  ]

  if (!points.length) {
    return null
  }

  const bounds = new maplibregl.LngLatBounds()
  points.forEach((point) => bounds.extend([point.lon, point.lat]))
  return bounds
}
