import { getTrackStatistics } from './trackCore.js'

export const MAXIMUM_HIGHLIGHTED_PROFILE_POINTS = 3000

export function getProfileStatistics(profile, axis, range, statistics) {
  if (!range && statistics) return statistics
  const samples = profile.filter(point => !range || (Number.isFinite(point[axis]) && point[axis] >= range.start && point[axis] <= range.end)).map(point => ({
    ...point,
    speed: Number.isFinite(point.speed) ? point.speed / 3.6 : null,
    time: Number.isFinite(point.time) ? new Date(point.time * 1000).toISOString() : null,
  }))
  return getTrackStatistics(samples)
}

// A device summary describes the entire recording. Keep it only while cadence
// samples and their timing are intact; a uniform date/time shift is harmless.
export function getRecordedCadenceAverage(samples, sourceTrack) {
  const average = sourceTrack?.recordedAverageCadence
  const original = sourceTrack?.samples
  if (!Number.isFinite(average) || average < 0 || !samples?.length || samples.length !== original?.length) {
    return null
  }

  let timeOffset = null
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    const source = original[index]
    if (sample.cadence !== source.cadence) return null
    if (sample.time === source.time) {
      if (sample.time && timeOffset !== null && timeOffset !== 0) return null
      if (sample.time) timeOffset = 0
      continue
    }
    const offset = Date.parse(sample.time) - Date.parse(source.time)
    if (!Number.isFinite(offset) || (timeOffset !== null && offset !== timeOffset)) return null
    timeOffset = offset
  }
  return average
}

export function getCadenceStats(profile, axis, selectedRange, recordedAverage = null) {
  let count = 0
  let pedalingCount = 0
  let total = 0
  let minimum = Infinity
  let maximum = -Infinity
  for (const point of profile) {
    if (selectedRange && (!Number.isFinite(point[axis]) || point[axis] < selectedRange.start || point[axis] > selectedRange.end)) continue
    if (!Number.isFinite(point.cadence) || point.cadence < 0) continue
    count += 1
    minimum = Math.min(minimum, point.cadence)
    maximum = Math.max(maximum, point.cadence)
    if (point.cadence > 0) {
      pedalingCount += 1
      total += point.cadence
    }
  }
  const usesRecordedAverage = !selectedRange && Number.isFinite(recordedAverage) && recordedAverage >= 0
  return {
    average: usesRecordedAverage ? recordedAverage : pedalingCount ? total / pedalingCount : count ? 0 : null,
    minimum: count ? minimum : null,
    maximum: count ? maximum : null,
    usesRecordedAverage,
  }
}

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
