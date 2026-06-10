import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRepairDraft } from '../src/draftStore.js'

const track = {
  name: 'ride',
  format: 'gpx',
  samples: [
    { lat: 55, lon: 37 },
    { lat: 55.01, lon: 37.01 },
  ],
}

test('migrates legacy drafts without an active repair session', () => {
  const draft = normalizeRepairDraft({
    id: 'active',
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
  })

  assert.equal(draft.schemaVersion, 2)
  assert.equal(draft.repairSession, null)
})

test('sanitizes active repair session fields', () => {
  const draft = normalizeRepairDraft({
    id: 'active',
    schemaVersion: 2,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: track,
    workingTrack: track,
    repairSession: {
      rebuildDirection: 'middle',
      selectedCutPointIndex: -5,
      removedSegmentSamples: [],
      viaPoints: [{ lat: 55.005, lon: 37.005 }, { lat: 900, lon: 37 }],
      mapMode: 'unexpected',
      routePreview: { status: 'loading', geometry: [], segments: [], distanceMeters: -1 },
    },
  })

  assert.equal(draft.repairSession.selectedCutPointIndex, null)
  assert.equal(draft.repairSession.viaPoints.length, 1)
  assert.equal(draft.repairSession.mapMode, 'inspect')
  assert.equal(draft.repairSession.routePreview.status, 'idle')
  assert.equal(draft.repairSession.routePreview.distanceMeters, 0)
})

test('rejects unsupported and malformed drafts', () => {
  assert.equal(normalizeRepairDraft({ schemaVersion: 99 }), null)
  assert.equal(normalizeRepairDraft({
    schemaVersion: 2,
    savedAt: 'invalid',
    sourceTrack: track,
    workingTrack: track,
  }), null)
  assert.equal(normalizeRepairDraft({
    schemaVersion: 2,
    savedAt: '2026-06-10T12:00:00Z',
    sourceTrack: { ...track, samples: [{ lat: 55, lon: 37 }] },
    workingTrack: track,
  }), null)
})
