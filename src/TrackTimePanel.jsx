import { useState } from 'react'
import { getTrackTimeBounds, localDateTime, shiftTrackTime } from './trackTime'

export default function TrackTimePanel({ track, disabled, t, onApply }) {
  const bounds = getTrackTimeBounds(track)
  const [anchor, setAnchor] = useState('start')
  const current = bounds ? localDateTime(bounds[anchor]) : { date: '', time: '' }
  const [date, setDate] = useState(null)
  const [time, setTime] = useState(null)
  const [error, setError] = useState(false)
  return (
    <section className="panel track-time-panel">
      <div className="panel-header"><h2>{t('trackTimeTitle')}</h2></div>
      {!bounds ? <p className="muted-text">{t('trackTimeUnavailable')}</p> : (
        <form onSubmit={(event) => {
          event.preventDefault()
          if (disabled) return
          try {
            const updated = shiftTrackTime(track, { date: date ?? current.date, time: time ?? current.time, anchor })
            onApply(updated)
            setDate(null)
            setTime(null)
            setError(false)
          } catch { setError(true) }
        }}>
          <fieldset disabled={disabled} className="track-time-fields">
            <legend>{t('trackTimeAnchor')}</legend>
            <div className="track-time-options">
              {['start', 'end'].map((value) => (
                <label key={value}><input type="radio" name="track-time-anchor" value={value} checked={anchor === value} onChange={() => { setAnchor(value); setDate(null); setTime(null); setError(false) }} />{t(value === 'start' ? 'trackTimeStart' : 'trackTimeEnd')}</label>
              ))}
            </div>
            <label>{t('trackTimeDate')}<input type="date" required value={date ?? current.date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>{t('trackTimeClock')}<input type="time" step="1" required value={time ?? current.time} onChange={(event) => setTime(event.target.value)} /></label>
            <p className="muted-text">{t('trackTimeHelp', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
            <button type="submit" className="primary-button">{t('trackTimeApply')}</button>
          </fieldset>
          {disabled ? <p className="muted-text">{t('trackTimeBusy')}</p> : null}
          {error ? <p role="alert">{t('trackTimeInvalid')}</p> : null}
        </form>
      )}
    </section>
  )
}
