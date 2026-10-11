import { haversineDistance, isValidCoordinate } from './trackCore.js'

// Borders always refer to recorded samples, including tracks with GPS-less samples.
export function moveRepairBorder(points, range, border, location, maximumDistance = 160) {
  if (!isValidCoordinate(location) || !points?.length || !range || !['start', 'end'].includes(border)) return null
  const currentSampleIndex = range[`${border}SampleIndex`]
  let nearestIndex = -1
  let nearestDistance = maximumDistance
  for (let index = 0; index < points.length; index += 1) {
    const distance = haversineDistance(points[index], location)
    const closerPass = Math.abs(points[index].sampleIndex - currentSampleIndex) < Math.abs((points[nearestIndex]?.sampleIndex ?? Infinity) - currentSampleIndex)
    if (distance < nearestDistance || (distance === nearestDistance && closerPass)) {
      nearestIndex = index
      nearestDistance = distance
    }
  }
  return repairRangeAtPoint(points, range, border, nearestIndex)
}

export function repairRangeAtPoint(points, range, border, pointIndex) {
  const point = points?.[pointIndex]
  if (!point || !range || !['start', 'end'].includes(border) || !Number.isInteger(point.sampleIndex)) return null
  const nextRange = { ...range, [`${border}SampleIndex`]: point.sampleIndex }
  if (nextRange.startSampleIndex >= nextRange.endSampleIndex) return null
  return { range: nextRange, pointIndex, point }
}
