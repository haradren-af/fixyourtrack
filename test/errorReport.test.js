import assert from 'node:assert/strict'
import test from 'node:test'
import { createSafeErrorReport } from '../src/errorReport.js'

test('safe crash reports exclude sensitive error contents', () => {
  const sensitive = 'Failed route for C:\\Users\\Alex\\ride.fit at 55.7558, 37.6173'
  const report = createSafeErrorReport(
    new Error(sensitive),
    '0.10.5',
    new Date('2026-06-10T12:00:00Z'),
  )
  const serialized = JSON.stringify(report)

  assert.equal(report.category, 'network')
  assert.equal(report.appVersion, '0.10.5')
  assert.doesNotMatch(serialized, /Alex|ride\.fit|55\.7558|37\.6173|Users/)
  assert.equal('message' in report, false)
  assert.equal('stack' in report, false)
})
