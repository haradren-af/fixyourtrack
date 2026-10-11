import { decodeFitSummary, FIT_SUMMARY_NAMESPACE } from './fitSummary.js'

export function parseGpxDocument(xml, fallbackName = 'track') {
  if (
    xml.documentElement?.localName === 'parsererror' ||
    xml.getElementsByTagName('parsererror').length
  ) {
    throw new Error('The GPX file contains invalid XML.')
  }
  if (xml.documentElement?.localName?.toLowerCase() !== 'gpx') {
    throw new Error('The selected XML document is not a GPX file.')
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

  const trackNode = xml.getElementsByTagNameNS('*', 'trk')[0]
  const extensions = Array.from(trackNode?.childNodes ?? []).find(node => node.localName === 'extensions')
  const summaries = Array.from(extensions?.childNodes ?? []).filter(node => node.namespaceURI === FIT_SUMMARY_NAMESPACE && node.localName === 'activitySummary')
  const summaryNode = summaries.length === 1 ? summaries[0] : null
  const fitSummary = summaryNode ? decodeFitSummary(summaryNode.textContent, summaryNode.getAttribute('version'), summaryNode.getAttribute('source'), summaryNode.getAttribute('encoding')) : null
  return {
    name: readTrackName(xml) || fallbackName,
    format: 'gpx',
    ...(fitSummary ? { fitSummary } : {}),
    ...(readFixtrackFlag(trackNode, 'excludeFromAverageSpeed') ? { excludeFromAverageSpeed: true } : {}),
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
      ...(readTextChild(point, 'repairAccepted') === 'true' ? { repairAccepted: true } : {}),
      ...Object.fromEntries(['emergencyRepair', 'reconstructed', 'routeDistance'].filter(field => readFixtrackFlag(point, field)).map(field => [field, true])),
    }))),
  }
}

function readFixtrackFlag(point, localName) {
  const extensions = Array.from(point?.childNodes ?? []).find(node => node.localName === 'extensions')
  const flags = Array.from(extensions?.childNodes ?? []).filter(node => node.namespaceURI === FIT_SUMMARY_NAMESPACE && node.localName === localName)
  return flags.length === 1 && flags[0].textContent?.trim() === 'true'
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
