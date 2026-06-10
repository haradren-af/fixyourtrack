export function buildExportTrack(
  track,
  removedSegmentSamples,
  routeGeometry,
  rebuildDirection,
  middleRepairRange = null,
) {
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

export function finalizeTrack(track) {
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
      isValidCoordinate(sample)
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

export function buildGpx(track) {
  const trackName = escapeXml(track.name || 'Fixed Track')
  const pointSegments = buildExportPointSegments(track.samples ?? track.points ?? [])
  const segmentsXml = pointSegments
    .map((segment) => {
      const pointsXml = segment
        .map((point) => {
          const ele = point.ele !== null && point.ele !== undefined ? `<ele>${point.ele}</ele>` : ''
          const time = point.time ? `<time>${escapeXml(point.time)}</time>` : ''
          const extensions = buildTrackPointExtensions(point)
          return `<trkpt lat="${formatCoordinate(point.lat)}" lon="${formatCoordinate(point.lon)}">${ele}${time}${extensions}</trkpt>`
        })
        .join('')

      return `<trkseg>${pointsXml}</trkseg>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fix Your Track" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" xmlns:fixtrack="https://fixyourtrack.local/extensions/v1">
  <trk>
    <name>${trackName}</name>
    ${segmentsXml}
  </trk>
</gpx>`
}

export function getPolylineLength(points) {
  let totalLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += haversineDistance(points[index], points[index + 1])
  }

  return totalLength
}

export function haversineDistance(from, to) {
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

export function isValidCoordinate(point) {
  return Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
}

export function anchorRouteGeometry(geometry, from, to) {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) {
    throw new Error('Route segment contains invalid coordinates.')
  }
  if (!Array.isArray(geometry) || geometry.length < 2 || !geometry.every(isValidCoordinate)) {
    throw new Error('Routing service returned invalid route coordinates.')
  }

  return [
    { lat: from.lat, lon: from.lon },
    ...geometry.slice(1, -1),
    { lat: to.lat, lon: to.lon },
  ]
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
    const point = index === 0 || index === segmentSamples.length - 1
      ? sample
      : getPointOnPolyline(routeGeometry, progressRatios[index])
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
      repairAccepted: true,
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

function buildPointSegments(points) {
  const segments = []
  let currentSegment = []

  for (const point of points) {
    if (point.segmentStart && currentSegment.length) {
      segments.push(currentSegment)
      currentSegment = []
    }
    currentSegment.push(point)
  }

  if (currentSegment.length) {
    segments.push(currentSegment)
  }

  return segments
}

function buildExportPointSegments(samples) {
  const sourceSegments = buildPointSegments(samples)
  return sourceSegments
    .map(materializeMissingCoordinates)
    .map((segment) => segment.filter(isValidCoordinate))
    .filter((segment) => segment.length)
}

function materializeMissingCoordinates(samples) {
  const result = samples.map((sample) => ({ ...sample }))
  let index = 0

  while (index < result.length) {
    if (isValidCoordinate(result[index])) {
      index += 1
      continue
    }

    const start = index
    while (index < result.length && !isValidCoordinate(result[index])) {
      index += 1
    }
    const end = index - 1
    const before = result[start - 1]
    const after = result[index]
    if (!isValidCoordinate(before) || !isValidCoordinate(after)) {
      continue
    }

    const run = result.slice(start, end + 1)
    const ratios = getGapProgressRatios(before, run, after)
    run.forEach((sample, runIndex) => {
      const ratio = ratios[runIndex]
      result[start + runIndex] = {
        ...sample,
        lat: before.lat + (after.lat - before.lat) * ratio,
        lon: before.lon + (after.lon - before.lon) * ratio,
        gpsInterpolated: true,
      }
    })
  }

  return result
}

function getGapProgressRatios(before, run, after) {
  if (
    Number.isFinite(before.distance) &&
    Number.isFinite(after.distance) &&
    after.distance > before.distance
  ) {
    const totalDistance = after.distance - before.distance
    return run.map((sample, index) => {
      const fallback = (index + 1) / (run.length + 1)
      return Number.isFinite(sample.distance)
        ? clamp01((sample.distance - before.distance) / totalDistance)
        : fallback
    })
  }

  const beforeTime = before.time ? new Date(before.time).getTime() : null
  const afterTime = after.time ? new Date(after.time).getTime() : null
  if (Number.isFinite(beforeTime) && Number.isFinite(afterTime) && afterTime > beforeTime) {
    const totalTime = afterTime - beforeTime
    return run.map((sample, index) => {
      const fallback = (index + 1) / (run.length + 1)
      const sampleTime = sample.time ? new Date(sample.time).getTime() : null
      return Number.isFinite(sampleTime)
        ? clamp01((sampleTime - beforeTime) / totalTime)
        : fallback
    })
  }

  return run.map((_, index) => (index + 1) / (run.length + 1))
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

  if (Number.isFinite(point.distance)) {
    customFields.push(`<fixtrack:distance>${point.distance}</fixtrack:distance>`)
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

function degreesToRadians(value) {
  return (value * Math.PI) / 180
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatCoordinate(value) {
  return Number.parseFloat(value.toFixed(7))
}
