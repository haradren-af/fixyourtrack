import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import FitParser from 'fit-file-parser'
import { DOMParser } from '@xmldom/xmldom'
import { parseGpxDocument } from '../src/gpx.js'
import { buildPersonalNetwork } from '../src/personalTrails.js'
import { haversineDistance } from '../src/trackCore.js'

export const defaultBikeHeatmapRoot = process.env.BIKE_HEATMAP_DATA_DIR || path.join(os.homedir(), 'Documents', 'BikeHeatmap')
export const personalTrailDirectory = path.resolve(import.meta.dirname, '..', '.local-trails')

export async function buildPersonalTrails(root = defaultBikeHeatmapRoot) {
  root = path.resolve(root)
  let catalogPath = path.join(root, '.cache', 'strava-archive', 'activities.json')
  try { await fs.access(catalogPath) } catch { catalogPath = path.join(root, 'track-archive', 'strava', 'catalog', 'activities.json') }
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  const key = (activity) => `${String(activity.source).startsWith('strava') ? 'strava' : activity.source}:${activity.id}`
  const deleted = new Set((catalog.deletedActivities ?? []).flatMap(({ activity }) => activity ? [activity, ...(activity.supersededActivities ?? [])].map(key) : []))
  const tracks = [], failures = [], seen = new Set(), sources = {}
  for (const activity of catalog.activities ?? []) {
    if (deleted.has(key(activity)) || !['Ride', 'Bike Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide'].includes(activity.type)) continue
    if (activity.type === 'VirtualRide') continue
    const fingerprint = activity.localFingerprint || key(activity)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    try {
      const loaded = await readActivity(root, activity)
      if (loaded.samples.length < 2) throw new Error('No geometry')
      tracks.push({ id: key(activity), samples: loaded.samples })
      sources[loaded.source] = (sources[loaded.source] ?? 0) + 1
    } catch (error) { failures.push({ id: key(activity), reason: error.message }) }
  }
  const network = buildPersonalNetwork(tracks)
  let networkMeters = 0, repeatedMeters = 0
  for (const [a, b, support] of network.edges) {
    const distance = haversineDistance({ lon: network.nodes[a][0], lat: network.nodes[a][1] }, { lon: network.nodes[b][0], lat: network.nodes[b][1] })
    networkMeters += distance
    if (support >= 2) repeatedMeters += distance
  }
  network.revision = crypto.createHash('sha256').update(JSON.stringify([network.nodes, network.edges])).digest('hex').slice(0, 16)
  network.generatedAt = new Date().toISOString()
  const activityTypes = catalog.activities.reduce((counts, activity) => ({ ...counts, [activity.type]: (counts[activity.type] ?? 0) + 1 }), {})
  network.summary = { ...network.summary, networkKm: Number((networkMeters / 1000).toFixed(1)), repeatedKm: Number((repeatedMeters / 1000).toFixed(1)), catalogTracks: catalog.activities.length, activityTypes, excludedOrFailed: catalog.activities.length - tracks.length, sources, failures }
  await fs.mkdir(personalTrailDirectory, { recursive: true })
  const output = path.join(personalTrailDirectory, 'network.json')
  await fs.writeFile(`${output}.tmp`, JSON.stringify(network))
  await fs.rename(`${output}.tmp`, output)
  await fs.writeFile(path.join(personalTrailDirectory, 'analysis.json'), JSON.stringify({ generatedAt: network.generatedAt, revision: network.revision, ...network.summary }, null, 2))
  await fs.writeFile(path.join(personalTrailDirectory, 'analysis.md'), `# Анализ BikeHeatmap\n\nОбновлено: ${network.generatedAt}\n\nВ каталоге: ${catalog.activities.length} записей. В велосипедной сети: ${tracks.length} поездок, ${network.summary.rawPoints} исходных GPS-точек.\n\nТипы записей:\n${Object.entries(activityTypes).map(([type, count]) => `- ${type}: ${count}`).join('\n')}\n\nПрочитано GPX: ${sources.gpx ?? 0}; FIT: ${sources.fit ?? 0}; упрощённых полилиний: ${sources.summaryPolyline ?? 0}. Ошибок чтения: ${failures.length}. Пешие и неизвестные типы не используются как свидетельство велосипедного проезда.\n\nПосле объединения: ${network.nodes.length} узлов, ${network.edges.length} связей. Суммарная длина рёбер графа: ${network.summary.networkKm} км; подтверждено несколькими поездками: ${network.summary.repeatedKm} км. Это длина графа, а не точная длина уникальных дорог: отдельные полосы и GPS-разброс могут оставаться разными линиями.\n\nИсключено скачков и временных разрывов: ${network.summary.rejectedLinks}.\n\nМетод: сближение до 9 м, совместимое направление, медиана позиций с одинаковым весом каждой поездки. Частые точки и стоянки не увеличивают количество подтверждений. Противоположные направления совместимы; пересечение под большим углом не создаёт поворот само по себе. Связи возникают только из последовательности записанных точек.\n\nОграничения: соседние параллельные пути ближе 9 м могут объединяться; широкие GPS-пучки могут оставаться разделёнными. Алгоритм не знает высоту мостов, ограждения и текущий доступ. Одиночные наблюдения показаны бледнее и имеют меньший приоритет при поиске пути. OSM не редактируется и сравнение на предмет отсутствующих дорог не выполняется: выбран режим локальной маршрутизации по собственным проездам.\n\nВ приложении: «Показать мои проезды» → «Использовать при исправлении». Опорные точки должны быть не дальше 25 м от сети. Начало и конец коротко соединяются с ближайшим узлом в этом допуске; разрывы между компонентами не соединяются. Обновление: «Обновить из BikeHeatmap».\n`)
  return network
}

