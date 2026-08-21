import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRoutePreviewFingerprint,
  isApplicableRoutePreview,
  isCurrentRoutePreview,
} from '../src/routePreviewState.js'

const start = { id: 'anchor', lat: 56.29258, lon: 38.10758 }
const finish = { id: 'endpoint', lat: 56.295, lon: 38.10353 }

test('keeps a ready route preview only while it matches the current controls', () => {
  const controls = [start, finish]
  const fingerprint = getRoutePreviewFingerprint(controls, {}, 'cycling')
  const readyPreview = {
    status: 'ready',
    error: '',
    fingerprint,
    segments: [{
      id: 'anchor-endpoint',
      insertAfterId: 'anchor',
      mode: 'routed',
      geometry: [start, finish],
      distanceMeters: 450,
    }],
    geometry: [start, finish],
    distanceMeters: 450,
  }

  assert.equal(isCurrentRoutePreview(readyPreview, fingerprint), true)

  const movedFinish = { ...finish, lat: finish.lat + 0.001 }
  const movedFingerprint = getRoutePreviewFingerprint(
    [start, movedFinish], {}, 'cycling',
  )

  assert.equal(isCurrentRoutePreview(readyPreview, movedFingerprint), false)
  assert.notEqual(movedFingerprint, fingerprint)
})

test('invalidates a ready preview when a leg mode or route profile changes', () => {
  const controls = [start, finish]
  const fingerprint = getRoutePreviewFingerprint(controls, {}, 'cycling')
  const readyPreview = {
    status: 'ready',
    fingerprint,
    segments: [],
    geometry: [start, finish],
    distanceMeters: 450,
  }

  const directFingerprint = getRoutePreviewFingerprint(
    controls, { anchor: 'direct' }, 'cycling',
  )
  const walkingFingerprint = getRoutePreviewFingerprint(controls, {}, 'walking')

  assert.equal(isCurrentRoutePreview(readyPreview, directFingerprint), false)
  assert.equal(isCurrentRoutePreview(readyPreview, walkingFingerprint), false)
})

test('allows a current unresolved preview to be applied exactly as drawn', () => {
  const controls = [start, finish]
  const fingerprint = getRoutePreviewFingerprint(controls, {}, 'cycling')
  const preview = {
    status: 'error',
    fingerprint,
    segments: [{
      id: 'anchor-endpoint',
      insertAfterId: 'anchor',
      mode: 'unresolved',
      geometry: [start, finish],
      distanceMeters: 450,
    }],
    geometry: [start, finish],
    distanceMeters: 450,
  }

  assert.equal(isApplicableRoutePreview(preview, fingerprint, controls.length), true)
  assert.equal(isApplicableRoutePreview(preview, `${fingerprint}-stale`, controls.length), false)
})
