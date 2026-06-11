import assert from 'node:assert/strict'
import test from 'node:test'
import {
  directLegMode,
  getLegMode,
  getRouteStartControlId,
  removeWaypointLeg,
  routedLegMode,
  splitLeg,
} from '../src/routeLegs.js'

const points = [{ id: 'one' }, { id: 'two' }]

test('route start control follows the repair direction', () => {
  assert.equal(getRouteStartControlId('before'), 'endpoint')
  assert.equal(getRouteStartControlId('middle'), 'anchor')
  assert.equal(getRouteStartControlId('after'), 'anchor')
})

test('splitting a manual leg keeps both resulting legs manual', () => {
  const modes = splitLeg({ anchor: directLegMode }, 'anchor', 'one')
  assert.equal(getLegMode(modes, 'anchor'), directLegMode)
  assert.equal(getLegMode(modes, 'one'), directLegMode)
})

test('splitting a routed leg keeps both resulting legs routed', () => {
  const modes = splitLeg({}, 'anchor', 'one')
  assert.equal(getLegMode(modes, 'anchor'), routedLegMode)
  assert.equal(getLegMode(modes, 'one'), routedLegMode)
})

test('manual tracing makes only the incoming leg direct and resumes routing afterward', () => {
  const modes = splitLeg({}, 'anchor', 'one', directLegMode, routedLegMode)
  assert.equal(getLegMode(modes, 'anchor'), directLegMode)
  assert.equal(getLegMode(modes, 'one'), routedLegMode)
})

test('removing a waypoint rejoins a routed incoming and manual outgoing section by roads', () => {
  const modes = removeWaypointLeg(
    { anchor: routedLegMode, one: directLegMode, two: routedLegMode },
    points,
    'one',
    'middle',
  )
  assert.equal(getLegMode(modes, 'anchor'), routedLegMode)
  assert.equal('one' in modes, false)
})

test('removing a waypoint rejoins a manual incoming and routed outgoing section by roads', () => {
  const modes = removeWaypointLeg(
    { anchor: directLegMode, one: routedLegMode },
    points,
    'one',
    'middle',
  )
  assert.equal(getLegMode(modes, 'anchor'), routedLegMode)
  assert.equal('one' in modes, false)
})

test('removing a waypoint rejoins two manual sections by roads', () => {
  const modes = removeWaypointLeg(
    { anchor: directLegMode, one: directLegMode },
    points,
    'one',
    'middle',
  )
  assert.equal(getLegMode(modes, 'anchor'), routedLegMode)
  assert.equal('one' in modes, false)
})

test('removing the first waypoint in a before repair rejoins the endpoint leg by roads', () => {
  const modes = removeWaypointLeg(
    { endpoint: routedLegMode, one: directLegMode },
    points,
    'one',
    'before',
  )
  assert.equal(getLegMode(modes, 'endpoint'), routedLegMode)
  assert.equal('one' in modes, false)
})
