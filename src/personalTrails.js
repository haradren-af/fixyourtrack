// Personal observations, not an assertion of legal/public access.
import { getPolylineLength, haversineDistance } from './trackCore.js'

const metersPerDegree = 111320
const median = (values) => {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

export function buildPersonalNetwork(tracks, { mergeRadius = 9, sampleStep = 10 } = {}) {
  const first = tracks.flatMap((track) => track.samples.slice(0, 1)).find(valid)
  if (!first) throw new Error('No usable track coordinates')
  const scaleX = metersPerDegree * Math.cos(first.lat * Math.PI / 180)
  const nodes = []
  const buckets = new Map()
  const edges = new Map()
  let rejectedLinks = 0
  let rawPoints = 0
  const key = (x, y) => `${Math.floor(x / mergeRadius)},${Math.floor(y / mergeRadius)}`
  function nodeFor(x, y, dx, dy, trackId) {
    let nearest = null
    let distance = mergeRadius
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) {
      for (const id of buckets.get(key(x + i * mergeRadius, y + j * mergeRadius)) ?? []) {
        const node = nodes[id]
        // Opposite travel directions share a corridor; crossing corridors do not.
        if (Math.abs(node.dx * dx + node.dy * dy) < 0.85) continue
        const separation = Math.hypot(node.x - x, node.y - y)
        if (separation < distance) { nearest = id; distance = separation }
      }
    }
    if (nearest === null) {
      nearest = nodes.length
      nodes.push({ x, y, dx, dy, visits: new Map() })
      const cell = key(x, y)
      if (!buckets.has(cell)) buckets.set(cell, [])
      buckets.get(cell).push(nearest)
    }
    const visits = nodes[nearest].visits
    const accumulated = visits.get(trackId) ?? [0, 0, 0]
    accumulated[0] += x; accumulated[1] += y; accumulated[2] += 1
    visits.set(trackId, accumulated)
    return nearest
  }
  tracks.forEach((track, trackId) => {
    let previous = null
    let previousNode = null
    for (const point of track.samples) {
      rawPoints += 1
      if (!valid(point)) { previous = null; previousNode = null; continue }
      if (!previous || point.segmentStart) { previous = point; previousNode = null; continue }
      const x0 = (previous.lon - first.lon) * scaleX
      const y0 = (previous.lat - first.lat) * metersPerDegree
      const dx = (point.lon - previous.lon) * scaleX
      const dy = (point.lat - previous.lat) * metersPerDegree
      const distance = Math.hypot(dx, dy)
      const seconds = (Date.parse(point.time) - Date.parse(previous.time)) / 1000
      if (distance > 100 || (Number.isFinite(seconds) && (seconds > 120 || (distance > 15 && (seconds <= 0 || distance / seconds > 25))))) {
        rejectedLinks += 1; previous = point; previousNode = null; continue
      }
      // Do not let stationary GPS jitter dominate the representative line.
      if (distance < 3) continue
      const count = Math.ceil(distance / sampleStep)
      for (let step = 0; step <= count; step += 1) {
        const id = nodeFor(x0 + dx * step / count, y0 + dy * step / count, dx / distance, dy / distance, trackId)
        if (previousNode !== null && previousNode !== id) {
          const a = Math.min(previousNode, id), b = Math.max(previousNode, id)
          const edgeKey = `${a}:${b}`
          if (!edges.has(edgeKey)) edges.set(edgeKey, { a, b, visits: new Set() })
          edges.get(edgeKey).visits.add(trackId)
        }
        previousNode = id
      }
      previous = point
    }
  })
  const coordinates = nodes.map((node) => {
    const visits = [...node.visits.values()].map(([x, y, n]) => [x / n, y / n])
    const x = median(visits.map((p) => p[0])), y = median(visits.map((p) => p[1]))
    const spread = median(visits.map((p) => Math.hypot(p[0] - x, p[1] - y)))
    return [Number((first.lon + x / scaleX).toFixed(7)), Number((first.lat + y / metersPerDegree).toFixed(7)), visits.length, Number(spread.toFixed(1))]
  })
  const links = [...edges.values()].map(({ a, b, visits }) => [a, b, visits.size])
  return {
    version: 1, nodes: coordinates, edges: links,
    summary: { tracks: tracks.length, rawPoints, nodes: nodes.length, edges: links.length, repeatedEdges: links.filter((edge) => edge[2] >= 2).length, rejectedLinks, mergeRadius, sampleStep },
  }
}

