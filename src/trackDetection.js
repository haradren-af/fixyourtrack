import { haversineDistance } from './trackCore.js'

export function getSuspiciousSegments(points) {
  const detectedSegments = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    if (current.repairAccepted && next.repairAccepted) {
      continue
    }

    const distance = haversineDistance(current, next)
    const seconds = getSecondsBetween(current.time, next.time)
    const calcSpeedKmh = seconds > 0 ? (distance / seconds) * 3.6 : null
    const deviceSpeedKmh = maxSpeedKmh(current.speed, next.speed)
    const missingGpsSamples = Math.max(0, next.sampleIndex - current.sampleIndex - 1)
    const likelySignalLoss =
      missingGpsSamples > 0 ||
      (
        distance >= 120 &&
        (
          seconds === null ||
          seconds === 0 ||
          (seconds >= 30 && distance >= 120) ||
          (seconds >= 120 && distance >= 60) ||
          (calcSpeedKmh !== null && calcSpeedKmh > 42) ||
          (deviceSpeedKmh !== null && deviceSpeedKmh < 12 && distance > 180)
        )
      )

    if (likelySignalLoss) {
      const expanded = expandSuspiciousSegment(points, index, index + 1)
      detectedSegments.push({
        ...expanded,
        distance,
        seconds,
        calcSpeedKmh,
        deviceSpeedKmh,
        missingGpsSamples,
      })
    }
  }

  return mergeSuspiciousSegments(detectedSegments, points)
}

function expandSuspiciousSegment(points, startIndex, endIndex) {
  return {
    startIndex: findSignalContextBoundary(points, startIndex, -1),
    endIndex: findSignalContextBoundary(points, endIndex, 1),
  }
}

function findSignalContextBoundary(points, originIndex, direction) {
  const origin = points[originIndex]
  let boundaryIndex = originIndex
  let travelledDistance = 0

  for (let step = 1; step <= 15; step += 1) {
    const candidateIndex = originIndex + step * direction
    const previousIndex = candidateIndex - direction
    const candidate = points[candidateIndex]
    const previous = points[previousIndex]

    if (!candidate || !previous || candidate.repairAccepted) {
      break
    }

    const elapsedSeconds = getContextElapsedSeconds(candidate.time, origin.time)
    travelledDistance += haversineDistance(candidate, previous)
    if (elapsedSeconds > 20 || travelledDistance > 120) {
      break
    }

    boundaryIndex = candidateIndex
  }

  return boundaryIndex
}

function getContextElapsedSeconds(firstTime, secondTime) {
  if (!firstTime || !secondTime) {
    return 0
  }

  const firstMs = new Date(firstTime).getTime()
  const secondMs = new Date(secondTime).getTime()
  return Number.isFinite(firstMs) && Number.isFinite(secondMs)
    ? Math.abs(secondMs - firstMs) / 1000
    : 0
}

function mergeSuspiciousSegments(segments, points) {
  const merged = []

  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (!previous || segment.startIndex > previous.endIndex) {
      merged.push({
        ...segment,
        startSampleIndex: points[segment.startIndex].sampleIndex,
        endSampleIndex: points[segment.endIndex].sampleIndex,
      })
      continue
    }

    previous.endIndex = Math.max(previous.endIndex, segment.endIndex)
    previous.endSampleIndex = points[previous.endIndex].sampleIndex
    previous.distance = Math.max(previous.distance, segment.distance)
    previous.seconds = Math.max(previous.seconds ?? 0, segment.seconds ?? 0)
    previous.calcSpeedKmh = Math.max(previous.calcSpeedKmh ?? 0, segment.calcSpeedKmh ?? 0)
    previous.deviceSpeedKmh = Math.max(previous.deviceSpeedKmh ?? 0, segment.deviceSpeedKmh ?? 0)
    previous.missingGpsSamples = Math.max(previous.missingGpsSamples ?? 0, segment.missingGpsSamples ?? 0)
  }

  return merged
}

function maxSpeedKmh(firstSpeed, secondSpeed) {
  const values = [firstSpeed, secondSpeed].filter(Number.isFinite)
  if (!values.length) {
    return null
  }

  return Math.max(...values) * 3.6
}

function getSecondsBetween(firstTime, secondTime) {
  if (!firstTime || !secondTime) {
    return null
  }

  const firstMs = new Date(firstTime).getTime()
  const secondMs = new Date(secondTime).getTime()

  if (!Number.isFinite(firstMs) || !Number.isFinite(secondMs)) {
    return null
  }

  return Math.max(0, (secondMs - firstMs) / 1000)
}
