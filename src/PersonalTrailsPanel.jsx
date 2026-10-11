import { useState } from 'react'
import { loadPersonalTrails, resetPersonalTrails } from './personalTrailStore'
import { personalNetworkGeoJson } from './personalTrails'

export default function PersonalTrailsPanel({ t, onChange, onUse, disabled }) {
  const [network, setNetwork] = useState(null)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function load(rebuild = false) {
    setBusy(true); setError(false)
    try {
      if (rebuild) {
        const response = await fetch('/local-trails/rebuild', { method: 'POST', headers: { 'X-FixYourTrack-Local': '1' } })
        if (!response.ok) throw new Error('Rebuild failed')
        resetPersonalTrails()
      }
      const loaded = await loadPersonalTrails()
      setNetwork(loaded.network); setVisible(true)
      onChange(personalNetworkGeoJson(loaded.network), rebuild)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  return <section className="panel personal-trails-panel">
    <div className="panel-header"><h2>{t('personalTrails')}</h2></div>
    <p className="muted-text">{t('personalTrailsHelp')}</p>
    {network ? <p>{t('personalTrailsCount', { tracks: network.summary.tracks, repeated: network.summary.repeatedEdges })}</p> : null}
    <div className="stack">
      <button className="ghost-button" disabled={busy || disabled} onClick={() => {
        if (visible) { setVisible(false); onChange(null, false) } else { void load() }
      }}>{t(busy ? 'personalTrailsBusy' : visible ? 'personalTrailsHide' : 'personalTrailsShow')}</button>
      <button className="ghost-button" disabled={busy || disabled} onClick={() => load(true)}>{t('personalTrailsRefresh')}</button>
      {network ? <button className="primary-button" disabled={busy || disabled} onClick={onUse}>{t('personalTrailsUse')}</button> : null}
    </div>
    {visible ? <p className="muted-text">{t('personalTrailsLegend')}</p> : null}
    {error ? <p role="alert">{t('personalTrailsError')}</p> : null}
  </section>
}
