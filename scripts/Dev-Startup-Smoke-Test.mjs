import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const port = 4179
const externalUrl = readExternalUrl(process.argv.slice(2))
const url = externalUrl ?? `http://127.0.0.1:${port}/`
const vitePath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const browserPath = findBrowserExecutable()
const server = externalUrl
  ? null
  : spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      stdio: 'ignore',
    })

let browser
try {
  await waitForServer(url)
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: headlessWebGlArgs(),
  })
  const page = await browser.newPage()
  const clientErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') clientErrors.push(message.text())
  })
  page.on('pageerror', (error) => clientErrors.push(error.message))

  const response = await page.goto(url, { waitUntil: 'networkidle' })
  assert(response?.status() === 200, `Development server returned HTTP ${response?.status()}.`)
  assert(await page.locator('#root > *').count(), 'React did not mount into #root.')
  assert(await page.locator('body').innerText(), 'The application rendered no visible text.')
  assert(clientErrors.length === 0, `Development page reported client errors:\n${clientErrors.join('\n')}`)
  console.log('Development startup smoke test passed.')
} finally {
  await browser?.close()
  server?.kill()
}

async function waitForServer(target) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) throw new Error(`Development server exited with code ${server.exitCode}.`)
    try {
      const response = await fetch(target)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Development server did not become ready.')
}

function readExternalUrl(args) {
  const urlIndex = args.indexOf('--url')
  if (urlIndex < 0) return null
  if (!args[urlIndex + 1] || args.includes('--url', urlIndex + 1)) {
    throw new Error('--url requires an HTTP URL.')
  }

  const parsed = new URL(args[urlIndex + 1])
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('--url requires an HTTP URL.')
  }
  return parsed.href
}

function findBrowserExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const executable = candidates.find((candidate) => fs.existsSync(candidate))
  if (!executable) throw new Error('Chrome, Edge, or Chromium is required for the development startup smoke test.')
  return executable
}

function headlessWebGlArgs() {
  // GitHub's GPU-less Windows runners need an explicit software WebGL backend.
  return [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
