import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoutingRequests, parseRoutingResponse } from '../src/routing.js'

const from = { lat: 55, lon: 37 }
const to = { lat: 55.01, lon: 37.01 }

test('uses distinct profile-aware BRouter requests for cycling and walking', () => {
  const cycling = getRoutingRequests(from, to, 'cycling')
  const walking = getRoutingRequests(from, to, 'walking')

  assert.equal(cycling[0].provider, 'brouter')
  assert.equal(walking[0].provider, 'brouter')
  assert.match(cycling[0].url, /profile=trekking/)
  assert.match(walking[0].url, /profile=hiking-beta/)
  assert.match(cycling[1].url, /routed-bike/)
  assert.match(walking[1].url, /routed-foot/)
  assert.notEqual(cycling[0].url, walking[0].url)
})

test('uses OSRM driving profile only for driving', () => {
  const requests = getRoutingRequests(from, to, 'driving')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].provider, 'osrm')
  assert.match(requests[0].url, /route\/v1\/driving/)
})

test('parses BRouter and OSRM route responses', () => {
  assert.deepEqual(parseRoutingResponse({
    features: [{
      properties: { 'track-length': '1234' },
      geometry: { type: 'LineString', coordinates: [[37, 55], [37.01, 55.01]] },
    }],
  }, 'brouter'), {
    coordinates: [[37, 55], [37.01, 55.01]],
    distanceMeters: 1234,
  })

  assert.deepEqual(parseRoutingResponse({
    routes: [{
      distance: 1500,
      geometry: { coordinates: [[37, 55], [37.01, 55.01]] },
    }],
  }, 'osrm'), {
    coordinates: [[37, 55], [37.01, 55.01]],
    distanceMeters: 1500,
  })
})
