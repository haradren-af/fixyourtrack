import { finalizeTrack, haversineDistance, isValidCoordinate } from './trackCore.js'

export function getEmergencyRecordingAnchors(samples, { startSampleIndex: start, endSampleIndex: end }) {
  const anchors = new Set()
  for (let index = start + 1; index <= end; index += 1) {
    const before = samples[index - 1]
    const after = samples[index]
    const seconds = (Date.parse(after?.time) - Date.parse(before?.time)) / 1000
    if (isValidCoordinate(before) && isValidCoordinate(after) && seconds > 0 && (seconds > 120 || after.segmentStart)) {
      if (index - 1 > start) anchors.add(index - 1)
      if (index < end) anchors.add(index)
    }
  }
  return [...anchors].sort((left, right) => left - right).map(index => ({ id: `recording-${index}`, lat: samples[index].lat, lon: samples[index].lon, manualPoint: false }))
}

export function getEmergencyLegModes(samples, range, anchors) {
  const controls = [{ id: 'anchor', index: range.startSampleIndex }, ...anchors.map(point => ({ id: point.id, index: Number(point.id.slice('recording-'.length)) })), { id: 'endpoint', index: range.endSampleIndex }]
  return Object.fromEntries(controls.slice(0, -1).filter((point, index) => {
    const next = samples[controls[index + 1].index]
    const seconds = (Date.parse(next.time) - Date.parse(samples[point.index].time)) / 1000
    return seconds <= 120 && !next.segmentStart
  }).map(point => [point.id, 'direct']))
}

// Only an explicit emergency repair may bridge an interval with no records.
// Keep all real records, including short recordings between two long gaps.
export function buildEmergencyRepairTrack(track, routeGeometry, range) {
  const { startSampleIndex: start, endSampleIndex: end } = range ?? {}
  if (!track || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= track.samples.length) {
    throw new Error('Invalid emergency repair range.')
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2 || !routeGeometry.every(isValidCoordinate)) {
    throw new Error('Invalid emergency repair route.')
  }
  const geometry = routeGeometry.map(point => ({ lat: point.lat, lon: point.lon }))
  geometry[0] = track.samples[start]
  geometry[geometry.length - 1] = track.samples[end]
  const cumulative = [0]
  for (let index = 1; index < geometry.length; index += 1) {
    cumulative.push(cumulative.at(-1) + haversineDistance(geometry[index - 1], geometry[index]))
  }
  const records = track.samples.slice(start, end + 1)
  const projections = records.map(sample => closestRoutePosition(sample, geometry, cumulative))
  const positions = projections.map((projection, index) => index === 0 ? 0 : index === records.length - 1 ? cumulative.at(-1) : projection?.position ?? null)
  if (positions.some((position, index) => index > 0 && position !== null && positions[index - 1] !== null && position < positions[index - 1] - 25)) {
    throw new Error('emergencyRouteOrder')
  }
  const result = [{ ...records[0], repairAccepted: true, emergencyRepair: true }]
  let filled = 0
  for (let index = 1; index < records.length; index += 1) {
    const before = records[index - 1]
    const after = records[index]
    const seconds = (Date.parse(after.time) - Date.parse(before.time)) / 1000
    const gap = isValidCoordinate(before) && isValidCoordinate(after) && Number.isFinite(seconds) && seconds > 0 && (seconds > 120 || after.segmentStart)
    if (gap) {
      // A drawn route must visit the surviving recording, without silently
      // inventing long straight connectors to it.
      if (projections[index - 1]?.distance > 100 || projections[index]?.distance > 100) {
        throw new Error('emergencyRouteMissesRecording')
      }
      if (positions[index] < positions[index - 1]) {
        throw new Error('emergencyRouteOrder')
      }
      const path = [before, ...geometry.filter((_, vertex) => cumulative[vertex] > positions[index - 1] && cumulative[vertex] < positions[index]), after]
      const lengths = [0]
      for (let vertex = 1; vertex < path.length; vertex += 1) lengths.push(lengths.at(-1) + haversineDistance(path[vertex - 1], path[vertex]))
      const total = lengths.at(-1)
      const startTime = Date.parse(before.time)
      for (let vertex = 1; vertex < path.length; vertex += 1) {
        const length = lengths[vertex] - lengths[vertex - 1]
        // Retain every route bend and keep both distance and time gaps small.
        const steps = Math.max(1, Math.ceil(length / 25), Math.ceil((total > 0 ? length / total : 1 / (path.length - 1)) * seconds / 60))
        if (result.length + steps + track.samples.length > 1_000_000) throw new Error('emergencyTooLarge')
        for (let step = 1; step <= steps; step += 1) {
          if (vertex === path.length - 1 && step === steps) continue
          const ratio = step / steps
          const progress = total > 0 ? (lengths[vertex - 1] + length * ratio) / total : (vertex - 1 + ratio) / (path.length - 1)
          result.push({
            lat: path[vertex - 1].lat + (path[vertex].lat - path[vertex - 1].lat) * ratio,
            lon: path[vertex - 1].lon + (path[vertex].lon - path[vertex - 1].lon) * ratio,
            time: new Date(startTime + progress * seconds * 1000).toISOString(),
            repairAccepted: true, emergencyRepair: true, reconstructed: true, routeDistance: true,
          })
        }
      }
      // A stationary gap still needs a marked sample to invalidate FIT totals.
      if (result.at(-1).time === before.time) {
        result.push({ lat: before.lat, lon: before.lon, time: new Date(startTime + seconds * 500).toISOString(), repairAccepted: true, emergencyRepair: true, reconstructed: true, routeDistance: true })
      }
      result.push({ ...after, segmentStart: false, repairAccepted: true, emergencyRepair: true, routeDistance: true })
      filled += 1
    } else {
      result.push({ ...after, repairAccepted: true, emergencyRepair: true })
    }
  }
  if (!filled) throw new Error('emergencyNoGaps')
  return finalizeTrack({
    ...track,
    name: track.name?.endsWith('-cleaned') ? track.name : `${track.name || 'fixed-track'}-cleaned`,
    samples: [...track.samples.slice(0, start), ...result, ...track.samples.slice(end + 1)],
  })
}

function closestRoutePosition(point, geometry, cumulative) {
  if (!isValidCoordinate(point)) return null
  let bestDistance = Infinity
  let position = 0
  const scale = Math.cos(point.lat * Math.PI / 180)
  for (let index = 1; index < geometry.length; index += 1) {
    const before = geometry[index - 1]
    const after = geometry[index]
    const dx = (after.lon - before.lon) * scale
    const dy = after.lat - before.lat
    const denominator = dx * dx + dy * dy
    const ratio = denominator ? Math.max(0, Math.min(1, (((point.lon - before.lon) * scale) * dx + (point.lat - before.lat) * dy) / denominator)) : 0
    const projected = { lat: before.lat + (after.lat - before.lat) * ratio, lon: before.lon + (after.lon - before.lon) * ratio }
    const distance = haversineDistance(point, projected)
    if (distance < bestDistance) {
      bestDistance = distance
      position = cumulative[index - 1] + (cumulative[index] - cumulative[index - 1]) * ratio
    }
  }
  return { position, distance: bestDistance }
}
