import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(root, 'package-lock.json')
const noticesPath = join(root, 'THIRD_PARTY_NOTICES.txt')
const sbomPath = join(root, 'SBOM.cdx.json')
const checkOnly = process.argv.includes('--check')

// This package's published metadata declares MIT, but its lockfile entry omits
// the license field. Keep overrides explicit so a missing declaration cannot be
// silently reported as a permissive license.
const licenseOverrides = new Map([
  ['@mapbox/jsonlint-lines-primitives@2.0.2', 'MIT'],
])

function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n').trimEnd()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function packageNameFromLockPath(lockPackagePath) {
  return lockPackagePath.split('node_modules/').at(-1)
}

function normalizeRepository(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url
  if (!value) return null

  const normalized = value
    .replace(/^git\+/, '')
    .replace(/^git:\/\/github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')

  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? `https://github.com/${normalized}`
    : normalized
}

function licenseEntries(expression) {
  if (/^[A-Za-z0-9-.+]+$/.test(expression)) {
    return [{ license: { id: expression } }]
  }
  return [{ expression }]
}

function integrityHash(integrity) {
  if (!integrity) return []
  const candidate = integrity.split(/\s+/).find((value) => value.startsWith('sha512-'))
  if (!candidate) return []

  const base64 = candidate.slice('sha512-'.length)
  return [{ alg: 'SHA-512', content: Buffer.from(base64, 'base64').toString('hex') }]
}

function purlFor(name, version) {
  const scopedName = /^@([^/]+)\/(.+)$/.exec(name)
  const packagePath = scopedName
    ? `${encodeURIComponent(`@${scopedName[1]}`)}/${encodeURIComponent(scopedName[2])}`
    : encodeURIComponent(name)
  return `pkg:npm/${packagePath}@${encodeURIComponent(version)}`
}

function deterministicSerial(lockSource) {
  const bytes = createHash('sha256').update(lockSource).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function findLegalFiles(packageDirectory) {
  return readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)(?:[-.].*)?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function loadProductionPackages(lock) {
  const packagesByIdentity = new Map()

  for (const [lockPackagePath, lockPackage] of Object.entries(lock.packages ?? {})) {
    if (!lockPackagePath || lockPackage.dev || lockPackage.link) continue

    const packageDirectory = join(root, ...lockPackagePath.split('/'))
    const manifestPath = join(packageDirectory, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`Installed package is missing: ${lockPackagePath}. Run npm ci first.`)
    }

    const manifest = readJson(manifestPath)
    const name = manifest.name ?? packageNameFromLockPath(lockPackagePath)
    const version = lockPackage.version ?? manifest.version
    const identity = `${name}@${version}`
    const license = lockPackage.license ?? manifest.license ?? licenseOverrides.get(identity)
    if (!license) {
      throw new Error(`No declared license for production dependency ${identity}. Review it and add an explicit override if appropriate.`)
    }

    const existing = packagesByIdentity.get(identity)
    if (existing) {
      if (existing.integrity !== lockPackage.integrity) {
        throw new Error(`Conflicting lockfile records for ${identity}.`)
      }
      existing.lockPaths.push(lockPackagePath)
      continue
    }

    const legalFiles = findLegalFiles(packageDirectory).map((filename) => ({
      filename,
      text: normalizeText(readFileSync(join(packageDirectory, filename), 'utf8')),
    }))

    packagesByIdentity.set(identity, {
      identity,
      name,
      version,
      license,
      repository: normalizeRepository(manifest.repository),
      resolved: lockPackage.resolved ?? null,
      integrity: lockPackage.integrity ?? null,
      optional: Boolean(lockPackage.optional),
      lockPaths: [lockPackagePath],
      legalFiles,
    })
  }

  return [...packagesByIdentity.values()].sort((left, right) =>
    left.identity.localeCompare(right.identity, 'en'),
  )
}

function generateNotices(packages) {
  const lines = [
    'FixYourTrack Third-Party Notices',
    '================================',
    '',
    'This file is generated from package-lock.json and the legal files shipped',
    'with installed production dependencies. Do not edit it by hand. Regenerate',
    'it with: npm run supply-chain:generate',
    '',
    `Production dependency components: ${packages.length}`,
    '',
    'Dependency inventory',
    '--------------------',
    '',
  ]

  for (const dependency of packages) {
    lines.push(`${dependency.identity} | ${dependency.license}`)
    lines.push(`  Source: ${dependency.repository ?? dependency.resolved ?? 'not declared'}`)
    if (dependency.optional) lines.push('  Optional dependency: yes')
    if (dependency.legalFiles.length === 0) {
      lines.push('  Bundled legal file: none (license declaration shown above)')
    } else {
      lines.push(`  Bundled legal files: ${dependency.legalFiles.map((file) => file.filename).join(', ')}`)
    }
  }

  lines.push('', 'Bundled license and notice texts', '--------------------------------', '')

  for (const dependency of packages) {
    if (dependency.legalFiles.length === 0) continue
    for (const legalFile of dependency.legalFiles) {
      lines.push(`===== ${dependency.identity} / ${legalFile.filename} =====`, '')
      lines.push(legalFile.text, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function generateSbom(lockSource, lock, packages) {
  const applicationName = lock.packages?.['']?.name ?? lock.name
  const applicationVersion = lock.packages?.['']?.version ?? lock.version
  const components = packages.map((dependency) => {
    const component = {
      type: 'library',
      'bom-ref': purlFor(dependency.name, dependency.version),
      name: dependency.name,
      version: dependency.version,
      hashes: integrityHash(dependency.integrity),
      licenses: licenseEntries(dependency.license),
      purl: purlFor(dependency.name, dependency.version),
      properties: [
        { name: 'fixyourtrack:package-lock-paths', value: dependency.lockPaths.join(',') },
        { name: 'fixyourtrack:optional', value: String(dependency.optional) },
      ],
    }

    const sourceUrl = dependency.repository ?? dependency.resolved
    if (sourceUrl) {
      component.externalReferences = [{ type: dependency.repository ? 'vcs' : 'distribution', url: sourceUrl }]
    }
    if (component.hashes.length === 0) delete component.hashes
    return component
  })

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: deterministicSerial(lockSource),
    version: 1,
    metadata: {
      tools: {
        components: [{
          type: 'application',
          name: 'FixYourTrack supply-chain generator',
          version: '1',
        }],
      },
      component: {
        type: 'application',
        'bom-ref': purlFor(applicationName, applicationVersion),
        name: applicationName,
        version: applicationVersion,
        purl: purlFor(applicationName, applicationVersion),
      },
      properties: [{ name: 'fixyourtrack:source', value: 'package-lock.json production dependency graph' }],
    },
    components,
  }

  return `${JSON.stringify(bom, null, 2)}\n`
}

function updateOrCheck(path, expected) {
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8').replace(/\r\n?/g, '\n') !== expected) {
      throw new Error(`${path.slice(root.length + 1)} is stale. Run npm run supply-chain:generate and commit the result.`)
    }
    return
  }

  writeFileSync(path, expected, 'utf8')
}

const lockSource = normalizeText(readFileSync(lockPath, 'utf8'))
const lock = JSON.parse(lockSource)
const productionPackages = loadProductionPackages(lock)
updateOrCheck(noticesPath, generateNotices(productionPackages))
updateOrCheck(sbomPath, generateSbom(lockSource, lock, productionPackages))

console.log(`${checkOnly ? 'Verified' : 'Generated'} notices and CycloneDX SBOM for ${productionPackages.length} production components.`)
