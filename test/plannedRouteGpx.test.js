import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'

import {
  buildPlannedRouteGpx,
  maximumPlannedRouteExportPoints,
  simplifyRouteGeometry,
} from '../src/plannedRouteGpx.js'

test('planned route GPX uses route semantics and never invents activity telemetry', () => {
  const gpx = buildPlannedRouteGpx({
    name: 'Walk & talk',
    profile: 'walking',
    geometry: [
      { lat: 55.75, lon: 37.61 },
      { lat: 55.76, lon: 37.62 },
    ],
  })
  const xml = new DOMParser().parseFromString(gpx, 'application/xml')

  assert.equal(xml.getElementsByTagName('rte').length, 1)
  assert.equal(xml.getElementsByTagName('rtept').length, 2)
  assert.equal(xml.getElementsByTagName('trk').length, 0)
  assert.equal(xml.getElementsByTagName('time').length, 0)
  assert.equal(xml.getElementsByTagName('extensions').length, 0)
  assert.match(gpx, /Walk &amp; talk/)
  assert.match(gpx, /<type>Walking<\/type>/)
})

test('planned route GPX rejects incomplete or invalid geometry', () => {
  assert.throws(
    () => buildPlannedRouteGpx({ geometry: [{ lat: 55, lon: 37 }] }),
    /at least two valid geometry points/i,
  )

  const sparseGeometry = new Array(2)
  sparseGeometry[0] = { lat: 55, lon: 37 }
  assert.throws(
    () => buildPlannedRouteGpx({ geometry: sparseGeometry }),
    /at least two valid geometry points/i,
  )
})

test('planned route GPX emits near-zero coordinates as GPX-valid decimals', () => {
  const gpx = buildPlannedRouteGpx({
    geometry: [
      { lat: 0.0000001, lon: -0.0000001 },
      { lat: -0, lon: 0.0000004 },
    ],
  })

  assert.match(gpx, /lat="0\.0000001" lon="-0\.0000001"/)
  assert.match(gpx, /lat="0" lon="0\.0000004"/)
  assert.doesNotMatch(gpx, /(?:lat|lon)="[^"]*[eE][+-]?\d+/)
  assert.doesNotMatch(gpx, /(?:lat|lon)="-0"/)
})

test('planned route GPX caps huge geometry while preserving exact endpoints', () => {
  const sourcePointCount = maximumPlannedRouteExportPoints + 137
  const geometry = Array.from({ length: sourcePointCount }, (_, index) => ({
    lat: 10 + index / sourcePointCount,
    lon: 20 + index / sourcePointCount,
  }))
  geometry[0] = { lat: -12.3456789, lon: 45.1234567 }
  geometry[geometry.length - 1] = { lat: 67.7654321, lon: -89.2345678 }

  const simplified = simplifyRouteGeometry(geometry)
  assert.equal(simplified.length, maximumPlannedRouteExportPoints)
  assert.strictEqual(simplified[0], geometry[0])
  assert.strictEqual(simplified.at(-1), geometry.at(-1))

  const gpx = buildPlannedRouteGpx({ geometry })
  const xml = new DOMParser().parseFromString(gpx, 'application/xml')
  const routePoints = Array.from(xml.getElementsByTagName('rtept'))
  assert.equal(routePoints.length, maximumPlannedRouteExportPoints)
  assert.equal(routePoints[0].getAttribute('lat'), '-12.3456789')
  assert.equal(routePoints[0].getAttribute('lon'), '45.1234567')
  assert.equal(routePoints.at(-1).getAttribute('lat'), '67.7654321')
  assert.equal(routePoints.at(-1).getAttribute('lon'), '-89.2345678')
})
