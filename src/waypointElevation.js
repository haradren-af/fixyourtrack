export const maximumWaypointElevationReferencePoints = 10_000

export function buildWaypointElevationReference(
  trackPoints,
  maximumPoints = maximumWaypointElevationReferencePoints,
) {
  if (!Array.isArray(trackPoints) || !Number.isInteger(maximumPoints) || maximumPoints < 2) {
    return []
  }
  const elevationPoints = trackPoints.filter((point) => (
    Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lon) &&
    Number.isFinite(point?.ele)
  ))
  if (elevationPoints.length <= maximumPoints) {
    return elevationPoints
  }

  const reference = new Array(maximumPoints)
  const lastIndex = elevationPoints.length - 1
  const lastReferenceIndex = maximumPoints - 1
  for (let index = 0; index < maximumPoints; index += 1) {
    reference[index] = elevationPoints[Math.round((index * lastIndex) / lastReferenceIndex)]
  }
  return reference
}
