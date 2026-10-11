export const FIT_SUMMARY_NAMESPACE = 'https://fixyourtrack.local/extensions/v1'
const metricFields = ['totalDistanceMeters', 'totalElapsedSeconds', 'totalTimerSeconds', 'totalMovingSeconds', 'averageSpeedMps']
const sessionFields = ['index', ...metricFields, 'startTime', 'endTime']
const bindingFields = ['sampleCount', 'timeDigest', 'distanceDigest', 'segmentDigest', 'firstSampleTime', 'sessionIndex', 'sessionRanges', 'mappingStatus']
const summaryFields = ['version', 'source', 'sessions', 'binding']

function timestamp(value) {
  return value === null || value === undefined || value === '' ? null : Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
}

function digest(values) {
  let hash = 2166136261
  for (const value of values) {
    const token = JSON.stringify(value) + ';'
    for (let index = 0; index < token.length; index += 1) hash = Math.imul(hash ^ token.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function summarySampleBinding(samples) {
  const firstTime = samples.map(sample => timestamp(sample.time)).find(time => time !== null) ?? null
  return {
    sampleCount: samples.length,
    firstSampleTime: firstTime === null ? null : new Date(firstTime).toISOString(),
    timeDigest: digest(samples.map(sample => timestamp(sample.time) === null ? null : timestamp(sample.time) - firstTime)),
    distanceDigest: digest(samples.map(sample => Number.isFinite(sample.distance) ? Math.round(sample.distance * 1e6) / 1e6 : null)),
    segmentDigest: digest(samples.map((sample, index) => index === 0 || Boolean(sample.segmentStart))),
  }
}

export function createFitSummary(fitSessions, samples) {
  if (!Array.isArray(fitSessions) || !fitSessions.length || fitSessions.length > 1000) return null
  const sessions = fitSessions.map((session, index) => ({
    index,
    totalDistanceMeters: finiteMetric(session.total_distance),
    totalElapsedSeconds: finiteMetric(session.total_elapsed_time),
    totalTimerSeconds: finiteMetric(session.total_timer_time),
    totalMovingSeconds: finiteMetric(session.total_moving_time),
    averageSpeedMps: finiteMetric(session.avg_speed),
    startTime: session.start_time && Number.isFinite(new Date(session.start_time).getTime()) ? new Date(session.start_time).toISOString() : null,
    endTime: session.timestamp && Number.isFinite(new Date(session.timestamp).getTime()) ? new Date(session.timestamp).toISOString() : null,
  }))
  const sessionRanges = []
  let ambiguous = false
  let unmapped = false
  for (let index = 0; index < samples.length; index += 1) {
    const time = timestamp(samples[index].time)
    const matches = sessions.length === 1 ? [sessions[0]] : sessions.filter(session => time !== null && timestamp(session.startTime) !== null && timestamp(session.endTime) !== null && time >= timestamp(session.startTime) && time <= timestamp(session.endTime))
    if (matches.length !== 1) {
      ambiguous ||= matches.length > 1
      unmapped ||= matches.length === 0
      continue
    }
    const previous = sessionRanges.at(-1)
    if (previous?.sessionIndex === matches[0].index && previous.lastSampleIndex === index - 1) previous.lastSampleIndex = index
    else sessionRanges.push({ sessionIndex: matches[0].index, firstSampleIndex: index, lastSampleIndex: index })
  }
  const single = !ambiguous && !unmapped && sessionRanges.length === 1 && sessionRanges[0].firstSampleIndex === 0 && sessionRanges[0].lastSampleIndex === samples.length - 1
  return {
    version: 1,
    source: 'fit-session',
    sessions,
    binding: {
      ...summarySampleBinding(samples),
      sessionIndex: single ? sessionRanges[0].sessionIndex : null,
      sessionRanges,
      mappingStatus: ambiguous ? 'ambiguous' : unmapped ? 'unmapped' : single ? 'single-session' : 'multi-session',
    },
  }
}

function finiteMetric(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function validObject(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key))
}

export function normalizeFitSummary(value) {
  if (!validObject(value, summaryFields) || value.version !== 1 || value.source !== 'fit-session' || !Array.isArray(value.sessions) || !value.sessions.length || value.sessions.length > 1000) return null
  for (const [index, session] of value.sessions.entries()) {
    if (!validObject(session, sessionFields) || session.index !== index || metricFields.some(key => session[key] !== null && (!Number.isFinite(session[key]) || session[key] < 0)) || ['startTime', 'endTime'].some(key => session[key] !== null && (typeof session[key] !== 'string' || timestamp(session[key]) === null))) return null
    if (session.startTime && session.endTime && timestamp(session.endTime) < timestamp(session.startTime)) return null
  }
  const binding = value.binding
  if (!validObject(binding, bindingFields) || !Number.isSafeInteger(binding.sampleCount) || binding.sampleCount < 1 || binding.sampleCount > 1_000_000 || ['timeDigest', 'distanceDigest', 'segmentDigest'].some(key => !/^[a-f0-9]{8}$/.test(binding[key])) || (binding.firstSampleTime !== null && (typeof binding.firstSampleTime !== 'string' || timestamp(binding.firstSampleTime) === null)) || !['single-session', 'multi-session', 'ambiguous', 'unmapped'].includes(binding.mappingStatus) || (binding.sessionIndex !== null && (!Number.isInteger(binding.sessionIndex) || !value.sessions[binding.sessionIndex])) || !Array.isArray(binding.sessionRanges) || binding.sessionRanges.length > 1000) return null
  let previousEnd = -1
  for (const range of binding.sessionRanges) {
    if (!validObject(range, ['sessionIndex', 'firstSampleIndex', 'lastSampleIndex']) || !Number.isInteger(range.sessionIndex) || !value.sessions[range.sessionIndex] || !Number.isInteger(range.firstSampleIndex) || !Number.isInteger(range.lastSampleIndex) || range.firstSampleIndex <= previousEnd || range.lastSampleIndex < range.firstSampleIndex || range.lastSampleIndex >= binding.sampleCount) return null
    previousEnd = range.lastSampleIndex
  }
  if (binding.sessionIndex !== null && (binding.mappingStatus !== 'single-session' || binding.sessionRanges.length !== 1 || binding.sessionRanges[0].sessionIndex !== binding.sessionIndex || binding.sessionRanges[0].firstSampleIndex !== 0 || binding.sessionRanges[0].lastSampleIndex !== binding.sampleCount - 1)) return null
  if (binding.sessionIndex === null && binding.mappingStatus === 'single-session') return null
  return JSON.parse(JSON.stringify(value))
}

export function resolveFitSummary(value, samples) {
  const summary = normalizeFitSummary(value)
  const current = summarySampleBinding(samples)
  const binding = summary?.binding
  const session = summary?.sessions[binding.sessionIndex]
  const sameSamples = Boolean(session && binding.sampleCount === current.sampleCount && binding.segmentDigest === current.segmentDigest)
  const distance = sameSamples && binding.distanceDigest === current.distanceDigest
  const time = sameSamples && binding.timeDigest === current.timeDigest && binding.firstSampleTime !== null && current.firstSampleTime !== null
  const offset = time ? timestamp(current.firstSampleTime) - timestamp(binding.firstSampleTime) : 0
  const shift = value => time && value ? new Date(timestamp(value) + offset).toISOString() : null
  return {
    totalDistanceMeters: distance ? session.totalDistanceMeters : null,
    totalElapsedSeconds: time ? session.totalElapsedSeconds : null,
    totalTimerSeconds: time ? session.totalTimerSeconds : null,
    totalMovingSeconds: time ? session.totalMovingSeconds : null,
    averageSpeedMps: distance && time ? session.averageSpeedMps : null,
    startTime: shift(session?.startTime),
    endTime: shift(session?.endTime),
    applicability: { distance, time, averageSpeed: distance && time },
  }
}

export function encodeFitSummary(summary, samples) {
  const original = normalizeFitSummary(summary)
  if (!original) return ''
  return `<fixtrack:activitySummary version="1" source="fit-session" encoding="json">${escapeXml(JSON.stringify({ ...original, applicability: resolveFitSummary(original, samples).applicability }))}</fixtrack:activitySummary>`
}

export function decodeFitSummary(json, version, source, encoding) {
  if (version !== '1' || source !== 'fit-session' || encoding !== 'json' || json.length > 1_000_000) return null
  try {
    const { applicability: exportedApplicability, ...original } = JSON.parse(json)
    // Exported flags document the export; always recheck the actual samples.
    if (!exportedApplicability || typeof exportedApplicability !== 'object') return null
    return normalizeFitSummary(original)
  } catch { return null }
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
