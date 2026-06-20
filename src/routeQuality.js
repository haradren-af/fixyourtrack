import { getPolylineLength, haversineDistance, isValidCoordinate } from './trackCore.js'

export function shouldUseDirectGeometryFallback(from, to, geometry) {
  if (!isValidCoordinate(from) || !isValidCoordinate(to) || !Array.isArray(geometry) || geometry.length < 3) {
    return false
  }

  const directDistance = haversineDistance(from, to)
  if (directDistance < 8) {
    return false
  }

  const routedDistance = getPolylineLength(geometry)
  const maxDeviation = getMaxDeviationFromControlLine(from, to, geometry)
  const firstConnector = haversineDistance(geometry[0], geometry[1])
  const lastConnector = haversineDistance(geometry.at(-2), geometry.at(-1))
  const worstConnector = Math.max(firstConnector, lastConnector)

  const hasDetachedSnap = directDistance < 250 &&
    routedDistance > Math.max(directDistance * 1.7, directDistance + 30) &&
    worstConnector > Math.max(25, directDistance * 0.65)

  const hasShortSpike = directDistance < 180 &&
    routedDistance > Math.max(directDistance * 2.2, directDistance + 35) &&
    maxDeviation > Math.max(18, directDistance * 0.3)

  const hasMediumSpike = directDistance < 500 &&
    routedDistance > Math.max(directDistance * 2.8, directDistance + 120) &&
    maxDeviation > Math.max(45, directDistance * 0.35)

  return hasDetachedSnap || hasShortSpike || hasMediumSpike
}

function getMaxDeviationFromControlLine(from, to, geometry) {
  return geometry
    .slice(1, -1)
    .reduce((maxDistance, point) => Math.max(maxDistance, getDistanceToLineSegment(point, from, to)), 0)
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
