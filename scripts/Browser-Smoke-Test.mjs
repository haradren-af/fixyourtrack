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
