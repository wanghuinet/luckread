import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const configPath = path.join(root, 'src', 'payload.config.ts')
const collectionsDir = path.join(root, 'src', 'collections')
const outputPath = path.join(root, 'contracts', 'payload', 'payload-native-inventory.v1.json')

const config = fs.readFileSync(configPath, 'utf8')
const imports = [...config.matchAll(/import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+'\.\/collections\/([^']+)'/g)]

if (imports.length === 0) {
  throw new Error('PAYLOAD_NATIVE_DISCOVERY_BLOCKED: no statically discoverable collection imports in src/payload.config.ts')
}

const collections = []
for (const match of imports) {
  const exportName = match[1]
  const moduleName = match[2]
  const sourceFile = path.join(collectionsDir, `${moduleName}.ts`)
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`PAYLOAD_NATIVE_DISCOVERY_BLOCKED: missing collection source ${sourceFile}`)
  }

  const source = fs.readFileSync(sourceFile, 'utf8')
  const slugMatch = source.match(/slug:\s*['"]([^'"]+)['"]/) 
  if (!slugMatch) throw new Error(`PAYLOAD_NATIVE_DISCOVERY_BLOCKED: ${sourceFile} has no static slug`)
  const auth = /auth:\s*true\b/.test(source)
  const fieldsBlock = source.match(/fields:\s*\[([\s\S]*?)\n\s*\],\s*hooks:/)
  if (!fieldsBlock) throw new Error(`PAYLOAD_NATIVE_DISCOVERY_BLOCKED: ${sourceFile} fields block is not statically discoverable`)

  const fields = []
  const fieldPattern = /\{\s*name:\s*['"]([^'"]+)['"]\s*,\s*type:\s*['"]([^'"]+)['"]([\s\S]*?)\n\s*\}/g
  for (const field of fieldsBlock[1].matchAll(fieldPattern)) {
    const tail = field[3]
    const item = {
      name: field[1],
      type: field[2],
      sourceRef: `${path.relative(root, sourceFile)}:field:${field[1]}`,
      classification: 'PAYLOAD_CONFIG_DISCOVERED',
    }
    if (/required:\s*true\b/.test(tail)) item.required = true
    if (/unique:\s*true\b/.test(tail)) item.unique = true
    const defaultMatch = tail.match(/defaultValue:\s*['"]([^'"]*)['"]/) 
    if (defaultMatch) item.defaultValue = defaultMatch[1]
    fields.push(item)
  }

  collections.push({
    slug: slugMatch[1],
    sourceRef: `${path.relative(root, sourceFile)}:${exportName}`,
    auth,
    fields,
  })
}

const inventory = {
  version: '1.0.0',
  status: 'DISCOVERED',
  source: 'src/payload.config.ts + statically imported collection configs',
  generatedBy: 'scripts/payload-native-inventory.mjs',
  collections,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`)
console.log(`Payload native inventory generated: ${collections.length} collection(s), ${collections.reduce((n, c) => n + c.fields.length, 0)} field(s)`)
