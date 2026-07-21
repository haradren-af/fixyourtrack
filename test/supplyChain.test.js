import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('CycloneDX npm purls preserve the namespace separator for scoped packages', async () => {
  const sbom = JSON.parse(await readFile(new URL('../SBOM.cdx.json', import.meta.url), 'utf8'))
  const scopedComponents = sbom.components.filter(({ name }) => name.startsWith('@'))

  assert.ok(scopedComponents.length > 0)
  for (const component of scopedComponents) {
    const [scope, packageName] = component.name.split('/')
    assert.equal(
      component.purl,
      `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(component.version)}`,
    )
    assert.equal(component['bom-ref'], component.purl)
    assert.doesNotMatch(component.purl, /%2f/i)
  }
})
