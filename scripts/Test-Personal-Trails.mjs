import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { indexPersonalNetwork, routePersonalNetwork } from '../src/personalTrails.js'
import { haversineDistance } from '../src/trackCore.js'

const root = path.resolve(import.meta.dirname, '..')
const network = JSON.parse(await fs.readFile(path.join(root, '.local-trails/network.json'), 'utf8'))
const index = indexPersonalNetwork(network)
const from = index.points[network.nodes.findIndex((point) => point[2] >= 5)]
let route
for (let n = 0; n < index.points.length; n += 20) {
  const distance = haversineDistance(from, index.points[n])
  if (distance < 500 || distance > 1000) continue
  try { route = routePersonalNetwork(index, from, index.points[n]); if (route.distanceMeters < 1800) break; route = null } catch { /* disconnected evidence */ }
}
assert.ok(route, 'The real archive must provide a local route of at least 500 m')
const to = route.geometry.at(-1)
const broken = [from, { lat: from.lat + 0.01, lon: from.lon }, { lat: to.lat + 0.01, lon: to.lon }, to]
const xml = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Personal repair validation</name><trkseg>${broken.map((p, n) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(Date.UTC(2026, 8, 23) + n * 10000).toISOString()}</time><extensions><hr>125</hr></extensions></trkpt>`).join('')}</trkseg></trk></gpx>`
const port = 4182
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let browser
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start')), 15000)
    server.stdout.on('data', (chunk) => { if (chunk.toString().includes(String(port))) { clearTimeout(timer); resolve() } })
    server.on('exit', () => { clearTimeout(timer); reject(new Error('Preview exited')) })
  })
  const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('fixyourtrack-language', 'en'))
  let publicRouteRequests = 0
  await page.route(/brouter|routing\.openstreetmap|router\.project-osrm/, (request) => { publicRouteRequests += 1; return request.abort() })
  await page.goto(`http://127.0.0.1:${port}`)
  await page.getByRole('button', { name: 'Show my trails', exact: true }).click()
  await page.getByRole('button', { name: 'Use for route repairs', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Update from BikeHeatmap', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Update from BikeHeatmap' && !button.disabled), { }, { timeout: 90000 })
  assert.equal(await page.locator('.personal-trails-panel [role="alert"]').count(), 0, 'Refresh from the live archive must succeed')
  await page.getByRole('button', { name: 'Use for route repairs', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'personal-test.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) })
  await page.getByRole('button', { name: 'Repair next issue', exact: true }).click()
  await page.locator('.note-good').filter({ hasText: 'Suggested rebuild length' }).waitFor()
  assert.equal(await page.locator('#route-profile').inputValue(), 'personal')
  const apply = page.getByRole('button', { name: 'Apply middle segment', exact: true })
  await apply.click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export cleaned GPX', exact: true }).click()
  const download = await downloadPromise
  const exported = await fs.readFile(await download.path(), 'utf8')
  assert.ok(exported.includes('<gpxtpx:hr>125</gpxtpx:hr>'))
  assert.ok(exported.includes('2026-09-23T00:00:10.000Z'))
  const exportedCoordinates = [...exported.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((match) => ({ lat: Number(match[1]), lon: Number(match[2]) }))
  assert.equal(exportedCoordinates.length, 4)
  assert.ok(haversineDistance(exportedCoordinates[1], broken[1]) > 500, 'Corrupted geometry must be replaced')
  assert.ok(Math.min(...route.geometry.map((point) => haversineDistance(point, exportedCoordinates[1]))) < 12, 'Repaired samples must follow the personal network')
  assert.equal(publicRouteRequests, 0, 'Personal mode must stay local')
  await page.getByRole('button', { name: 'Hide my trails', exact: true }).scrollIntoViewIfNeeded()
  await page.locator('.map[data-map-ready="true"]').waitFor()
  await page.waitForTimeout(2000)
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'artifacts/personal-trails-repair.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ tracks: network.summary.tracks, routeMeters: Math.round(route.distanceMeters), geometryPoints: route.geometry.length, publicRouteRequests, result: 'Real archive -> personal route -> repair -> GPX passed' }, null, 2))
} finally { await browser?.close(); server.kill() }
