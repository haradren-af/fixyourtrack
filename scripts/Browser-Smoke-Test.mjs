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
const server = spawn(process.execPath, [vitePath, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
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
  const primaryContext = await browser.newContext()
  const page = await primaryContext.newPage()
  const clientErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') clientErrors.push(message.text())
  })
  page.on('pageerror', (error) => clientErrors.push(error.message))
  const routingFixture = await installRoutingFixture(page)
  await installMapTileFixture(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('fixyourtrack-language', 'en')
    window.localStorage.setItem('fixyourtrack-theme', 'dark')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await assertHeaderLayout(page, {
    label: 'English empty repair header at desktop width',
    compactDesktop: true,
  })
  assert(
    !(await page.evaluate(() => performance.getEntriesByType('resource')
      .some(({ name }) => name.includes('CreateRouteWorkspace-')))),
    'Repair mode must not eagerly load the Create Route workspace bundle.',
  )

  const exportButton = page.getByRole('button', { name: 'Export cleaned GPX' })
  assert(await exportButton.isDisabled(), 'Export must be disabled before a track is loaded.')
  const instructionButton = page.locator('.instruction-button')
  assert(await instructionButton.isVisible(), 'Instruction button must be visible before loading a track.')
  assert((await instructionButton.textContent())?.trim() === 'Instructions', 'Instruction button must match English UI.')
  await instructionButton.click()
  const instructionSheet = page.locator('.instruction-sheet')
  await instructionSheet.waitFor()
  assert(
    await instructionSheet.evaluate((element) => document.activeElement === element),
    'Opening instructions must move keyboard focus into the modal.',
  )
  assert(await page.getByText('How to repair a track', { exact: true }).isVisible(), 'Instruction sheet must include English title.')
  assert(
    await page.getByText('If a piece is missing at the start or end', { exact: true }).isVisible(),
    'Instruction sheet must describe the start/end repair scenario.',
  )
  assert(
    await page.getByText('Как чинить трек', { exact: true }).count() === 0,
    'English instruction sheet must not show Russian content.',
  )
  await page.keyboard.press('Shift+Tab')
  assert(
    await page.locator('.instruction-close').evaluate((element) => document.activeElement === element),
    'Keyboard focus must stay inside the instructions modal.',
  )
  await page.keyboard.press('Escape')
  await instructionSheet.waitFor({ state: 'detached' })
  assert(
    await instructionButton.evaluate((element) => document.activeElement === element),
    'Closing instructions must restore focus to the trigger.',
  )

  await page.locator('.language-picker select').selectOption('ru')
  assert(await page.locator('html').getAttribute('lang') === 'ru', 'Russian UI must declare the Russian document language.')
  assert((await instructionButton.textContent())?.trim() === 'Инструкция', 'Instruction button must match Russian UI.')
  await instructionButton.click()
  await instructionSheet.waitFor()
  assert(await page.getByText('Как чинить трек', { exact: true }).isVisible(), 'Instruction sheet must include Russian title.')
  assert(
    await page.getByText('Если потерян кусок в начале или в конце', { exact: true }).isVisible(),
    'Instruction sheet must describe the Russian start/end repair scenario.',
  )
  assert(
    await page.getByText('How to repair a track', { exact: true }).count() === 0,
    'Russian instruction sheet must not show English content.',
  )
  await page.mouse.click(8, 8)
  await instructionSheet.waitFor({ state: 'detached' })
  await page.locator('.language-picker select').selectOption('en')
  assert(await page.locator('html').getAttribute('lang') === 'en', 'English UI must declare the English document language.')

  const createMode = page.getByRole('radio', { name: 'Create route' })
  const repairMode = page.getByRole('radio', { name: 'Repair track' })
  await createMode.check()
  await page.getByRole('heading', { name: 'Route summary' }).waitFor()
  assert(
    await page.evaluate(() => performance.getEntriesByType('resource')
      .some(({ name }) => name.includes('CreateRouteWorkspace-'))),
    'Opening Create Route must load its workspace bundle on demand.',
  )
  await assertHeaderLayout(page, {
    label: 'English Create header at desktop width',
    compactDesktop: true,
  })
  assert(await page.getByRole('textbox', { name: 'Route name' }).inputValue() === 'New route', 'Create mode must start with a named route document.')
  const createMap = page.locator('.create-map-panel .map[data-map-ready="true"]')
  await createMap.waitFor()
  await page.waitForTimeout(200)
  const createMapBounds = await createMap.boundingBox()
  assert(createMapBounds, 'Create mode map must have visible bounds.')
  await page.mouse.click(
    Math.round(createMapBounds.x + createMapBounds.width * 0.42),
    Math.round(createMapBounds.y + createMapBounds.height * 0.55),
  )
  await page.locator('.create-map-panel .map-mode-banner')
    .filter({ hasText: 'Click the map to place the finish. Press Escape to cancel.' })
    .waitFor()
  await page.mouse.click(
    Math.round(createMapBounds.x + createMapBounds.width * 0.62),
    Math.round(createMapBounds.y + createMapBounds.height * 0.43),
  )
  await page.locator('.route-status-ready').waitFor()
  await page.waitForTimeout(250)
  assert(
    routingFixture.getRequestCount() === 1,
    'A continuous road route must use one batched provider request and must not rebuild in a status loop.',
  )
  assert(await page.locator('.route-point-item').count() === 2, 'Start and finish must create two ordered route controls.')
  const initialRouteControlIds = await page.locator('.route-point-heading code').allTextContents()
  const routeNameInput = page.getByRole('textbox', { name: 'Route name' })
  await routeNameInput.fill('Morning Ride')
  await routeNameInput.press('Tab')
  await page.getByRole('button', { name: 'Reverse route' }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Route summary' }).waitFor()
  await page.locator('.route-status-ready').waitFor()
  assert(await routeNameInput.inputValue() === 'Morning Ride', 'A multi-word route name must survive immediate reload.')
  assert(
    JSON.stringify(await page.locator('.route-point-heading code').allTextContents()) ===
      JSON.stringify([...initialRouteControlIds].reverse()),
    'The latest structural route edit must survive immediate reload.',
  )
  await page.getByText('Route draft saved locally', { exact: true }).waitFor()
  await page.unroute('https://brouter.de/brouter?**')
  let offlineRoutingRequests = 0
  await page.route('https://brouter.de/brouter?**', async (route) => {
    offlineRoutingRequests += 1
    await route.abort()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Route summary' }).waitFor()
  assert(
    await page.getByRole('button', { name: 'Export planned route' }).isEnabled(),
    'A restored resolved route draft must remain exportable without rebuilding it online.',
  )
  assert(offlineRoutingRequests === 0, 'Restoring a matching resolved route must not contact a routing provider.')
  await page.unroute('https://brouter.de/brouter?**')
  await installRoutingFixture(page)
  const plannedExportButton = page.getByRole('button', { name: 'Export planned route' })
  assert(await plannedExportButton.isEnabled(), 'Planned-route export must enable only after routing succeeds.')
  const plannedDownloadPromise = page.waitForEvent('download')
  await plannedExportButton.click()
  const plannedDownload = await plannedDownloadPromise
  const plannedStream = await plannedDownload.createReadStream()
  const plannedChunks = []
  for await (const chunk of plannedStream) {
    plannedChunks.push(chunk)
  }
  const plannedGpx = Buffer.concat(plannedChunks).toString('utf8')
  assert(plannedGpx.includes('<rte>') && plannedGpx.includes('<rtept '), 'Planned export must use GPX route semantics.')
  assert(!plannedGpx.includes('<trk>') && !plannedGpx.includes('<time>'), 'Planned export must not invent activity or time data.')

  await page.getByRole('button', { name: 'Save to projects' }).click()
  await page.getByText('Project saved', { exact: true }).waitFor()
  const projectsButton = page.getByRole('button', { name: 'Projects' })
  await projectsButton.click()
  const projectDialog = page.getByRole('dialog', { name: 'Route project library' })
  await projectDialog.waitFor()
  const projectDialogContrast = await projectDialog.evaluate((dialog) => {
    const parseColor = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number)
    const luminance = (value) => {
      const [red, green, blue] = parseColor(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const background = luminance(getComputedStyle(dialog).backgroundColor)
    const foreground = luminance(getComputedStyle(dialog.querySelector('h2')).color)
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
  })
  assert(projectDialogContrast >= 4.5, 'The portalled Projects dialog must keep readable contrast in dark mode.')
  assert(await page.locator('.hero').getAttribute('inert') !== null, 'The editor background must be inert while Projects is open.')
  assert(
    await projectDialog.getByRole('searchbox').evaluate((element) => document.activeElement === element),
    'Opening Projects must focus its search field.',
  )
  await projectDialog.getByRole('button', { name: 'Rename Morning Ride' }).click()
  const projectNameInput = projectDialog.getByRole('textbox', { name: 'New name for Morning Ride' })
  await projectNameInput.fill('Commercial route')
  await projectDialog.getByRole('button', { name: 'Save name' }).click()
  await projectDialog.getByText('Commercial route', { exact: true }).waitFor()
  await projectDialog.getByRole('button', { name: 'Archive Commercial route' }).click()
  await projectDialog.getByRole('button', { name: 'Archive route' }).click()
  await projectDialog.getByRole('tab', { name: /Archived route projects/ }).click()
  await projectDialog.getByRole('button', { name: 'Restore Commercial route' }).click()
  await projectDialog.getByRole('tab', { name: /Active route projects/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await projectDialog.getByRole('button', { name: 'Open Commercial route' }).click()
  await projectDialog.waitFor({ state: 'detached' })
  assert(await page.locator('.route-point-item').count() === 2, 'Project archive/restore/open must preserve the route document.')
  assert(
    await projectsButton.evaluate((element) => document.activeElement === element),
    'Closing Projects must restore focus to its trigger.',
  )
  await repairMode.check()
  await waitForRouteDraftLockRelease(page)

  const lockProbePage = await page.context().newPage()
  const lockProbeErrors = []
  lockProbePage.on('console', (message) => {
    if (message.type() === 'error') lockProbeErrors.push(message.text())
  })
  lockProbePage.on('pageerror', (error) => lockProbeErrors.push(error.message))
  await installRoutingFixture(lockProbePage)
  await installMapTileFixture(lockProbePage)
  await lockProbePage.goto(url, { waitUntil: 'domcontentloaded' })
  await lockProbePage.getByRole('radio', { name: 'Create route' }).check()
  await lockProbePage.getByRole('heading', { name: 'Route summary' }).waitFor()
  assert(
    await lockProbePage.getByText('Create Route is already open in another app window. Close it there, then retry.', { exact: true }).count() === 0,
    'An inactive retained Create workspace must release its writer lock for another tab.',
  )
  assert(lockProbeErrors.length === 0, `The lock-reacquisition probe reported client errors:\n${lockProbeErrors.join('\n')}`)
  await lockProbePage.getByRole('radio', { name: 'Repair track' }).check()
  await waitForRouteDraftLockRelease(lockProbePage)
  await lockProbePage.close()
  await waitForRouteDraftLockRelease(page)

  await page.locator('input[type="file"]').setInputFiles(fixturePath)
  await page.getByText('Browser fixture', { exact: true }).waitFor()
  await page.locator('.profile-chart').first().waitFor()

  assert(await exportButton.isEnabled(), 'Export must be enabled after a valid track is loaded.')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('<gpx><trk>'),
  })
  await page.locator('.hero-error-text').waitFor()
  await assertHeaderLayout(page, {
    label: 'English repair error header at desktop width',
    compactDesktop: true,
    expectError: true,
  })
  assert(
    await page.getByText('Browser fixture', { exact: true }).isVisible(),
    'A failed replacement upload must preserve the currently loaded track.',
  )
  assert(await exportButton.isEnabled(), 'A failed replacement upload must not disable export for the current track.')
  assert(await page.locator('.profile-chart').count() === 3, 'Expected altitude, speed, and heart-rate charts.')
  assert(await page.getByRole('region', { name: 'Map' }).isVisible(), 'Map must remain visible after upload.')

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('input[type="file"]').setInputFiles(fixturePath)
  await page.locator('.hero-feedback .draft-saved').waitFor()
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

  await createMode.check()
  await page.getByRole('heading', { name: 'Route summary' }).waitFor()
  assert(await page.locator('.route-point-item').count() === 2, 'Switching modes and reloading must preserve the independent Create draft.')
  await repairMode.check()
  assert(await exportButton.isDisabled(), 'Returning to Repair must restore the active repair and its export guard.')

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

  const popupBounds = await waypointCard.boundingBox()
  const viewport = page.viewportSize()
  assert(
    popupBounds && viewport &&
      popupBounds.x >= 0 && popupBounds.y >= 0 &&
      popupBounds.x + popupBounds.width <= viewport.width &&
      popupBounds.y + popupBounds.height <= viewport.height,
    `Waypoint details must stay inside the visible window: ${JSON.stringify({ popupBounds, viewport })}`,
  )
  const waypointCountBeforeOutsideClick = await waypointMarker.count()
  await mapCanvas.click({
    position: {
      x: Math.round(mapBounds.width * 0.85),
      y: Math.round(mapBounds.height * 0.5),
    },
  })
  await waypointCard.waitFor({ state: 'detached' })
  assert(
    await waypointMarker.count() === waypointCountBeforeOutsideClick,
    'Closing waypoint details from the map must not add or remove route points.',
  )
  assert(
    await page.locator('.map-marker-active[data-waypoint-id]').count() === 0,
    'Clicking outside waypoint details must clear the active waypoint state.',
  )

  await waypointMarker.click()
  await waypointCard.waitFor()

  await page.unroute('https://brouter.de/brouter?**')
  await page.route('https://brouter.de/brouter?**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://routing.openstreetmap.de/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  const dragStart = await waypointMarker.boundingBox()
  assert(dragStart, 'Waypoint marker must remain visible before dragging.')
  await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + dragStart.width / 2 + 30, dragStart.y + dragStart.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  await waypointCard.waitFor({ state: 'detached' })
  assert(await waypointCard.count() === 0, 'Dragging a waypoint must not open its details card.')
  await page.locator('.note-danger').waitFor()
  const failedWaypointBounds = await waypointMarker.boundingBox()
  const failedAnchorBounds = await page.locator('.map-pin-anchor').boundingBox()
  assert(failedWaypointBounds && failedAnchorBounds, 'A routing failure must keep every route control visible.')
  await page.mouse.move(
    Math.round((failedWaypointBounds.x + failedWaypointBounds.width / 2 + failedAnchorBounds.x + failedAnchorBounds.width / 2) / 2),
    Math.round((failedWaypointBounds.y + failedWaypointBounds.height / 2 + failedAnchorBounds.y + failedAnchorBounds.height / 2) / 2),
  )
  await page.locator('.route-insertion-preview-visible').waitFor()
  await page.unroute('https://brouter.de/brouter?**')
  await page.unroute('https://routing.openstreetmap.de/**')
  await installRoutingFixture(page)

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
  const incomingOffGridToggle = waypointCard.getByLabel('Set previous segment as off-grid')
  const outgoingOffGridToggle = waypointCard.getByLabel('Set following segment as off-grid')
  assert(await incomingOffGridToggle.isChecked(), 'The segment before a manual point must stay off-grid.')
  assert(!(await outgoingOffGridToggle.isChecked()), 'The segment after a manual point must initially resume road routing.')
  await outgoingOffGridToggle.check()
  assert(await outgoingOffGridToggle.isChecked(), 'Waypoint card must toggle the following segment to off-grid.')
  await waypointCard.getByRole('button', { name: 'Remove waypoint' }).click()
  await waypointCard.waitFor({ state: 'detached' })
  await page.getByText('Waypoint removed. The joined section now follows mapped roads.', { exact: true }).waitFor()

  await page.locator('.note-good').filter({ hasText: 'Suggested rebuild length' }).waitFor()
  await page.getByRole('button', { name: 'Apply middle segment' }).click()

  const originalTrackToggle = page.getByRole('button', { name: 'Original', exact: true })
  await originalTrackToggle.waitFor()
  assert(await exportButton.isEnabled(), 'Export must be enabled after the repair is applied.')
  const repairMap = page.locator('.map-panel .map')
  assert(await originalTrackToggle.getAttribute('aria-pressed') === 'false', 'Original track comparison must default to off.')
  assert(await repairMap.getAttribute('data-source-track-visible') === 'false', 'Applied repairs must hide the source track.')
  await originalTrackToggle.click()
  assert(await repairMap.getAttribute('data-source-track-visible') === 'true', 'Original track comparison must be explicitly available.')
  await originalTrackToggle.click()
  assert(await repairMap.getAttribute('data-source-track-visible') === 'false', 'Original track comparison must turn off again.')

  const downloadPromise = page.waitForEvent('download')
  await exportButton.click()
  const download = await downloadPromise
  assert(download.suggestedFilename().endsWith('.gpx'), 'Export must produce a GPX file.')

  await page.locator('.hero-feedback .draft-saved').waitFor()
  await page.locator('.language-picker select').selectOption('ru')
  await page.setViewportSize({ width: 1366, height: 768 })
  await assertHeaderLayout(page, {
    label: 'Russian loaded and saved repair header at desktop width',
    compactDesktop: true,
    expectedAuxiliary: 'draft-saved',
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.draft-card').waitFor()
  await assertHeaderLayout(page, {
    label: 'Russian draft-recovery header at desktop width',
    compactDesktop: true,
    expectedAuxiliary: 'draft-card',
    expectNotice: false,
  })

  await page.setViewportSize({ width: 375, height: 667 })
  await page.locator('.language-picker select').selectOption('ru')
  await assertHeaderLayout(page, {
    label: 'Russian draft-recovery header at mobile width',
    expectedAuxiliary: 'draft-card',
    expectNotice: false,
    mobile: true,
  })
  await page.locator('.draft-card .primary-button').click()
  await page.locator('.hero-feedback .draft-saved').waitFor()
  await assertHeaderLayout(page, {
    label: 'Russian loaded and saved repair header at mobile width',
    expectedAuxiliary: 'draft-saved',
    mobile: true,
  })
  await page.locator('.language-picker select').selectOption('en')
  const panelToggleBounds = await page.locator('.panel-toggle').first().boundingBox()
  const zoomButtonBounds = await page.getByRole('button', { name: 'Zoom in' }).boundingBox()
  assert(
    panelToggleBounds?.width >= 44 && panelToggleBounds?.height >= 44,
    'Panel controls must provide a 44px mobile touch target.',
  )
  assert(
    zoomButtonBounds?.width >= 44 && zoomButtonBounds?.height >= 44,
    'Map controls must provide a 44px mobile touch target.',
  )

  await createMode.check()
  await page.getByRole('heading', { name: 'Route summary' }).waitFor()
  await assertHeaderLayout(page, {
    label: 'English Create header at mobile width',
    mobile: true,
  })
  const createActionBounds = await page.locator('.create-sidebar > .panel').nth(1).boundingBox()
  const createMapPanelBounds = await page.locator('.create-map-panel').boundingBox()
  const createLayerButtonBounds = await page.locator('.create-map-panel').getByRole('button', { name: 'Satellite' }).boundingBox()
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'Create mode must not introduce horizontal scrolling at the mobile breakpoint.',
  )
  assert(
    createActionBounds && createMapPanelBounds && createMapPanelBounds.y - (createActionBounds.y + createActionBounds.height) < 60,
    'Create actions and the map must remain adjacent on mobile.',
  )
  assert(
    createLayerButtonBounds?.height >= 44,
    'Create map-layer controls must provide a 44px mobile touch target.',
  )
  const attributionButton = page.locator('.create-map-panel .maplibregl-ctrl-attrib-button')
  await attributionButton.waitFor()
  const attributionBounds = await attributionButton.boundingBox()
  assert(
    attributionBounds?.width >= 44 && attributionBounds?.height >= 44,
    'Compact map attribution must provide a 44px mobile touch target.',
  )
  await attributionButton.click()
  assert(
    await page.locator('.create-map-panel a[href*="openstreetmap.org/copyright"]').count() > 0,
    'OpenStreetMap attribution must link to the copyright page.',
  )

  await page.getByRole('button', { name: 'Projects' }).click()
  const mobileProjectDialog = page.getByRole('dialog', { name: 'Route project library' })
  await mobileProjectDialog.waitFor()
  assert(
    await mobileProjectDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    'The Projects dialog must not overflow horizontally at 375px.',
  )
  assert(
    await mobileProjectDialog.locator('button, input, select').evaluateAll((elements) => elements
      .filter((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
      .every((element) => element.getBoundingClientRect().height >= 44)),
    'Every visible Projects control must provide a 44px mobile touch target.',
  )
  await mobileProjectDialog.getByRole('button', { name: 'Close route project library' }).click()
  await mobileProjectDialog.waitFor({ state: 'detached' })
  await repairMode.check()

  const storagePage = await browser.newPage()
  await storagePage.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Storage blocked', 'SecurityError')
    }
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage blocked', 'SecurityError')
    }
  })
  await storagePage.goto(url, { waitUntil: 'domcontentloaded' })
  assert(
    await storagePage.getByRole('heading', { level: 1 }).isVisible(),
    'The application must remain usable when browser preference storage is blocked.',
  )
  await storagePage.close()

  const protectedDraftContext = await browser.newContext()
  const protectedDraftPage = await protectedDraftContext.newPage()
  await installMapTileFixture(protectedDraftPage)
  await protectedDraftPage.addInitScript(() => {
    window.localStorage.setItem('fixyourtrack-language', 'en')
  })
  await protectedDraftPage.goto(url, { waitUntil: 'domcontentloaded' })
  await protectedDraftPage.evaluate(() => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fixyourtrack', 2)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('repair-drafts', 'readwrite')
      transaction.objectStore('repair-drafts').put({ id: 'active', schemaVersion: 99 })
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  }))
  await protectedDraftPage.reload({ waitUntil: 'domcontentloaded' })
  await protectedDraftPage.getByText(
    'The local draft needs a newer FixYourTrack version and was preserved. Load another track only to replace it.',
    { exact: true },
  ).waitFor()
  let replacementPrompt = ''
  protectedDraftPage.once('dialog', async (dialog) => {
    replacementPrompt = dialog.message()
    await dialog.accept()
  })
  await protectedDraftPage.locator('input[type="file"]').setInputFiles(fixturePath)
  await protectedDraftPage.getByText('Browser fixture', { exact: true }).waitFor()
  await protectedDraftPage.locator('.hero-feedback .draft-saved').waitFor()
  assert(
    replacementPrompt.includes('permanently replace the preserved local draft'),
    'Replacing a future-version repair draft must require explicit confirmation.',
  )
  const replacementRecord = await protectedDraftPage.evaluate(() => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fixyourtrack', 2)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('repair-drafts', 'readonly')
      const getRequest = transaction.objectStore('repair-drafts').get('active')
      transaction.oncomplete = () => {
        database.close()
        resolve(getRequest.result)
      }
      transaction.onerror = () => reject(transaction.error)
    }
  }))
  assert(
    replacementRecord?.schemaVersion === 3 && replacementRecord?.sourceTrack?.name === 'Browser fixture',
    'A confirmed valid upload must atomically replace the preserved future-version draft.',
  )
  await protectedDraftContext.close()

  const unavailableDraftContext = await browser.newContext()
  const unavailableDraftPage = await unavailableDraftContext.newPage()
  await installMapTileFixture(unavailableDraftPage)
  await unavailableDraftPage.addInitScript(() => {
    window.localStorage.setItem('fixyourtrack-language', 'en')
    IDBFactory.prototype.open = () => {
      throw new DOMException('Database unavailable', 'InvalidStateError')
    }
  })
  await unavailableDraftPage.goto(url, { waitUntil: 'domcontentloaded' })
  const unavailableWarning = unavailableDraftPage.getByText(
    'Local draft storage is unavailable. This track will not be autosaved; export GPX before closing.',
    { exact: true },
  )
  await unavailableWarning.waitFor()
  await unavailableDraftPage.locator('input[type="file"]').setInputFiles(fixturePath)
  await unavailableDraftPage.getByText('Browser fixture', { exact: true }).waitFor()
  await unavailableDraftPage.waitForTimeout(800)
  assert(await unavailableWarning.isVisible(), 'An unavailable draft database must keep its warning after a track is loaded.')
  assert(
    await unavailableDraftPage.locator('.hero-feedback .draft-saved').count() === 0,
    'An unavailable draft database must never claim that the loaded track was autosaved.',
  )
  assert(
    await unavailableDraftPage.getByRole('button', { name: 'Export cleaned GPX' }).isEnabled(),
    'A track must remain usable and exportable while draft storage is unavailable.',
  )
  await unavailableDraftContext.close()

  assert(
    clientErrors.length === 0,
    `Browser workflow reported client errors:\n${clientErrors.slice(0, 20).join('\n')}`,
  )
  console.log('Browser smoke workflow passed with no client errors.')
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

