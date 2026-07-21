import { isValidCoordinate } from './trackCore.js'

export const maximumPlannedRouteExportPoints = 10000

export function buildPlannedRouteGpx({ name, profile, geometry }) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !hasOnlyValidGeometryPoints(geometry)) {
    throw new Error('A planned route needs at least two valid geometry points.')
  }

  const routeName = escapeXml(name || 'Untitled route')
  const routeType = profile === 'walking' ? 'Walking' : 'Cycling'
  const exportGeometry = simplifyRouteGeometry(geometry, maximumPlannedRouteExportPoints)
  const routePoints = exportGeometry
    .map((point) => `<rtept lat="${formatCoordinate(point.lat)}" lon="${formatCoordinate(point.lon)}"></rtept>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fix Your Track" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${routeName}</name>
    <type>${routeType}</type>
    ${routePoints}
  </rte>
</gpx>`
}

export function simplifyRouteGeometry(geometry, pointLimit = maximumPlannedRouteExportPoints) {
  const boundedLimit = Number.isInteger(pointLimit) && pointLimit >= 2
    ? Math.min(pointLimit, maximumPlannedRouteExportPoints)
    : maximumPlannedRouteExportPoints
  if (geometry.length <= boundedLimit) {
    return geometry
  }

  const simplified = [geometry[0]]
  const sourceInterval = (geometry.length - 1) / (boundedLimit - 1)
  for (let outputIndex = 1; outputIndex < boundedLimit - 1; outputIndex += 1) {
    simplified.push(geometry[Math.round(outputIndex * sourceInterval)])
  }
  simplified.push(geometry.at(-1))
  return simplified
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
  const fixed = value.toFixed(7)
  const decimal = fixed
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
  return decimal === '-0' ? '0' : decimal
}

function hasOnlyValidGeometryPoints(geometry) {
  for (let index = 0; index < geometry.length; index += 1) {
    if (!isValidCoordinate(geometry[index])) {
      return false
    }
  }
  return true
}
