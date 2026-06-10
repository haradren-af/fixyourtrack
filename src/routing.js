const brouterProfiles = {
  cycling: 'trekking',
  walking: 'hiking-beta',
}

export function getRoutingRequests(from, to, profile) {
  if (profile === 'driving') {
    return [{
      provider: 'osrm',
      url: buildOsrmUrl('https://router.project-osrm.org/route/v1/driving', from, to),
    }]
  }

  const params = new URLSearchParams({
    lonlats: `${from.lon},${from.lat}|${to.lon},${to.lat}`,
    profile: brouterProfiles[profile] ?? brouterProfiles.cycling,
    alternativeidx: '0',
    format: 'geojson',
  })
  const fallbackProfile = profile === 'walking' ? 'routed-foot' : 'routed-bike'
  return [
    {
      provider: 'brouter',
      url: `https://brouter.de/brouter?${params.toString()}`,
    },
    {
      provider: 'osrm',
      url: buildOsrmUrl(`https://routing.openstreetmap.de/${fallbackProfile}/route/v1/driving`, from, to),
    },
  ]
}

export function parseRoutingResponse(data, provider) {
  if (provider === 'brouter') {
    const route = Array.isArray(data?.features) ? data.features[0] : null
    return {
      coordinates: route?.geometry?.type === 'LineString'
        ? route.geometry.coordinates
        : null,
      distanceMeters: readFiniteNumber(route?.properties?.['track-length']),
    }
  }

  const route = Array.isArray(data?.routes) ? data.routes[0] : null
  return {
    coordinates: route?.geometry?.coordinates ?? null,
    distanceMeters: readFiniteNumber(route?.distance),
  }
}

function readFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function buildOsrmUrl(baseUrl, from, to) {
  const coordinates = `${from.lon},${from.lat};${to.lon},${to.lat}`
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
    continue_straight: 'true',
  })
  return `${baseUrl}/${coordinates}?${params.toString()}`
}