async function assertHeaderLayout(page, {
  label,
  compactDesktop = false,
  expectedAuxiliary = 'none',
  expectError = false,
  expectNotice = true,
  mobile = false,
}) {
  const metrics = await page.evaluate(({ mobileLayout }) => {
    const requiredSelectors = [
      '.hero',
      '.hero-copy',
      '.hero-actions',
      '.hero-actions-row',
      '.hero-mode-actions',
      '.hero-context-actions',
      '.language-picker',
      '.hero-feedback',
    ]
    const missing = requiredSelectors.filter((selector) => !document.querySelector(selector))
    if (missing.length) {
      return { missing }
    }

    const hero = document.querySelector('.hero')
    const heroCopy = document.querySelector('.hero-copy')
    const actions = document.querySelector('.hero-actions')
    const actionRow = document.querySelector('.hero-actions-row')
    const feedback = document.querySelector('.hero-feedback')
    const isVisible = (element) => {
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
    }
    const rect = (element) => {
      const bounds = element.getBoundingClientRect()
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      }
    }
    const contains = (parent, child) => {
      const parentBounds = parent.getBoundingClientRect()
      const childBounds = child.getBoundingClientRect()
      return childBounds.left >= parentBounds.left - 1 &&
        childBounds.top >= parentBounds.top - 1 &&
        childBounds.right <= parentBounds.right + 1 &&
        childBounds.bottom <= parentBounds.bottom + 1
    }
    const overlaps = (left, right) => {
      const leftBounds = left.getBoundingClientRect()
      const rightBounds = right.getBoundingClientRect()
      return Math.min(leftBounds.right, rightBounds.right) - Math.max(leftBounds.left, rightBounds.left) > 1 &&
        Math.min(leftBounds.bottom, rightBounds.bottom) - Math.max(leftBounds.top, rightBounds.top) > 1
    }
    const visibleChildren = (element) => Array.from(element.children).filter(isVisible)

    const actionStructure = Array.from(actionRow.children)
    const actionChildren = actionStructure.flatMap((child) => (
      getComputedStyle(child).display === 'contents'
        ? visibleChildren(child)
        : isVisible(child) ? [child] : []
    ))
    const feedbackChildren = visibleChildren(feedback)
    const containmentFailures = []
    ;[
      [actions, actionRow, 'action row'],
      [actions, feedback, 'feedback rail'],
      ...actionChildren.map((child) => [actionRow, child, child.className]),
      ...feedbackChildren.map((child) => [feedback, child, child.className]),
    ].forEach(([parent, child, name]) => {
      if (!contains(parent, child)) {
        containmentFailures.push({ name, parent: rect(parent), child: rect(child) })
      }
    })

    const overlapFailures = []
    for (let index = 0; index < actionChildren.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < actionChildren.length; nextIndex += 1) {
        if (overlaps(actionChildren[index], actionChildren[nextIndex])) {
          overlapFailures.push(`${actionChildren[index].className} / ${actionChildren[nextIndex].className}`)
        }
      }
    }
    for (let index = 0; index < feedbackChildren.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < feedbackChildren.length; nextIndex += 1) {
        if (overlaps(feedbackChildren[index], feedbackChildren[nextIndex])) {
          overlapFailures.push(`${feedbackChildren[index].className} / ${feedbackChildren[nextIndex].className}`)
        }
      }
    }
    if (overlaps(actionRow, feedback)) {
      overlapFailures.push('action row / feedback rail')
    }

    const measuredForOverflow = [
      document.documentElement,
      hero,
      heroCopy,
      actions,
      actionRow,
      feedback,
      ...actionChildren,
      ...feedbackChildren,
    ]
    const overflowFailures = measuredForOverflow
      .map((element) => ({
        className: element === document.documentElement ? 'document' : element.className,
        overflow: element.scrollWidth - element.clientWidth,
      }))
      .filter(({ overflow }) => overflow > 1)

    const titleFailures = Array.from(hero.querySelectorAll('.status-text-compact, .hero-error-text'))
      .filter(isVisible)
      .map((element) => ({ text: element.textContent.trim(), title: element.getAttribute('title')?.trim() ?? '' }))
      .filter(({ text, title }) => !text || title !== text)

    const auxiliaryTitleFailures = Array.from(hero.querySelectorAll('.draft-card, .draft-saved'))
      .filter(isVisible)
      .map((element) => ({
        ariaLabel: element.getAttribute('aria-label')?.trim() ?? '',
        className: element.className,
        title: element.getAttribute('title')?.trim() ?? '',
      }))
      .filter(({ ariaLabel, title }) => !title || title !== ariaLabel)

    const mobileTargetSelector = [
      '.hero-mode-actions .workspace-mode-switch label',
      '.hero-mode-actions > button',
      '.hero-context-actions > button',
      '.hero-context-actions > .file-picker',
      '.language-picker',
      '.draft-actions > button',
    ].join(', ')
    const undersizedMobileTargets = mobileLayout
      ? Array.from(hero.querySelectorAll(mobileTargetSelector))
          .filter(isVisible)
          .map((element) => ({
            name: element.getAttribute('aria-label') ?? element.textContent.trim(),
            ...rect(element),
          }))
          .filter(({ height, width }) => height < 43.5 || width < 43.5)
      : []

    return {
      actionRowHeight: actionRow.getBoundingClientRect().height,
      auxiliaryTitleFailures,
      containmentFailures,
      draftCardCount: feedback.querySelectorAll('.draft-card').length,
      draftSavedCount: feedback.querySelectorAll('.draft-saved').length,
      errorCount: feedback.querySelectorAll('.hero-error-text').length,
      feedbackHeight: feedback.getBoundingClientRect().height,
      headerHeight: hero.getBoundingClientRect().height,
      missing,
      noticeCount: feedback.querySelectorAll('.hero-notice').length,
      overflowFailures,
      overlapFailures,
      rowContract: actionStructure.length === 3 &&
        actionStructure[0].classList.contains('hero-mode-actions') &&
        actionStructure[1].classList.contains('hero-context-actions') &&
        actionStructure[2].classList.contains('language-picker'),
      titleFailures,
      undersizedMobileTargets,
    }
  }, { mobileLayout: mobile })

  const details = JSON.stringify(metrics)
  assert(metrics.missing.length === 0, `${label} must render the complete header structure: ${details}`)
  assert(metrics.rowContract, `${label} must preserve the mode, context, and language action groups: ${details}`)
  assert(metrics.containmentFailures.length === 0, `${label} must keep every group inside its rail: ${details}`)
  assert(metrics.overflowFailures.length === 0, `${label} must not overflow horizontally: ${details}`)
  assert(metrics.overlapFailures.length === 0, `${label} must not overlap header groups: ${details}`)
  assert(metrics.titleFailures.length === 0, `${label} status and error text must expose its full title: ${details}`)
  assert(metrics.auxiliaryTitleFailures.length === 0, `${label} draft state must expose its full accessible title: ${details}`)
  assert(metrics.noticeCount === (expectNotice ? 1 : 0), `${label} must render the expected feedback notice: ${details}`)
  assert(metrics.errorCount === (expectError ? 1 : 0), `${label} must render the expected error state: ${details}`)
  assert(
    metrics.draftCardCount === (expectedAuxiliary === 'draft-card' ? 1 : 0) &&
      metrics.draftSavedCount === (expectedAuxiliary === 'draft-saved' ? 1 : 0),
    `${label} must render only its expected draft state: ${details}`,
  )
  if (compactDesktop) {
    assert(
      metrics.headerHeight <= 120 && metrics.actionRowHeight <= 56 && metrics.feedbackHeight <= 52,
      `${label} must retain the compact two-rail desktop height: ${details}`,
    )
  }
  if (mobile) {
    assert(
      metrics.undersizedMobileTargets.length === 0,
      `${label} must provide 44px header touch targets: ${details}`,
    )
  }
}