async function readActivity(root, activity) {
  const filename = activity.archiveFilename
  if (filename) {
    const candidates = [
      path.resolve(root, filename),
      path.resolve(root, 'track-archive/strava/extracted', filename),
      path.resolve(root, 'track-archive/strava/extracted', filename.replace(/\.gz$/i, '')),
    ]
    for (const file of candidates) {
      if (!file.startsWith(`${root}${path.sep}`)) continue
      let bytes
      try { bytes = await fs.readFile(file) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (/\.gz$/i.test(file)) bytes = gunzipSync(bytes)
      if (/\.gpx(\.gz)?$/i.test(file)) {
        return { source: 'gpx', samples: parseGpxDocument(new DOMParser().parseFromString(bytes.toString('utf8'), 'application/xml')).samples }
      }
      if (/\.fit(\.gz)?$/i.test(file)) {
        const parsed = await new FitParser({ force: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm' }).parseAsync(new Uint8Array(bytes))
        return { source: 'fit', samples: (parsed.records ?? []).map((record) => ({ lat: record.position_lat, lon: record.position_long, time: record.timestamp ? new Date(record.timestamp).toISOString() : null })) }
      }
    }
  }
  // A summary-only route is retained as lower-detail evidence; long gaps are split.
  const samples = decodePolyline(activity.map?.summary_polyline || '')
  return { source: 'summaryPolyline', samples }
}

function decodePolyline(encoded) {
  let offset = 0, lat = 0, lon = 0
  const points = []
  function read() {
    let value = 0, shift = 0, byte
    do {
      if (offset >= encoded.length || shift > 30) throw new Error('Invalid polyline')
      byte = encoded.charCodeAt(offset++) - 63
      value |= (byte & 31) << shift; shift += 5
    } while (byte >= 32)
    return value & 1 ? ~(value >> 1) : value >> 1
  }
  while (offset < encoded.length) { lat += read(); lon += read(); points.push({ lat: lat / 1e5, lon: lon / 1e5 }) }
  return points
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const network = await buildPersonalTrails(process.argv[2] || defaultBikeHeatmapRoot)
  console.log(JSON.stringify(network.summary, null, 2))
}
