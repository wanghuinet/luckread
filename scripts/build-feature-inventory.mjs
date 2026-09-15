import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const source = 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md'
const output = 'contracts/alignment/feature-inventory.v1.json'
const markdown = fs.readFileSync(path.join(root, source), 'utf8')

// Feature IDs are authoritative only when explicitly present in the Blueprint.
// This generator never invents IDs or infers capabilities from prose.
const pattern = /\b([A-Z][A-Z0-9-]+-\d{3,})\b(?:\s+([^\n]+))?/g
const features = new Map()

for (const match of markdown.matchAll(pattern)) {
  const featureId = match[1]
  const name = (match[2] ?? '').trim().replace(/[`*_]+/g, '').trim()
  if (!features.has(featureId)) {
    const offset = match.index ?? 0
    const before = markdown.slice(0, offset)
    const line = before.split('\n').length
    features.set(featureId, {
      featureId,
      name: name || featureId,
      sourceRef: `${source}:L${line}`,
      alignmentState: 'DISCOVERED',
    })
  }
}

const ordered = [...features.values()].sort((a, b) => a.featureId.localeCompare(b.featureId))
if (ordered.length === 0) {
  throw new Error('FEATURE_INVENTORY_EMPTY: no explicit Blueprint feature IDs discovered')
}

const document = {
  version: '1.0.0',
  status: 'DISCOVERED',
  sourceOfTruth: source,
  generatedBy: 'scripts/build-feature-inventory.mjs',
  features: ordered,
}

fs.mkdirSync(path.dirname(path.join(root, output)), { recursive: true })
fs.writeFileSync(path.join(root, output), `${JSON.stringify(document, null, 2)}\n`)
console.log(`Feature inventory generated: ${ordered.length} features`)