async function installRoutingFixture(page) {
  let requestCount = 0
  await page.route('https://brouter.de/brouter?**', async (route) => {
    requestCount += 1
    const requestUrl = new URL(route.request().url())
    const controls = (requestUrl.searchParams.get('lonlats') ?? '')
      .split('|')
      .map((value) => value.split(',').map(Number))
    if (controls.length < 2 || controls.some((control) => !control.every(Number.isFinite))) {
      await route.fulfill({ status: 200, body: '{}' })
      return
    }
    const coordinates = [controls[0]]
    let distanceMeters = 0
    for (let index = 0; index < controls.length - 1; index += 1) {
      const from = controls[index]
      const to = controls[index + 1]
      coordinates.push([
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
      ], to)
      distanceMeters += Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) * 80000))
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { 'track-length': distanceMeters },
          geometry: { type: 'LineString', coordinates },
        }],
      }),
    })
  })
  return { getRequestCount: () => requestCount }
}

async function installMapTileFixture(page) {
  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const fulfillTile = (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentPng,
  })
  await page.route('https://tile.openstreetmap.org/**', fulfillTile)
  await page.route('https://server.arcgisonline.com/**', fulfillTile)
}

async function waitForRouteDraftLockRelease(page) {
  await page.waitForFunction(async () => {
    if (typeof navigator.locks?.query !== 'function') return true
    const snapshot = await navigator.locks.query()
    return !snapshot.held.some(({ name }) => name === 'fixyourtrack:create-route-draft:active-route')
  })
}
