import { directLegMode, getLegMode } from './routeLegs.js'
import { haversineDistance, isValidCoordinate } from './trackCore.js'

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
