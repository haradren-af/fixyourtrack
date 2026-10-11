import { indexPersonalNetwork } from './personalTrails.js'

let cached = null
export function resetPersonalTrails() { cached = null }

export async function loadPersonalTrails(fetchImpl = globalThis.fetch) {
  if (!cached) {
    cached = (async () => {
      const response = await fetchImpl('/local-trails/network.json', { signal: AbortSignal.timeout(30000), cache: 'no-store' })
      if (!response.ok) throw new Error('Build the personal trails from BikeHeatmap first.')
      const text = await response.text()
      if (text.length > 64 * 1024 * 1024) throw new Error('Personal network is too large')
      return indexPersonalNetwork(JSON.parse(text))
    })().catch((error) => { cached = null; throw error })
  }
  return cached
}
