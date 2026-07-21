export const MAXIMUM_HIGHLIGHTED_PROFILE_POINTS = 3000

export function getSelectedProfilePoints(
  profile,
  axis,
  selection,
  maximumPoints = MAXIMUM_HIGHLIGHTED_PROFILE_POINTS,
) {
  if (
    !selection ||
    !profile?.length ||
    !Number.isFinite(selection.start) ||
    !Number.isFinite(selection.end)
  ) {
    return []
  }

  const startTarget = Math.min(selection.start, selection.end)
  const endTarget = Math.max(selection.start, selection.end)
  let startIndex = -1
  let endIndex = -1
  let closestStartDistance = Number.POSITIVE_INFINITY
  let closestEndDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < profile.length; index += 1) {
    const axisValue = profile[index]?.[axis]
    if (!Number.isFinite(axisValue)) {
      continue
    }

    const startDistance = Math.abs(axisValue - startTarget)
    if (startDistance < closestStartDistance) {
      closestStartDistance = startDistance
      startIndex = index
    }

    const endDistance = Math.abs(axisValue - endTarget)
    if (endDistance < closestEndDistance) {
      closestEndDistance = endDistance
      endIndex = index
    }
  }

  if (startIndex < 0 || endIndex < 0) {
    return []
  }
  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex]
  }

  return sampleProfileCoordinates(profile, startIndex, endIndex, maximumPoints)
}

function sampleProfileCoordinates(profile, startIndex, endIndex, maximumPoints) {
  const limit = Number.isSafeInteger(maximumPoints) && maximumPoints >= 2
    ? maximumPoints
    : MAXIMUM_HIGHLIGHTED_PROFILE_POINTS
  let coordinateCount = 0

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (hasCoordinates(profile[index])) {
      coordinateCount += 1
    }
  }

  if (!coordinateCount) {
    return []
  }

  const outputCount = Math.min(coordinateCount, limit)
  const ordinalStep = outputCount > 1 ? (coordinateCount - 1) / (outputCount - 1) : 0
  const coordinates = []
  let coordinateOrdinal = 0
  let outputOrdinal = 0
  let targetOrdinal = 0

  for (let index = startIndex; index <= endIndex && outputOrdinal < outputCount; index += 1) {
    const point = profile[index]
    if (!hasCoordinates(point)) {
      continue
    }

    if (coordinateOrdinal === targetOrdinal) {
      coordinates.push({ lat: point.lat, lon: point.lon })
      outputOrdinal += 1
      targetOrdinal = Math.round(outputOrdinal * ordinalStep)
    }
    coordinateOrdinal += 1
  }

  return coordinates
}

function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
}
