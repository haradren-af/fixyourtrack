import {
  directLegMode,
  getLegMode,
  routedLegMode,
  splitLeg,
} from './routeLegs.js'
import { isValidCoordinate } from './trackCore.js'

export const routePlanSchemaVersion = 1
export const maximumRouteControls = 2000
export const defaultRouteName = 'Untitled route'

export function createRoutePlan({ name = defaultRouteName, profile = 'cycling' } = {}) {
  return {
    kind: 'route',
    schemaVersion: routePlanSchemaVersion,
    name: normalizeName(name),
    profile: normalizeProfile(profile),
    controls: [],
    legModes: {},
  }
}

export function normalizeRoutePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createRoutePlan()
  }

  const controls = []
  const ids = new Set()
  for (const candidate of Array.isArray(value.controls) ? value.controls : []) {
    if (controls.length >= maximumRouteControls) {
      break
    }
    if (!candidate || typeof candidate !== 'object' || !isValidCoordinate(candidate)) {
      continue
    }
    const id = normalizeControlId(candidate.id)
    if (!id || ids.has(id)) {
      continue
    }
    ids.add(id)
    controls.push({ id, lat: candidate.lat, lon: candidate.lon })
  }

  const outgoingIds = new Set(controls.slice(0, -1).map(({ id }) => id))
  const legModes = Object.fromEntries(
    Object.entries(value.legModes && typeof value.legModes === 'object' ? value.legModes : {})
      .filter(([id, mode]) => outgoingIds.has(id) && [routedLegMode, directLegMode].includes(mode)),
  )

  return {
    kind: 'route',
    schemaVersion: routePlanSchemaVersion,
    name: normalizeName(value.name),
    profile: normalizeProfile(value.profile),
    controls,
    legModes,
  }
}

export function normalizePersistedRoutePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  if (value.kind !== undefined && value.kind !== 'route') {
    return null
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== routePlanSchemaVersion) {
    return null
  }
  if (!Array.isArray(value.controls) || value.controls.length > maximumRouteControls) {
    return null
  }
  if (value.name !== undefined && (
    typeof value.name !== 'string' ||
    normalizeName(value.name) !== value.name
  )) {
    return null
  }
  if (value.profile !== undefined && !['cycling', 'walking'].includes(value.profile)) {
    return null
  }

  const controlIds = new Set()
  for (const control of value.controls) {
    if (
      !control ||
      typeof control !== 'object' ||
      Array.isArray(control) ||
      !isValidCoordinate(control)
    ) {
      return null
    }
    const id = normalizeControlId(control.id)
    if (!id || id !== control.id || controlIds.has(id)) {
      return null
    }
    controlIds.add(id)
  }

  if (
    value.legModes !== undefined &&
    (!value.legModes || typeof value.legModes !== 'object' || Array.isArray(value.legModes))
  ) {
    return null
  }
  const outgoingIds = new Set(value.controls.slice(0, -1).map(({ id }) => id))
  for (const [id, mode] of Object.entries(value.legModes ?? {})) {
    if (!outgoingIds.has(id) || ![routedLegMode, directLegMode].includes(mode)) {
      return null
    }
  }

  const normalized = normalizeRoutePlan(value)
  return normalized.controls.length === value.controls.length ? normalized : null
}

export function setRouteName(plan, name) {
  return { ...plan, name: normalizeName(name) }
}

export function setRouteProfile(plan, profile) {
  return { ...plan, profile: normalizeProfile(profile) }
}

export function appendRouteControl(plan, coordinate, {
  id = createControlId(),
  incomingMode = routedLegMode,
} = {}) {
  assertCanAddControl(plan, coordinate, id)
  const previous = plan.controls.at(-1)
  return normalizeRoutePlan({
    ...plan,
    controls: [...plan.controls, toControl(coordinate, id)],
    legModes: previous
      ? { ...plan.legModes, [previous.id]: normalizeLegMode(incomingMode) }
      : plan.legModes,
  })
}

export function replaceRouteControl(plan, controlId, coordinate) {
  assertCoordinate(coordinate)
  if (!plan.controls.some(({ id }) => id === controlId)) {
    return plan
  }
  return {
    ...plan,
    controls: plan.controls.map((control) => (
      control.id === controlId
        ? { ...control, lat: coordinate.lat, lon: coordinate.lon }
        : control
    )),
  }
}

export function insertRouteControl(plan, insertAfterId, coordinate, {
  id = createControlId(),
  incomingMode = null,
  outgoingMode = null,
} = {}) {
  assertCanAddControl(plan, coordinate, id)
  const insertAfterIndex = plan.controls.findIndex(({ id: controlId }) => controlId === insertAfterId)
  if (insertAfterIndex < 0 || insertAfterIndex >= plan.controls.length - 1) {
    throw new Error('A waypoint can only be inserted into an existing route leg.')
  }

  return normalizeRoutePlan({
    ...plan,
    controls: [
      ...plan.controls.slice(0, insertAfterIndex + 1),
      toControl(coordinate, id),
      ...plan.controls.slice(insertAfterIndex + 1),
    ],
    legModes: splitLeg(plan.legModes, insertAfterId, id, incomingMode, outgoingMode),
  })
}

