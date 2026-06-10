import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const EMPTY_COLLECTION = {
  type: 'FeatureCollection',
  features: [],
}

export default function TrackMap({
  activeWaypointId,
  anchorPoint,
  anchorLabel,
  endpoint,
  endpointLabel,
  fitRequest,
  hasTrackEdits,
  highlightedTrackPoints,
  initialView,
  interactionMode,
  layoutSignature,
  mapLayer,
  onEndpointMove,
  onMapClick,
  onRouteSegmentClick,
  onTrackClick,
  onWaypointMove,
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
  waypointLabel,
  offGridLabel,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const initialMapLayerRef = useRef(mapLayer)
  const initialViewRef = useRef(initialView)
  const previousFitRequestRef = useRef(null)
  const interactionModeRef = useRef(interactionMode)
  const routeSegmentsRef = useRef(routeSegments)
  const handlersRef = useRef({})
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    routeSegmentsRef.current = routeSegments
  }, [routeSegments])

  useEffect(() => {
    interactionModeRef.current = interactionMode
  }, [interactionMode])

  useEffect(() => {
    handlersRef.current = {
      onEndpointMove,
      onMapClick,
      onRouteSegmentClick,
      onTrackClick,
      onWaypointMove,
      onWaypointRemove,
      onWaypointSelect,
    }
  }, [
    onEndpointMove,
    onMapClick,
    onRouteSegmentClick,
    onTrackClick,
    onWaypointMove,
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
          handlersRef.current.onRouteSegmentClick(segment, latlng)
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

    map.on('load', () => {
      map.on('click', handleClick)
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
    setSourceData(map, 'track', trackToGeoJson(track))
    setSourceData(map, 'suspicious', suspiciousToGeoJson(suspiciousSegments, track))
    setSourceData(map, 'route', routeToGeoJson(routeSegments))
    setSourceData(map, 'track-highlight', pointsToGeoJson(highlightedTrackPoints))
  }, [hasTrackEdits, highlightedTrackPoints, mapReady, routeSegments, sourceTrack, suspiciousSegments, track])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) {
      return
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    if (selectedCutPoint) {
      markersRef.current.push(addMarker(map, selectedCutPoint, {
        className: 'map-pin-cut',
        label: selectedCutPointLabel,
      }))
    }

    if (anchorPoint) {
      markersRef.current.push(addMarker(map, anchorPoint, {
        className: 'map-pin-anchor',
        label: anchorLabel,
      }))
    }

    if (endpoint) {
      markersRef.current.push(addMarker(map, endpoint, {
        className: 'map-pin-endpoint',
        draggable: rebuildDirection !== 'middle',
        label: endpointLabel,
        onMove: (latlng) => handlersRef.current.onEndpointMove(latlng),
      }))
    }

    viaPoints.forEach((point, index) => {
      markersRef.current.push(addMarker(map, point, {
        active: point.id === activeWaypointId,
        className: point.offGrid ? 'map-pin-offgrid' : 'map-pin-via',
        draggable: true,
        title: `${point.offGrid ? offGridLabel : waypointLabel} ${index + 1}`,
        onClick: () => handlersRef.current.onWaypointSelect(point.id),
        onDoubleClick: () => handlersRef.current.onWaypointRemove(point.id),
        onMove: (latlng) => handlersRef.current.onWaypointMove(point.id, latlng),
      }))
    })

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
    }
  }, [
    activeWaypointId,
    anchorLabel,
    anchorPoint,
    endpoint,
    endpointLabel,
    mapReady,
    offGridLabel,
    rebuildDirection,
    selectedCutPoint,
    selectedCutPointLabel,
    viaPoints,
    waypointLabel,
  ])

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return
    }

    requestAnimationFrame(() => mapRef.current?.resize())
  }, [layoutSignature, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !track || fitRequest === previousFitRequestRef.current) {
      return
    }

    const bounds = getTrackBounds(track, routeSegments)
    if (!bounds) {
      return
    }

    previousFitRequestRef.current = fitRequest
    map.fitBounds(bounds, { padding: 36, duration: 0 })
  }, [fitRequest, mapReady, routeSegments, track])

  return <div ref={containerRef} className="map" />
}

function createMapStyle(activeLayer) {
  return {
    version: 8,
    sources: {
      scheme: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
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
  if (options.title) {
    element.title = options.title
  }

  const pin = document.createElement('div')
  pin.className = `map-pin ${options.className}`
  element.append(pin)

  if (options.label) {
    const label = document.createElement('span')
    label.className = 'map-marker-label'
    label.textContent = options.label
    element.append(label)
  }

  if (options.onClick) {
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      options.onClick()
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

  if (options.onMove) {
    marker.on('dragend', () => {
      const position = marker.getLngLat()
      options.onMove({ lat: position.lat, lng: position.lng })
    })
  }

  return marker
}

function getTrackBounds(track, routeSegments) {
  const points = [
    ...(track?.points ?? []),
    ...routeSegments.flatMap((segment) => segment.geometry ?? []),
  ]

  if (!points.length) {
    return null
  }

  const bounds = new maplibregl.LngLatBounds()
  points.forEach((point) => bounds.extend([point.lon, point.lat]))
  return bounds
}
