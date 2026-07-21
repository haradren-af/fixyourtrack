import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendRouteControl,
  closeRouteLoop,
  commitRouteHistory,
  createRouteHistory,
  createRoutePlan,
  getRouteExportProblems,
  insertRouteControl,
  normalizeRoutePlan,
  redoRouteHistory,
  removeRouteControl,
  reverseRoutePlan,
  setRouteLegMode,
  setRouteName,
  undoRouteHistory,
} from '../src/routePlan.js'

const a = { lat: 55, lon: 37 }
const b = { lat: 55.1, lon: 37.1 }
const c = { lat: 55.2, lon: 37.2 }

function threePointPlan() {
  let plan = createRoutePlan()
  plan = appendRouteControl(plan, a, { id: 'a' })
  plan = appendRouteControl(plan, b, { id: 'b', incomingMode: 'direct' })
  return appendRouteControl(plan, c, { id: 'c', incomingMode: 'routed' })
}

test('builds an ordered start, via, and finish while preserving leg modes', () => {
  const plan = threePointPlan()
  assert.deepEqual(plan.controls.map(({ id }) => id), ['a', 'b', 'c'])
  assert.deepEqual(plan.legModes, { a: 'direct', b: 'routed' })
})

test('inserting a waypoint splits the selected leg with its mode intact', () => {
  const inserted = insertRouteControl(threePointPlan(), 'a', { lat: 55.05, lon: 37.05 }, { id: 'middle' })
  assert.deepEqual(inserted.controls.map(({ id }) => id), ['a', 'middle', 'b', 'c'])
  assert.equal(inserted.legModes.a, 'direct')
  assert.equal(inserted.legModes.middle, 'direct')
})

test('removing an interior control rejoins the surrounding leg as routed', () => {
  const removed = removeRouteControl(threePointPlan(), 'b')
  assert.deepEqual(removed.controls.map(({ id }) => id), ['a', 'c'])
  assert.deepEqual(removed.legModes, { a: 'routed' })
})

test('reversing a route reverses the leg modes as well as the controls', () => {
  const reversed = reverseRoutePlan(threePointPlan())
  assert.deepEqual(reversed.controls.map(({ id }) => id), ['c', 'b', 'a'])
  assert.deepEqual(reversed.legModes, { c: 'routed', b: 'direct' })
})

test('return to start appends a distinct finish with a routed return leg', () => {
  const loop = closeRouteLoop(threePointPlan(), { id: 'loop-finish' })
  assert.deepEqual(loop.controls.at(-1), { id: 'loop-finish', ...a })
  assert.equal(loop.legModes.c, 'routed')
})

test('undo and redo preserve structural edits and clear redo after a new edit', () => {
  const initial = createRoutePlan()
  const withStart = appendRouteControl(initial, a, { id: 'a' })
  let history = commitRouteHistory(createRouteHistory(initial), withStart)
  history = undoRouteHistory(history)
  assert.equal(history.present.controls.length, 0)
  history = redoRouteHistory(history)
  assert.equal(history.present.controls.length, 1)
  history = undoRouteHistory(history)
  history = commitRouteHistory(history, appendRouteControl(history.present, b, { id: 'b' }))
  assert.equal(history.future.length, 0)
})

test('undo and redo structural edits preserve the current route name', () => {
  const initial = createRoutePlan({ name: 'Morning route' })
  let history = commitRouteHistory(
    createRouteHistory(initial),
    appendRouteControl(initial, a, { id: 'a' }),
  )
  history = { ...history, present: setRouteName(history.present, 'Client route') }

  history = undoRouteHistory(history)
  assert.equal(history.present.name, 'Client route')
  history = redoRouteHistory(history)
  assert.equal(history.present.name, 'Client route')
})

test('normalization removes invalid, duplicate, and terminal leg data', () => {
  const normalized = normalizeRoutePlan({
    name: ' Test\u0000 ',
    profile: 'spaceship',
    controls: [
      { id: 'a', ...a },
      { id: 'a', ...b },
      { id: 'bad', lat: 200, lon: 0 },
      { id: 'c', ...c },
    ],
    legModes: { a: 'direct', c: 'direct', unknown: 'direct' },
  })
  assert.equal(normalized.name, 'Test')
  assert.equal(normalized.profile, 'cycling')
  assert.deepEqual(normalized.controls.map(({ id }) => id), ['a', 'c'])
  assert.deepEqual(normalized.legModes, { a: 'direct' })
})

test('export preflight rejects incomplete previews and accepts a complete direct route', () => {
  const plan = setRouteLegMode(threePointPlan(), 'a', 'direct')
  assert.ok(getRouteExportProblems(plan, { status: 'loading' }).length)
  assert.deepEqual(getRouteExportProblems(plan, {
    status: 'ready',
    segments: [{}, {}],
    geometry: [a, b, c],
  }), [])
})