export function removeRouteControl(plan, controlId) {
  const index = plan.controls.findIndex(({ id }) => id === controlId)
  if (index < 0) {
    return plan
  }

  const controls = plan.controls.filter(({ id }) => id !== controlId)
  const legModes = { ...plan.legModes }
  delete legModes[controlId]
  if (index > 0 && index < plan.controls.length - 1) {
    legModes[plan.controls[index - 1].id] = routedLegMode
  }

  return normalizeRoutePlan({ ...plan, controls, legModes })
}

export function setRouteLegMode(plan, fromControlId, mode) {
  const outgoingIds = plan.controls.slice(0, -1).map(({ id }) => id)
  if (!outgoingIds.includes(fromControlId)) {
    return plan
  }
  return {
    ...plan,
    legModes: {
      ...plan.legModes,
      [fromControlId]: normalizeLegMode(mode),
    },
  }
}

export function reverseRoutePlan(plan) {
  if (plan.controls.length < 2) {
    return plan
  }

  const controls = [...plan.controls].reverse()
  const oldOutgoingControls = plan.controls.slice(0, -1).reverse()
  const legModes = Object.fromEntries(
    controls.slice(0, -1).map((control, index) => [
      control.id,
      getLegMode(plan.legModes, oldOutgoingControls[index].id),
    ]),
  )
  return { ...plan, controls, legModes }
}

export function closeRouteLoop(plan, { id = createControlId() } = {}) {
  if (plan.controls.length < 2) {
    return plan
  }
  const start = plan.controls[0]
  const finish = plan.controls.at(-1)
  if (start.lat === finish.lat && start.lon === finish.lon) {
    return plan
  }
  return appendRouteControl(plan, start, { id, incomingMode: routedLegMode })
}

export function createRouteHistory(plan = createRoutePlan()) {
  return { past: [], present: normalizeRoutePlan(plan), future: [] }
}

export function commitRouteHistory(history, nextPlan) {
  const normalized = normalizeRoutePlan(nextPlan)
  if (routePlanFingerprint(history.present) === routePlanFingerprint(normalized)) {
    return history
  }
  return {
    past: [...history.past.slice(-99), history.present],
    present: normalized,
    future: [],
  }
}

export function undoRouteHistory(history) {
  if (!history.past.length) {
    return history
  }
  return {
    past: history.past.slice(0, -1),
    present: { ...history.past.at(-1), name: history.present.name },
    future: [history.present, ...history.future.slice(0, 99)],
  }
}

export function redoRouteHistory(history) {
  if (!history.future.length) {
    return history
  }
  return {
    past: [...history.past.slice(-99), history.present],
    present: { ...history.future[0], name: history.present.name },
    future: history.future.slice(1),
  }
}

export function routePlanFingerprint(plan) {
  return JSON.stringify([
    plan.profile,
    plan.controls.map(({ id, lat, lon }) => [id, lat, lon]),
    plan.controls.slice(0, -1).map(({ id }) => [id, getLegMode(plan.legModes, id)]),
  ])
}

export function getRouteExportProblems(plan, preview) {
  const problems = []
  if (plan.controls.length < 2) {
    problems.push('Add a start and finish before exporting.')
  }
  if (preview?.status === 'loading') {
    problems.push('Wait for routing to finish before exporting.')
  }
  else if (preview?.status !== 'ready') {
    problems.push('Resolve every route section before exporting.')
  }
  if (preview?.status === 'ready') {
    if (preview.segments?.length !== plan.controls.length - 1) {
      problems.push('The route preview is incomplete.')
    }
    if (!Array.isArray(preview.geometry) || preview.geometry.length < 2 || !preview.geometry.every(isValidCoordinate)) {
      problems.push('The route geometry contains invalid points.')
    }
  }
  return [...new Set(problems)]
}

function assertCanAddControl(plan, coordinate, id) {
  assertCoordinate(coordinate)
  if (plan.controls.length >= maximumRouteControls) {
    throw new Error(`A route cannot contain more than ${maximumRouteControls} control points.`)
  }
  if (!normalizeControlId(id) || plan.controls.some((control) => control.id === id)) {
    throw new Error('Route control IDs must be non-empty and unique.')
  }
}

function assertCoordinate(coordinate) {
  if (!isValidCoordinate(coordinate)) {
    throw new Error('Route control contains invalid coordinates.')
  }
}

function toControl(coordinate, id) {
  return { id, lat: coordinate.lat, lon: coordinate.lon }
}

function createControlId() {
  return `route-point-${globalThis.crypto.randomUUID()}`
}

function normalizeControlId(id) {
  return typeof id === 'string' ? id.trim().slice(0, 120) : ''
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    return defaultRouteName
  }
  const cleaned = [...name]
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint > 31 && codePoint !== 127
    })
    .join('')
    .trim()
  const normalized = [...cleaned].slice(0, 120).join('')
  return normalized || defaultRouteName
}

function normalizeProfile(profile) {
  return profile === 'walking' ? 'walking' : 'cycling'
}

function normalizeLegMode(mode) {
  return mode === directLegMode ? directLegMode : routedLegMode
}
