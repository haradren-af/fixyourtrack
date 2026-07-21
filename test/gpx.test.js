import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import { parseGpxDocument } from '../src/gpx.js'
import { buildGpx, finalizeTrack } from '../src/trackCore.js'

const multiSegmentGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" xmlns:fixtrack="https://fixyourtrack.local/extensions/v1">
  <trk>
    <name>Two segments</name>
    <trkseg>
      <trkpt lat="55" lon="37">
        <ele>100</ele><time>2026-01-01T00:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr><gpxtpx:speed>5</gpxtpx:speed><gpxtpx:cad>80</gpxtpx:cad><gpxtpx:atemp>18</gpxtpx:atemp></gpxtpx:TrackPointExtension><fixtrack:power>200</fixtrack:power><fixtrack:distance>123</fixtrack:distance></extensions>
      </trkpt>
      <trkpt lat="55.001" lon="37.001"><time>2026-01-01T00:00:10Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="56" lon="38"><time>2026-01-01T00:01:00Z</time></trkpt>
      <trkpt lat="56.001" lon="38.001"><time>2026-01-01T00:01:10Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

test('GPX parser preserves multiple segments and supported sensor fields', () => {
  const document = new DOMParser().parseFromString(multiSegmentGpx, 'application/xml')
  const parsed = parseGpxDocument(document, 'fallback')

  assert.equal(parsed.name, 'Two segments')
  assert.equal(parsed.samples.length, 4)
  assert.equal(parsed.samples[0].segmentStart, true)
  assert.equal(parsed.samples[1].segmentStart, false)
  assert.equal(parsed.samples[2].segmentStart, true)
  assert.equal(parsed.samples[0].heartRate, 130)
  assert.equal(parsed.samples[0].speed, 5)
  assert.equal(parsed.samples[0].cadence, 80)
  assert.equal(parsed.samples[0].power, 200)
  assert.equal(parsed.samples[0].temperature, 18)
  assert.equal(parsed.samples[0].distance, 123)

  const roundTrip = buildGpx(finalizeTrack(parsed))
  assert.equal((roundTrip.match(/<trkseg>/g) ?? []).length, 2)
  assert.equal((roundTrip.match(/<trkpt /g) ?? []).length, 4)
})

test('GPX parser rejects documents without track or route points', () => {
  const document = new DOMParser().parseFromString('<gpx />', 'application/xml')
  assert.throws(() => parseGpxDocument(document), /No track geometry/)
})

test('GPX parser rejects non-GPX XML documents', () => {
  const xml = new DOMParser().parseFromString(
    '<svg><trkseg><trkpt lat="55" lon="37" /></trkseg></svg>',
    'application/xml',
  )

  assert.throws(() => parseGpxDocument(xml), /not a GPX file/)
})

test('exported GPX uses common Garmin and general sensor extension names', () => {
  const parsed = parseGpxDocument(
    new DOMParser().parseFromString(multiSegmentGpx, 'application/xml'),
    'fallback',
  )
  const gpx = buildGpx(finalizeTrack(parsed))
  const document = new DOMParser().parseFromString(gpx, 'application/xml')

  assert.equal(document.getElementsByTagName('parsererror').length, 0)
  assert.equal(document.getElementsByTagNameNS('*', 'TrackPointExtension').length, 1)
  assert.equal(document.getElementsByTagNameNS('*', 'hr').length, 1)
  assert.equal(document.getElementsByTagNameNS('*', 'cad').length, 1)
  assert.equal(document.getElementsByTagNameNS('*', 'power').length, 1)
  assert.equal(document.getElementsByTagNameNS('*', 'distance').length, 1)
})
