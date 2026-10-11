import { directLegMode, getLegMode } from './routeLegs.js'
import { anchorRouteGeometry, getPolylineLength, haversineDistance, isValidCoordinate } from './trackCore.js'

// The provider has already routed through these snapped positions. Reuse that
// geometry instead of requesting the same route again after moving the pins.
export function applyRouteControlSnapUpdates(controlPoints, preview, updates) {
  const updatesById = new Map(updates.map((point) => [point.id, point]))
  const controls = controlPoints.map((point) => {
    const update = updatesById.get(point.id)
    return update ? { ...point, lat: update.lat, lon: update.lon } : point
  })
  const segments = preview.segments.map((segment, index) => {
    const geometry = anchorRouteGeometry(segment.geometry, controls[index], controls[index + 1])
    return { ...segment, geometry, distanceMeters: getPolylineLength(geometry) }
  })
  return {
    controls,
    preview: {
      ...preview,
      segments,
      geometry: segments.flatMap((segment, index) => index ? segment.geometry.slice(1) : segment.geometry),
      distanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    },
  }
}

export function getRouteControlSnapUpdates(
  controlPoints,
  snappedControls,
  legModes,
  {
    fixedControlIds = [],
    minimumDistanceMeters = 1,
    maximumDistanceMeters = 120,
  } = {},
) {
  if (!Array.isArray(controlPoints) || !Array.isArray(snappedControls)) {
    return []
  }

  const snappedById = new Map(snappedControls.map((point) => [point?.id, point]))
  const fixedIds = new Set(fixedControlIds)
  const updates = []

  for (let index = 0; index < controlPoints.length; index += 1) {
    const control = controlPoints[index]
    const snapped = snappedById.get(control?.id)
    if (
      !control?.id ||
      fixedIds.has(control.id) ||
      !isValidCoordinate(control) ||
      !isValidCoordinate(snapped) ||
      hasAdjacentDirectLeg(controlPoints, legModes, index)
    ) {
      continue
    }

    const distanceMeters = haversineDistance(control, snapped)
    if (
      !Number.isFinite(distanceMeters) ||
      distanceMeters <= minimumDistanceMeters ||
      distanceMeters > maximumDistanceMeters
    ) {
      continue
    }

    updates.push({ id: control.id, lat: snapped.lat, lon: snapped.lon })
  }

  return updates
}

function hasAdjacentDirectLeg(controlPoints, legModes, controlIndex) {
  const incomingControl = controlIndex > 0 ? controlPoints[controlIndex - 1] : null
  const outgoingControl = controlIndex < controlPoints.length - 1
    ? controlPoints[controlIndex]
    : null
  return (
    (incomingControl && getLegMode(legModes, incomingControl.id) === directLegMode) ||
    (outgoingControl && getLegMode(legModes, outgoingControl.id) === directLegMode)
  )
}
