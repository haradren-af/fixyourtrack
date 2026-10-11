import { finalizeTrack } from './trackCore.js'

export function getTrackTimeBounds(track) {
  const times = (track?.samples ?? []).filter((sample) => sample.time).map((sample) => Date.parse(sample.time))
  if (!times.length || times.some((time) => !Number.isFinite(time))) return null
  return { start: times[0], end: times[times.length - 1] }
}

export function localDateTime(timestamp) {
  const value = new Date(timestamp)
  const pad = (number) => String(number).padStart(2, '0')
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
  }
}

export function shiftTrackTime(track, { date, time, anchor = 'start' }) {
  const bounds = getTrackTimeBounds(track)
  if (!bounds || !['start', 'end'].includes(anchor)) throw new Error('Invalid track time')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) throw new Error('Invalid date or time')
  const target = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`)
  const normalized = localDateTime(target)
  if (!Number.isFinite(target.getTime()) || normalized.date !== date || normalized.time !== (time.length === 5 ? `${time}:00` : time)) throw new Error('Invalid date or time')
  const offset = target.getTime() - bounds[anchor]
  const start = bounds.start + offset
  const originalFilename = track.originalFilename || track.name
  const base = originalFilename.replace(/\.(fit|gpx)$/i, '')
  const newDate = localDateTime(start).date
  const name = /\d{4}-\d{2}-\d{2}/.test(base)
    ? base.replace(/\d{4}-\d{2}-\d{2}/, newDate).replace(/_\d{13}(?=$|-cleaned$)/, `_${start}`)
    : `${base}_${newDate}_${localDateTime(start).time.replaceAll(':', '-')}`
  return finalizeTrack({
    ...track,
    originalFilename,
    name,
    samples: track.samples.map((sample) => ({
      ...sample,
      time: sample.time ? new Date(Date.parse(sample.time) + offset).toISOString() : sample.time,
    })),
  })
}
