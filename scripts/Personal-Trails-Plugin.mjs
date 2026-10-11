import fs from 'node:fs/promises'
import path from 'node:path'
import { buildPersonalTrails, personalTrailDirectory } from './Build-Personal-Trails.mjs'

export function personalTrailsPlugin() {
  let rebuild = null
  const install = (server) => { server.middlewares.use(async (request, response, next) => {
    const url = request.url?.split('?')[0]
    if (!['/local-trails/network.json', '/local-trails/rebuild'].includes(url)) return next()
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    try {
      if (url.endsWith('/rebuild')) {
        if (request.method !== 'POST' || request.headers['x-fixyourtrack-local'] !== '1' || (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host)) {
          response.statusCode = 403; return response.end('{"error":"Local request required"}')
        }
        rebuild ??= buildPersonalTrails().finally(() => { rebuild = null })
        const result = await rebuild
        return response.end(JSON.stringify({ revision: result.revision, summary: result.summary }))
      }
      response.end(await fs.readFile(path.join(personalTrailDirectory, 'network.json')))
    } catch (error) {
      response.statusCode = error.code === 'ENOENT' ? 404 : 500
      response.end(JSON.stringify({ error: 'Personal trails are unavailable. Check the local BikeHeatmap archive.' }))
    }
  }) }
  return { name: 'personal-trails', configureServer: install, configurePreviewServer: install }
}
