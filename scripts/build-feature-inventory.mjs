import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const source = 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md'
const output = 'contracts/alignment/feature-inventory.v1.json'
const markdown = fs.readFileSync(path.join(root, source), 'utf8')

// Feature IDs are authoritative only when explicitly declared as list items in
// the active Blueprint. Never infer capabilities from prose, headings, URLs,
// examples, historical references, or implementation text.
const featureLine = /^\s*[-*]\s+([A-Z][A-Z0-9-]+-\d{3,})\s+(.+?)\s*$/
const features = new Map()
const duplicateIds = []

markdown.split('\n').forEach((rawLine, index) => {
  const match = rawLine.match(featureLine)
  if (!match) return

  const featureId = match[1]
  const name = match[2].replace(/[`*_]+/g, '').trim()
  const sourceRef = `${source}:L${index + 1}`

  if (features.has(featureId)) {
    duplicateIds.push({ featureId, sourceRef, firstRef: features.get(featureId).sourceRef })
    return
  }

  features.set(featureId, {
    featureId,
    name: name || featureId,
    sourceRef,
    alignmentState: 'DISCOVERED',
  })
})

if (duplicateIds.length > 0) {
  const details = duplicateIds.map((d) => `${d.featureId} (${d.firstRef}, ${d.sourceRef})`).join('; ')
  throw new Error(`FEATURE_INVENTORY_DUPLICATE_ID: ${details}`)
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
