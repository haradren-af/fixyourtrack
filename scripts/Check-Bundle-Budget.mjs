import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const assetsDirectory = path.resolve(import.meta.dirname, '..', 'dist', 'assets')
const budgets = [
  { label: 'initial application', pattern: /^index-[\w-]+\.js$/, raw: 350_000, gzip: 110_000 },
  { label: 'route planner', pattern: /^CreateRouteWorkspace-[\w-]+\.js$/, raw: 90_000, gzip: 30_000 },
  { label: 'interactive map', pattern: /^TrackMap-[\w-]+\.js$/, raw: 1_100_000, gzip: 300_000 },
]

if (!fs.existsSync(assetsDirectory)) {
  throw new Error('dist/assets does not exist. Run the production build first.')
}

const assetNames = fs.readdirSync(assetsDirectory)
let failed = false
for (const budget of budgets) {
  const assetName = assetNames.find((name) => budget.pattern.test(name))
  if (!assetName) {
    console.error(`Missing ${budget.label} bundle.`)
    failed = true
    continue
  }
  const content = fs.readFileSync(path.join(assetsDirectory, assetName))
  const gzipBytes = gzipSync(content).byteLength
  const withinBudget = content.byteLength <= budget.raw && gzipBytes <= budget.gzip
  console.log(`${withinBudget ? 'PASS' : 'FAIL'} ${budget.label}: ${content.byteLength} B raw, ${gzipBytes} B gzip`)
  failed ||= !withinBudget
}

if (failed) {
  process.exitCode = 1
}
