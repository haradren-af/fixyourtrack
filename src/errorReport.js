export function createSafeErrorReport(error, version, occurredAt = new Date()) {
  return {
    reportVersion: 1,
    occurredAt: occurredAt.toISOString(),
    appVersion: version,
    category: classifyError(error),
    errorType: safeErrorType(error),
    privacy: 'No track data, filenames, coordinates, raw messages, or stack traces are included.',
  }
}

function classifyError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/fetch|network|route|elevation|timeout/.test(message)) {
    return 'network'
  }
  if (/indexeddb|database|draft|storage/.test(message)) {
    return 'storage'
  }
  if (/gpx|fit|track|parse|xml/.test(message)) {
    return 'track-processing'
  }
  return 'interface'
}

function safeErrorType(error) {
  const name = error instanceof Error ? error.name : ''
  return /^[A-Za-z]+Error$/.test(name) ? name : 'Error'
}
