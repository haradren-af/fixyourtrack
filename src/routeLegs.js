export const directLegMode = 'direct'
export const routedLegMode = 'routed'

export function getLegMode(legModes, fromId) {
  return legModes?.[fromId] === directLegMode ? directLegMode : routedLegMode
}

export function splitLeg(
  legModes,
  insertAfterId,
  newWaypointId,
  requestedIncomingMode = null,
  requestedOutgoingMode = null,
) {
  const currentMode = getLegMode(legModes, insertAfterId)
  const incomingMode = normalizeLegMode(requestedIncomingMode, currentMode)
  const outgoingMode = normalizeLegMode(requestedOutgoingMode, currentMode)

  return {
    ...legModes,
    [insertAfterId]: incomingMode,
    [newWaypointId]: outgoingMode,
  }
}

export function setLegMode(legModes, fromId, mode) {
  return {
    ...legModes,
    [fromId]: mode === directLegMode ? directLegMode : routedLegMode,
  }
}

export function removeWaypointLeg(legModes, viaPoints, waypointId, rebuildDirection) {
  const waypointIndex = viaPoints.findIndex((point) => point.id === waypointId)
  if (waypointIndex < 0) {
    return legModes
  }

  const previousControlId = waypointIndex === 0
    ? getRouteStartControlId(rebuildDirection)
    : viaPoints[waypointIndex - 1].id
  const nextModes = {
    ...legModes,
    [previousControlId]: routedLegMode,
  }
  delete nextModes[waypointId]
  return nextModes
}

export function normalizeLegModes(legModes) {
  if (!legModes || typeof legModes !== 'object' || Array.isArray(legModes)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(legModes)
      .filter(([id, mode]) => typeof id === 'string' && [directLegMode, routedLegMode].includes(mode)),
  )
}

export function getRouteStartControlId(rebuildDirection) {
  return rebuildDirection === 'before' ? 'endpoint' : 'anchor'
}

function normalizeLegMode(mode, fallback) {
  return [directLegMode, routedLegMode].includes(mode) ? mode : fallback
}
