import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeFilename } from '../src/filename.js'

test('creates portable bounded export filenames', () => {
  assert.equal(sanitizeFilename('ride<>:"/\\|?*'), 'ride---------')
  assert.equal(sanitizeFilename('  ...  '), 'fixed-track')
  assert.equal(sanitizeFilename('CON'), 'track-CON')
  assert.equal(sanitizeFilename('x'.repeat(200)).length, 120)
})
