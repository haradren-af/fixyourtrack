export function parseGpxDocument(xml, fallbackName = 'track') {
  if (
    xml.documentElement?.localName === 'parsererror' ||
    xml.getElementsByTagName('parsererror').length
  ) {
    throw new Error('The GPX file contains invalid XML.')
  }

  const trackSegments = Array.from(xml.getElementsByTagNameNS('*', 'trkseg'))
  const routePoints = Array.from(xml.getElementsByTagNameNS('*', 'rtept'))
  const pointGroups = trackSegments.length
    ? trackSegments.map((segment) => Array.from(segment.getElementsByTagNameNS('*', 'trkpt')))
    : routePoints.length
      ? [routePoints]
      : []

  if (!pointGroups.length) {
    throw new Error('No track geometry was found in the GPX file.')
  }

  return {
    name: readTrackName(xml) || fallbackName,
    format: 'gpx',
    samples: pointGroups.flatMap((points) => points.map((point, index) => ({
      lat: readNumericAttribute(point, 'lat'),
      lon: readNumericAttribute(point, 'lon'),
      ele: readNumericChild(point, 'ele'),
      time: readTextChild(point, 'time'),
      speed: readNumericChild(point, 'speed'),
      distance: readNumericChild(point, 'distance'),
      heartRate: readNumericChild(point, 'hr'),
      cadence: readNumericChild(point, 'cad'),
      power: readNumericChild(point, 'power'),
      temperature: readNumericChild(point, 'atemp'),
      segmentStart: index === 0,
    }))),
  }
}

function readNumericAttribute(node, name) {
  const value = Number.parseFloat(node.getAttribute(name) ?? '')
  return Number.isFinite(value) ? value : null
}

function readNumericChild(node, localName) {
  const child = node.getElementsByTagNameNS('*', localName)[0]
  const value = Number.parseFloat(child?.textContent ?? '')
  return Number.isFinite(value) ? value : null
}

function readTextChild(node, localName) {
  const child = node.getElementsByTagNameNS('*', localName)[0]
  const value = child?.textContent?.trim()
  return value || null
}

function readTrackName(xml) {
  const track = xml.getElementsByTagNameNS('*', 'trk')[0]
  if (!track) {
    return null
  }

  const name = Array.from(track.childNodes).find((node) => node.localName === 'name')
  return name?.textContent?.trim() || null
}