function valid(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon) && Math.abs(point.lat) <= 85 && Math.abs(point.lon) <= 180
}

export function indexPersonalNetwork(network) {
  if (network?.version !== 1 || !Array.isArray(network.nodes) || !Array.isArray(network.edges) || network.nodes.length > 1000000 || network.edges.length > 2000000) throw new Error('Invalid personal network')
  const points = network.nodes.map(([lon, lat]) => ({ lat, lon }))
  if (!points.every(valid)) throw new Error('Invalid personal coordinates')
  const adjacency = Array.from({ length: points.length }, () => [])
  for (const [a, b, support] of network.edges) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || !points[a] || !points[b] || !Number.isFinite(support) || support < 1) throw new Error('Invalid personal edge')
    const length = haversineDistance(points[a], points[b])
    // Prefer repeated observations without allowing arbitrarily long detours.
    const cost = length * (support >= 2 ? 1 : 1.3)
    adjacency[a].push({ id: b, cost }); adjacency[b].push({ id: a, cost })
  }
  return { network, points, adjacency }
}

export function routePersonalNetwork(index, from, to, { snapMeters = 25, signal } = {}) {
  const { points, adjacency } = index
  const nearest = (point) => {
    let id = -1, distance = snapMeters
    for (let i = 0; i < points.length; i += 1) {
      if (!adjacency[i].length) continue
      const d = haversineDistance(point, points[i])
      if (d < distance) { id = i; distance = d }
    }
    return id
  }
  const start = nearest(from), end = nearest(to)
  if (start < 0 || end < 0) throw new Error('Place both controls within 25 m of a personal trail.')
  const distances = new Float64Array(points.length).fill(Infinity)
  const previous = new Int32Array(points.length).fill(-1)
  distances[start] = 0
  const heap = []
  const push = (value) => {
    heap.push(value)
    let i = heap.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= value[0]) break; heap[i] = heap[p]; i = p }
    heap[i] = value
  }
  const pop = () => {
    const root = heap[0], last = heap.pop()
    if (heap.length) {
      let i = 0
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child += 1
        if (heap[child][0] >= last[0]) break
        heap[i] = heap[child]; i = child
      }
      heap[i] = last
    }
    return root
  }
  push([0, start])
  while (heap.length) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const [cost, id] = pop()
    if (cost !== distances[id]) continue
    if (id === end) break
    for (const next of adjacency[id]) {
      const candidate = cost + next.cost
      if (candidate < distances[next.id]) { distances[next.id] = candidate; previous[next.id] = id; push([candidate, next.id]) }
    }
  }
  if (!Number.isFinite(distances[end])) throw new Error('No recorded connection between these personal trails.')
  const path = []
  for (let id = end; id !== -1; id = previous[id]) path.push(points[id])
  path.reverse()
  const geometry = [from, ...path, to].map(({ lat, lon }) => ({ lat, lon }))
  return { mode: 'routed', geometry, distanceMeters: getPolylineLength(geometry) }
}

export function personalNetworkGeoJson(network) {
  return { type: 'FeatureCollection', features: [1, 2].map((minimum) => ({
    type: 'Feature', properties: { repeated: minimum === 2 },
    geometry: { type: 'MultiLineString', coordinates: network.edges.filter((edge) => minimum === 2 ? edge[2] >= 2 : edge[2] === 1).map(([a, b]) => [network.nodes[a].slice(0, 2), network.nodes[b].slice(0, 2)]) },
  })) }
}
