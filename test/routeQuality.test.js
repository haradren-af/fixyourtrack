import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldUseDirectGeometryFallback } from '../src/routeQuality.js'

test('detects a short routed spike caused by detached road snapping', () => {
  const from = { lat: 55, lon: 37 }
  const to = { lat: 55.0004, lon: 37 }

  assert.equal(shouldUseDirectGeometryFallback(from, to, [
    from,
    { lat: 55.00005, lon: 36.9991 },
    to,
  ]), true)
})

test('keeps a normal short road-following corner', () => {
  const from = { lat: 55, lon: 37 }
  const to = { lat: 55.0007, lon: 37.0007 }

  assert.equal(shouldUseDirectGeometryFallback(from, to, [
    from,
    { lat: 55, lon: 37.0007 },
    to,
  ]), false)
})

test('keeps already direct two-point geometry', () => {
  const from = { lat: 55, lon: 37 }
  const to = { lat: 55.0004, lon: 37 }

  assert.equal(shouldUseDirectGeometryFallback(from, to, [from, to]), false)
})
