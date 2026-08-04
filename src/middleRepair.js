import {
  createPolylineSampler,
  finalizeTrack,
  isValidCoordinate,
} from './trackCore.js'

export function buildMiddleRepairTrack(track, routeGeometry, middleRepairRange) {
  if (!track) {
    throw new Error('No track loaded.')
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    return track
  }
  if (!routeGeometry.every(isValidCoordinate)) {
    throw new Error('Repair route contains invalid coordinates.')
  }

  const { startSampleIndex, endSampleIndex } = middleRepairRange ?? {}
  if (
    !Number.isInteger(startSampleIndex) ||
    !Number.isInteger(endSampleIndex) ||
    startSampleIndex < 0 ||
    endSampleIndex <= startSampleIndex ||
    endSampleIndex >= track.samples.length
  ) {
    throw new Error('Middle repair range is invalid.')
  }

  const segmentSamples = track.samples.slice(startSampleIndex, endSampleIndex + 1)
  const progressRatios = getMiddleSegmentProgressRatios(segmentSamples)
  const pointOnRoute = createPolylineSampler(routeGeometry)
  const repairedSegment = segmentSamples.map((sample, index) => {
    const point = index === 0 || index === segmentSamples.length - 1
      ? sample
      : pointOnRoute(progressRatios[index])
    return {
      ...sample,
      lat: point.lat,
      lon: point.lon,
      repairAccepted: true,
    }
  })

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

function getMiddleSegmentProgressRatios(segmentSamples) {
  const firstSample = segmentSamples[0]
  const lastSample = segmentSamples[segmentSamples.length - 1]
  const fallbackRatios = segmentSamples.map(
    (_, index) => index / (segmentSamples.length - 1),
  )
  const timeRatios = getTimeProgressRatios(segmentSamples, fallbackRatios)
  const firstDistance = firstSample?.distance
  const lastDistance = lastSample?.distance

  if (
    Number.isFinite(firstDistance) &&
    Number.isFinite(lastDistance) &&
    lastDistance > firstDistance
  ) {
    const totalDistance = lastDistance - firstDistance
    const distanceRatios = segmentSamples.map((sample, index) => {
      const fallback = index / (segmentSamples.length - 1)
      const progress = Number.isFinite(sample.distance)
        ? (sample.distance - firstDistance) / totalDistance
        : fallback
      return clamp01(progress)
    })

    if (hasReliableDistanceProgress(distanceRatios, timeRatios)) {
      return distanceRatios
    }
  }

  return timeRatios
}

function getTimeProgressRatios(segmentSamples, fallbackRatios) {
  const firstSample = segmentSamples[0]
  const lastSample = segmentSamples[segmentSamples.length - 1]
  const firstTime = firstSample?.time ? new Date(firstSample.time).getTime() : null
  const lastTime = lastSample?.time ? new Date(lastSample.time).getTime() : null

  if (Number.isFinite(firstTime) && Number.isFinite(lastTime) && lastTime > firstTime) {
    const totalTime = lastTime - firstTime
    const ratios = segmentSamples.map((sample, index) => {
      const sampleTime = sample.time ? new Date(sample.time).getTime() : null
      const progress = Number.isFinite(sampleTime)
        ? (sampleTime - firstTime) / totalTime
        : fallbackRatios[index]
      return clamp01(progress)
    })

    if (isMonotonicProgress(ratios)) {
      return ratios
    }
  }

  return fallbackRatios
}

function hasReliableDistanceProgress(distanceRatios, referenceRatios) {
  if (!isMonotonicProgress(distanceRatios)) {
    return false
  }

  return distanceRatios.every((ratio, index) => {
    if (index === 0) {
      return true
    }

    const distanceStep = ratio - distanceRatios[index - 1]
    const referenceStep = Math.max(0, referenceRatios[index] - referenceRatios[index - 1])

    // Some devices freeze distance during GPS loss and backfill it in one record.
    // Reject that catch-up jump so it cannot recreate a straight line after repair.
    return distanceStep <= Math.max(0.08, referenceStep * 4)
  })
}

function isMonotonicProgress(ratios) {
  return ratios.every((ratio, index) => (
    Number.isFinite(ratio) &&
    (index === 0 || ratio >= ratios[index - 1])
  ))
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function getCleanedTrackName(name) {
  const baseName = name || 'fixed-track'
  return baseName.endsWith('-cleaned') ? baseName : `${baseName}-cleaned`
}
