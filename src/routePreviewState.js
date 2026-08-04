export function getRoutePreviewFingerprint(controlPoints, legModes, profile) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    return ''
  }

  return JSON.stringify([profile, controlPoints, legModes ?? {}])
}

export function isCurrentRoutePreview(preview, fingerprint) {
  return Boolean(fingerprint) && preview?.fingerprint === fingerprint
}
