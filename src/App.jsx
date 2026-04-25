import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import FitParser from 'fit-file-parser'
import { gpx as toGeoJsonGpx } from '@tmcw/togeojson'
import './App.css'

const startIcon = L.divIcon({
  className: 'point-icon point-icon-start',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const endIcon = L.divIcon({
  className: 'point-icon point-icon-end',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const handleIcon = L.divIcon({
  className: 'point-icon point-icon-handle',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const activeHandleIcon = L.divIcon({
  className: 'point-icon point-icon-handle point-icon-handle-active',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const initialView = [55.751244, 37.618423]

function App() {
  const [track, setTrack] = useState(null)
  const [selection, setSelection] = useState(null)
  const [repairHandles, setRepairHandles] = useState([])
  const [activeHandleIndex, setActiveHandleIndex] = useState(null)
  const [message, setMessage] = useState('Загрузи GPX или FIT, и мы сможем исправить потерянный участок вручную.')
  const [error, setError] = useState('')
  const suppressTrackPickUntilRef = useRef(0)
  const [mapEditEnabled, setMapEditEnabled] = useState(true)

  const suspiciousSegments = useMemo(() => {
    if (!track) {
      return []
    }

    const items = []

    for (let index = 0; index < track.points.length - 1; index += 1) {
      const current = track.points[index]
      const next = track.points[index + 1]
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
        items.push({
          id: `${index}-${index + 1}`,
          startIndex: index,
          endIndex: index + 1,
          distance,
          seconds,
          calcSpeedKmh,
          deviceSpeedKmh,
        })
      }
    }

    return items.slice(0, 12)
  }, [track])

  const selectedPoints = useMemo(() => {
    if (!track || !selection) {
      return []
    }

    return track.points.slice(selection.startIndex, selection.endIndex + 1)
  }, [selection, track])

  const selectedPolyline = useMemo(
    () => selectedPoints.map((point) => [point.lat, point.lon]),
    [selectedPoints],
  )

  const repairedPreview = useMemo(() => {
    if (!selection || repairHandles.length < 2 || selectedPoints.length < 2) {
      return []
    }

    return buildRepairedSegment(selectedPoints, repairHandles)
  }, [repairHandles, selectedPoints, selection])

  const trackPolyline = useMemo(
    () => (track ? track.points.map((point) => [point.lat, point.lon]) : []),
    [track],
  )

  async function handleFileChange(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      setError('')
      setMessage(`Читаю файл ${file.name}...`)
      const nextTrack = await loadTrack(file)
      setTrack(nextTrack)
      setSelection(null)
      setRepairHandles([])
      setActiveHandleIndex(null)
      setMessage(
        `Открыт ${file.name}: ${nextTrack.points.length} точек. Выбери подозрительный участок из списка или кликни по треку два раза.`,
      )
    }
    catch (nextError) {
      setTrack(null)
      setSelection(null)
      setRepairHandles([])
      setActiveHandleIndex(null)
      setError(nextError.message)
      setMessage('Не удалось прочитать файл.')
    }
    finally {
      event.target.value = ''
    }
  }

  function selectSegment(startIndex, endIndex) {
    if (!track) {
      return
    }

    const normalizedStart = Math.max(0, Math.min(startIndex, endIndex))
    const normalizedEnd = Math.min(track.points.length - 1, Math.max(startIndex, endIndex))

    if (normalizedEnd - normalizedStart < 1) {
      return
    }

    const nextSelection = {
      startIndex: normalizedStart,
      endIndex: normalizedEnd,
    }

    setSelection(nextSelection)
    setRepairHandles(createDefaultHandles(track, nextSelection))
    setActiveHandleIndex(1)
    setMessage(
      `Редактируем точки ${normalizedStart + 1}-${normalizedEnd + 1}. Перетаскивай белые маркеры, добавляй промежуточные точки и затем сохраняй GPX.`,
    )
  }

  function handleTrackClick(index) {
    if (!track) {
      return
    }

    if (!selection) {
      setSelection({ startIndex: index, endIndex: Math.min(index + 1, track.points.length - 1) })
      setRepairHandles([])
      setActiveHandleIndex(null)
      setMessage(
        `Выбрана стартовая точка ${index + 1}. Кликни по треку еще раз, чтобы задать конец проблемного участка.`,
      )
      return
    }

    if (selection.startIndex === selection.endIndex || selection.endIndex === selection.startIndex + 1) {
      selectSegment(selection.startIndex, index)
      return
    }

    setSelection({ startIndex: index, endIndex: index })
    setRepairHandles([])
    setActiveHandleIndex(null)
    setMessage(`Новая стартовая точка ${index + 1}. Кликни по треку еще раз, чтобы выбрать конец участка.`)
  }

  function addHandle() {
    if (repairHandles.length < 2) {
      return
    }

    const longestSegmentIndex = getLongestSegmentIndex(repairHandles)
    const before = repairHandles[longestSegmentIndex]
    const after = repairHandles[longestSegmentIndex + 1]
    const inserted = estimateMidpoint(before, after)

    setRepairHandles((current) => {
      const next = [...current]
      next.splice(longestSegmentIndex + 1, 0, inserted)
      return next
    })
    setActiveHandleIndex(longestSegmentIndex + 1)
  }

  function addHandleAtMapPoint(latlng) {
    if (!selection || repairHandles.length < 2) {
      return
    }

    const insertIndex = getClosestHandleSegmentIndex(repairHandles, {
      lat: latlng.lat,
      lon: latlng.lng,
    })

    setRepairHandles((current) => {
      const next = [...current]
      next.splice(insertIndex + 1, 0, { lat: latlng.lat, lon: latlng.lng })
      return next
    })
    setActiveHandleIndex(insertIndex + 1)
  }

  function removeHandle() {
    if (activeHandleIndex === null || activeHandleIndex === 0 || activeHandleIndex === repairHandles.length - 1) {
      return
    }

    setRepairHandles((current) => current.filter((_, index) => index !== activeHandleIndex))
    setActiveHandleIndex(null)
  }

  function applyRepair() {
    if (!track || !selection || repairedPreview.length !== selectedPoints.length) {
      if (!track || !selection || repairedPreview.length < 2) {
        return
      }
    }

    if (!track || !selection || repairedPreview.length < 2) {
      return
    }

    const before = track.points.slice(0, selection.startIndex)
    const after = track.points.slice(selection.endIndex + 1)
    const nextPoints = [...before, ...repairedPreview, ...after]

    setTrack(
      finalizeTrack({
        ...track,
        points: nextPoints,
      }),
    )
    const nextEndIndex = selection.startIndex + repairedPreview.length - 1
    setSelection({ startIndex: selection.startIndex, endIndex: nextEndIndex })
    setRepairHandles(createDefaultHandles({ points: nextPoints }, { startIndex: selection.startIndex, endIndex: nextEndIndex }))
    setActiveHandleIndex(1)
    setMessage('Исправление применено к треку. При необходимости можно выбрать следующий участок.')
  }

  function exportTrack() {
    if (!track) {
      return
    }

    const gpxContent = buildGpx(track)
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${sanitizeFilename(track.name || 'fixed-track')}.gpx`
    link.click()
    URL.revokeObjectURL(url)
    setMessage('Готово: исправленный GPX выгружен.')
  }

  return (
    <div className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Fix Your Track</p>
          <h1>Ручной ремонт GPS-треков для Strava и Komoot</h1>
          <p className="lead">
            Загружай трек с велокомпьютера, находи прямые участки после потери GPS и правь
            геометрию вручную по карте. На выходе получишь чистый GPX для повторного импорта.
          </p>
        </div>

        <div className="action-card">
          <label className="file-picker">
            <input type="file" accept=".gpx,.fit" onChange={handleFileChange} />
            <span>Открыть GPX или FIT</span>
          </label>
          <button type="button" className="ghost-button" onClick={exportTrack} disabled={!track}>
            Скачать исправленный GPX
          </button>
          <p className="status-text">{message}</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <h2>Трек</h2>
            {track ? (
              <dl className="stats-grid">
                <div>
                  <dt>Имя</dt>
                  <dd>{track.name}</dd>
                </div>
                <div>
                  <dt>Точек</dt>
                  <dd>{track.points.length}</dd>
                </div>
                <div>
                  <dt>Дистанция</dt>
                  <dd>{formatDistance(track.distanceMeters)}</dd>
                </div>
                <div>
                  <dt>Формат</dt>
                  <dd>{track.format.toUpperCase()}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted-text">После загрузки здесь появится сводка по треку.</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Подозрительные разрывы</h2>
              <span>{suspiciousSegments.length}</span>
            </div>
            {suspiciousSegments.length ? (
              <div className="segment-list">
                {suspiciousSegments.map((segment) => (
                  <button
                    type="button"
                    key={segment.id}
                    className="segment-button"
                    onClick={() => selectSegment(segment.startIndex, segment.endIndex)}
                  >
                    <strong>
                      Точки {segment.startIndex + 1}-{segment.endIndex + 1}
                    </strong>
                    <span>{formatDistance(segment.distance)}</span>
                    <span>
                      {segment.calcSpeedKmh
                        ? `${segment.calcSpeedKmh.toFixed(1)} км/ч по GPS`
                        : 'Нет времени между точками'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted-text">
                Автопоиск не нашел явных проблем или трек еще не загружен. Можно выбрать участок
                прямо кликом по линии на карте.
              </p>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Редактор участка</h2>
              <span>{selection ? `${selection.startIndex + 1}-${selection.endIndex + 1}` : 'не выбран'}</span>
            </div>
            <p className="muted-text">
              1. Выбери битый участок.
              <br />
              2. Перетаскивай белые контрольные точки.
              <br />
              3. Добавляй промежуточные точки для изгибов.
              <br />
              4. Применяй и выгружай GPX.
            </p>
            <div className="editor-actions">
              <button type="button" onClick={addHandle} disabled={!selection}>
                Добавить контрольную точку
              </button>
              <button
                type="button"
                onClick={() => setMapEditEnabled((current) => !current)}
                disabled={!selection}
              >
                {mapEditEnabled ? 'Клик по карте: вкл' : 'Клик по карте: выкл'}
              </button>
              <button
                type="button"
                onClick={removeHandle}
                disabled={
                  activeHandleIndex === null ||
                  activeHandleIndex === 0 ||
                  activeHandleIndex === repairHandles.length - 1
                }
              >
                Удалить активную точку
              </button>
              <button type="button" className="primary-button" onClick={applyRepair} disabled={!selection}>
                Применить исправление
              </button>
            </div>
          </div>
        </aside>

        <div className="map-panel">
          <MapContainer center={initialView} zoom={11} scrollWheelZoom className="map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {track ? <FitBounds points={track.points} /> : null}

            {track ? (
              <TrackPolylineLayer
                points={track.points}
                onPointPick={handleTrackClick}
                suppressTrackPickUntilRef={suppressTrackPickUntilRef}
                selectionActive={Boolean(selection)}
                mapEditEnabled={mapEditEnabled}
                onAddHandle={addHandleAtMapPoint}
              />
            ) : null}

            {trackPolyline.length ? (
              <Polyline positions={trackPolyline} pathOptions={{ color: '#204e4a', weight: 4, opacity: 0.5 }} />
            ) : null}

            {selectedPolyline.length ? (
              <Polyline positions={selectedPolyline} pathOptions={{ color: '#f15a24', weight: 7, opacity: 0.75 }} />
            ) : null}

            {repairedPreview.length ? (
              <>
                <Polyline
                  positions={repairedPreview.map((point) => [point.lat, point.lon])}
                  pathOptions={{ color: '#111111', weight: 7, opacity: 0.9, lineCap: 'round' }}
                />
                <Polyline
                  positions={repairedPreview.map((point) => [point.lat, point.lon])}
                  pathOptions={{
                    color: '#f4f0e8',
                    weight: 5,
                    opacity: 1,
                    dashArray: '12 8',
                    lineCap: 'round',
                  }}
                />
              </>
            ) : null}

            {repairHandles.map((point, index) => {
              const isEdge = index === 0 || index === repairHandles.length - 1

              return (
                <Marker
                  key={`${point.lat}-${point.lon}-${index}`}
                  position={[point.lat, point.lon]}
                  draggable
                  icon={
                    isEdge
                      ? index === 0
                        ? startIcon
                        : endIcon
                      : activeHandleIndex === index
                        ? activeHandleIcon
                        : handleIcon
                  }
                  eventHandlers={{
                    click: () => {
                      suppressTrackPickUntilRef.current = Date.now() + 250
                      setActiveHandleIndex(index)
                    },
                    dragstart: () => {
                      suppressTrackPickUntilRef.current = Date.now() + 5_000
                    },
                    dragend: (event) => {
                      const nextLatLng = event.target.getLatLng()
                      suppressTrackPickUntilRef.current = Date.now() + 400
                      setRepairHandles((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { lat: nextLatLng.lat, lon: nextLatLng.lng }
                            : item,
                        ),
                      )
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                    {isEdge ? (index === 0 ? 'Начало участка' : 'Конец участка') : `Контрольная точка ${index}`}
                  </Tooltip>
                </Marker>
              )
            })}
          </MapContainer>
        </div>
      </section>
    </div>
  )
}

function FitBounds({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) {
      return
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]))
    map.fitBounds(bounds, { padding: [32, 32] })
  }, [map, points])

  return null
}

function TrackPolylineLayer({
  points,
  onPointPick,
  suppressTrackPickUntilRef,
  selectionActive,
  mapEditEnabled,
  onAddHandle,
}) {
  const map = useMap()

  useEffect(() => {
    function handleClick(event) {
      if (Date.now() < suppressTrackPickUntilRef.current) {
        return
      }

       if (selectionActive && mapEditEnabled) {
        onAddHandle(event.latlng)
        suppressTrackPickUntilRef.current = Date.now() + 250
        return
      }

      const nearestIndex = findNearestPointIndex(points, event.latlng)
      if (nearestIndex !== null) {
        onPointPick(nearestIndex)
      }
    }

    map.on('click', handleClick)
    return () => map.off('click', handleClick)
  }, [
    map,
    mapEditEnabled,
    onAddHandle,
    onPointPick,
    points,
    selectionActive,
    suppressTrackPickUntilRef,
  ])

  return null
}

async function loadTrack(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'gpx') {
    return readGpxFile(file)
  }

  if (extension === 'fit') {
    return readFitFile(file)
  }

  throw new Error('Поддерживаются только файлы GPX и FIT.')
}

async function readGpxFile(file) {
  const content = await file.text()
  const xml = new DOMParser().parseFromString(content, 'application/xml')
  const geoJson = toGeoJsonGpx(xml)
  const feature = geoJson.features.find((item) => item.geometry?.type === 'LineString')

  if (!feature) {
    throw new Error('В GPX не найден трек с координатами.')
  }

  const coordinates = feature.geometry.coordinates
  const times = feature.properties?.coordinateProperties?.times ?? []
  const elevations = feature.properties?.coordinateProperties?.ele ?? []

  const points = coordinates.map((coordinate, index) => ({
    lat: coordinate[1],
    lon: coordinate[0],
    ele: coordinate[2] ?? elevations[index] ?? null,
    time: times[index] ?? null,
    speed: null,
  }))

  return finalizeTrack({
    name: file.name.replace(/\.gpx$/i, ''),
    format: 'gpx',
    points,
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

  const points = records
    .filter((record) => Number.isFinite(record.position_lat) && Number.isFinite(record.position_long))
    .map((record) => ({
      lat: normalizeFitCoordinate(record.position_lat),
      lon: normalizeFitCoordinate(record.position_long),
      ele: Number.isFinite(record.altitude) ? record.altitude : null,
      time: record.timestamp ? new Date(record.timestamp).toISOString() : null,
      speed: Number.isFinite(record.speed) ? record.speed : null,
    }))

  if (!points.length) {
    throw new Error('В FIT не найдено GPS-точек.')
  }

  return finalizeTrack({
    name: file.name.replace(/\.fit$/i, ''),
    format: 'fit',
    points,
  })
}

function finalizeTrack(track) {
  const points = track.points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  )

  if (points.length < 2) {
    throw new Error('В треке слишком мало валидных точек для редактирования.')
  }

  return {
    ...track,
    points,
    distanceMeters: points.slice(1).reduce((total, point, index) => total + haversineDistance(points[index], point), 0),
  }
}

function buildGpx(track) {
  const trackName = escapeXml(track.name || 'Fixed Track')
  const pointsXml = track.points
    .map((point) => {
      const ele = point.ele !== null && point.ele !== undefined ? `<ele>${point.ele}</ele>` : ''
      const time = point.time ? `<time>${escapeXml(point.time)}</time>` : ''
      return `<trkpt lat="${point.lat}" lon="${point.lon}">${ele}${time}</trkpt>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fix Your Track" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${trackName}</name>
    <trkseg>${pointsXml}</trkseg>
  </trk>
</gpx>`
}

function buildRepairedSegment(sourcePoints, handles) {
  const targetCount = getRepairPointCount(sourcePoints, handles)

  if (targetCount <= 1) {
    return handles.slice(0, 1)
  }

  return Array.from({ length: targetCount }, (_, index) => {
    const ratio = index / (targetCount - 1)
    const geometryPoint = getPointOnPolyline(handles, ratio)
    const profilePoint = getProfilePoint(sourcePoints, ratio)

    return {
      lat: geometryPoint.lat,
      lon: geometryPoint.lon,
      ele: profilePoint.ele,
      time: profilePoint.time,
      speed: profilePoint.speed,
    }
  })
}

function getRepairPointCount(sourcePoints, handles) {
  const handleLength = getPolylineLength(handles)
  const timeGap = getSecondsBetween(sourcePoints[0]?.time, sourcePoints[sourcePoints.length - 1]?.time)
  const countByDistance = Math.max(2, Math.round(handleLength / 20) + 1)
  const countByTime = timeGap ? Math.max(2, Math.round(timeGap) + 1) : 0
  return Math.min(2000, Math.max(sourcePoints.length, handles.length, countByDistance, countByTime))
}

function getPolylineLength(points) {
  let totalLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += haversineDistance(points[index], points[index + 1])
  }

  return totalLength
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

function getProfilePoint(sourcePoints, ratio) {
  const start = sourcePoints[0]
  const end = sourcePoints[sourcePoints.length - 1]
  const fallbackPoint = sourcePoints[Math.min(sourcePoints.length - 1, Math.round(ratio * (sourcePoints.length - 1)))]

  return {
    ele: interpolateNumber(start?.ele, end?.ele, ratio, fallbackPoint?.ele ?? null),
    time: interpolateTime(start?.time, end?.time, ratio, fallbackPoint?.time ?? null),
    speed: interpolateNumber(start?.speed, end?.speed, ratio, fallbackPoint?.speed ?? null),
  }
}

function interpolateNumber(start, end, ratio, fallbackValue = null) {
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return start + (end - start) * ratio
  }

  if (Number.isFinite(start)) {
    return start
  }

  if (Number.isFinite(end)) {
    return end
  }

  return fallbackValue
}

function interpolateTime(start, end, ratio, fallbackValue = null) {
  if (!start || !end) {
    return fallbackValue
  }

  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return fallbackValue
  }

  return new Date(startMs + (endMs - startMs) * ratio).toISOString()
}

function findNearestPointIndex(points, latlng) {
  let bestIndex = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < points.length; index += 1) {
    const distance = haversineDistance(points[index], { lat: latlng.lat, lon: latlng.lng })
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestDistance <= 250 ? bestIndex : null
}

function getLongestSegmentIndex(points) {
  let longest = 0
  let index = 0

  for (let itemIndex = 0; itemIndex < points.length - 1; itemIndex += 1) {
    const distance = haversineDistance(points[itemIndex], points[itemIndex + 1])
    if (distance > longest) {
      longest = distance
      index = itemIndex
    }
  }

  return index
}

function getClosestHandleSegmentIndex(points, target) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(target, points[index], points[index + 1])
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function distanceToSegment(point, start, end) {
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

function estimateMidpoint(start, end) {
  return {
    lat: (start.lat + end.lat) / 2,
    lon: (start.lon + end.lon) / 2,
  }
}

function createDefaultHandles(track, selection) {
  const start = track.points[selection.startIndex]
  const end = track.points[selection.endIndex]
  const midpoint = estimateMidpoint(start, end)

  return [
    { lat: start.lat, lon: start.lon },
    midpoint,
    { lat: end.lat, lon: end.lon },
  ]
}

function maxSpeedKmh(firstSpeed, secondSpeed) {
  const values = [firstSpeed, secondSpeed].filter(Number.isFinite)
  if (!values.length) {
    return null
  }
  return Math.max(...values) * 3.6
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

function formatDistance(distanceMeters) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} км`
  }

  return `${Math.round(distanceMeters)} м`
}

function sanitizeFilename(name) {
  return Array.from(name, (char) =>
    /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? '-' : char,
  ).join('')
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
