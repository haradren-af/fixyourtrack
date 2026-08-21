export function getRoutePreviewFingerprint(controlPoints, legModes, profile) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    return ''
  }

  return JSON.stringify([profile, controlPoints, legModes ?? {}])
}

export function isCurrentRoutePreview(preview, fingerprint) {
  return Boolean(fingerprint) && preview?.fingerprint === fingerprint
}

export function isApplicableRoutePreview(preview, fingerprint, controlPointCount) {
  if (
    !isCurrentRoutePreview(preview, fingerprint) ||
    !['ready', 'error'].includes(preview?.status) ||
    !Number.isInteger(controlPointCount) ||
    controlPointCount < 2 ||
    !Array.isArray(preview.geometry) ||
    preview.geometry.length < 2 ||
    !preview.geometry.every(isValidCoordinate) ||
    !Array.isArray(preview.segments) ||
    preview.segments.length !== controlPointCount - 1
  ) {
    return false
  }

  return preview.segments.every((segment) => (
    ['routed', 'direct', 'unresolved'].includes(segment?.mode) &&
    Array.isArray(segment.geometry) &&
    segment.geometry.length >= 2 &&
    segment.geometry.every(isValidCoordinate)
  ))
}

function isValidCoordinate(point) {
  return Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
}
