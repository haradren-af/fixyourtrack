import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const port = 4178
const url = `http://127.0.0.1:${port}/`
const browserPath = findBrowserExecutable()
const vitePath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const fixturePath = path.join(root, 'test', 'fixtures', 'browser-smoke.gpx')
const server = spawn(process.execPath, [vitePath, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: 'ignore',
})

let browser
try {
  await waitForServer(url)
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
  })
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.localStorage.setItem('fixyourtrack-language', 'en')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const exportButton = page.getByRole('button', { name: 'Export cleaned GPX' })
  assert(await exportButton.isDisabled(), 'Export must be disabled before a track is loaded.')

  await page.locator('input[type="file"]').setInputFiles(fixturePath)
  await page.getByText('Browser fixture', { exact: true }).waitFor()
  await page.locator('.profile-chart').first().waitFor()

  assert(await exportButton.isEnabled(), 'Export must be enabled after a valid track is loaded.')
  assert(await page.locator('.profile-chart').count() === 3, 'Expected altitude, speed, and heart-rate charts.')
  assert(await page.getByRole('region', { name: 'Map' }).isVisible(), 'Map must remain visible after upload.')

  await page.getByText('Applied repairs saved locally', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  const resumeButton = page.getByRole('button', { name: 'Resume draft' })
  await resumeButton.waitFor()
  await resumeButton.click()
  await page.getByText('Browser fixture', { exact: true }).waitFor()

  const repairNextButton = page.getByRole('button', { name: 'Repair next issue' })
  await repairNextButton.waitFor()
  await repairNextButton.click()
  const cancelRepairButton = page.getByRole('button', { name: 'Cancel middle repair' })
  await cancelRepairButton.waitFor()
  assert(await exportButton.isDisabled(), 'Export must be disabled while a repair is active.')
  assert(
    await page.locator('#route-profile option[value="driving"]').count() === 0,
    'Driving must not be available as a route profile.',
  )

  await page.locator('.map-pin-number').first().waitFor()
  const controlPointNumbers = await page.locator('.map-pin-number').allTextContents()
  assert(
    controlPointNumbers.includes('1') && controlPointNumbers.includes('2'),
    'Repair boundary points must be numbered in route order.',
  )

  const addDirectPointButton = page.getByRole('button', { name: 'Add direct trace point' })
  await addDirectPointButton.click()
  const mapCanvas = page.locator('.maplibregl-canvas')
  const mapBounds = await mapCanvas.boundingBox()
  assert(mapBounds, 'Map canvas must have visible bounds.')
  await mapCanvas.click({
    position: {
      x: Math.round(mapBounds.width * 0.55),
      y: Math.round(mapBounds.height * 0.55),
    },
  })

  const waypointCard = page.locator('.waypoint-card')
  assert(await waypointCard.count() === 0, 'Creating a waypoint must not open its details card.')

  await page.getByRole('button', { name: 'Finish manual tracing' }).click()
  await page.locator('.note-good').filter({ hasText: 'Suggested rebuild length' }).waitFor()
  const waypointMarker = page.locator('.map-marker[data-waypoint-id]')
  await waypointMarker.waitFor()
  const waypointBounds = await waypointMarker.boundingBox()
  const anchorBounds = await page.locator('.map-pin-anchor').boundingBox()
  assert(waypointBounds && anchorBounds, 'Repair controls must have visible bounds.')
  await page.mouse.move(
    Math.round((waypointBounds.x + waypointBounds.width / 2 + anchorBounds.x + anchorBounds.width / 2) / 2),
    Math.round((waypointBounds.y + waypointBounds.height / 2 + anchorBounds.y + anchorBounds.height / 2) / 2),
  )
  await page.locator('.route-insertion-preview-visible').waitFor()

  await waypointMarker.click()
  await waypointCard.waitFor()

  const dragStart = await waypointMarker.boundingBox()
  assert(dragStart, 'Waypoint marker must remain visible before dragging.')
  await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + dragStart.width / 2 + 30, dragStart.y + dragStart.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  await waypointCard.waitFor({ state: 'detached' })
  assert(await waypointCard.count() === 0, 'Dragging a waypoint must not open its details card.')

  await waypointMarker.click()
  await waypointCard.waitFor()
  assert(
    await waypointCard.getByText('Distance', { exact: true }).isVisible(),
    'Waypoint card must show route distance.',
  )
  assert(
    await waypointCard.getByText('Elevation', { exact: true }).isVisible(),
    'Waypoint card must show elevation.',
  )
  const offGridToggle = waypointCard.getByLabel('Set following segment as off-grid')
  assert(!(await offGridToggle.isChecked()), 'The segment after a manual point must initially resume road routing.')
  await offGridToggle.check()
  assert(await offGridToggle.isChecked(), 'Waypoint card must toggle the following segment to off-grid.')
  await waypointCard.getByRole('button', { name: 'Remove waypoint' }).click()
  await waypointCard.waitFor({ state: 'detached' })
  await page.getByText('Waypoint removed. The joined section now follows mapped roads.', { exact: true }).waitFor()

  await cancelRepairButton.click()
  assert(await exportButton.isEnabled(), 'Export must be enabled after the repair is cancelled.')

  const downloadPromise = page.waitForEvent('download')
  await exportButton.click()
  const download = await downloadPromise
  assert(download.suggestedFilename().endsWith('.gpx'), 'Export must produce a GPX file.')

  console.log('Browser smoke workflow passed.')
}
finally {
  await browser?.close()
  server.kill()
}

function findBrowserExecutable() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate))
  if (!executable) {
    throw new Error('No supported local Edge, Chrome, or Chromium browser was found.')
  }
  return executable
}

async function waitForServer(targetUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(targetUrl)
      if (response.ok) {
        return
      }
    }
    catch {
      // The preview server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Vite preview server did not start.')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
