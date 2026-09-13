import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve('contracts/schemas/common')
const domain = process.argv[2] ?? 'common'
if (domain !== 'common') {
  throw new Error(`Unsupported Contract CI domain: ${domain}`)
}

const files = (await readdir(root)).filter((file) => extname(file) === '.json').sort()
if (files.length === 0) {
  throw new Error('No common JSON Schemas found')
}

const schemas = []
for (const file of files) {
  const path = join(root, file)
  let schema
  try {
    schema = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error.message}`)
  }
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${file}: must declare JSON Schema Draft 2020-12`)
  }
  if (typeof schema.$id !== 'string' || !schema.$id.startsWith('https://luckread.com/contracts/v1/common/')) {
    throw new Error(`${file}: invalid or missing $id`)
  }
  if (schema.type === undefined && schema.$ref === undefined && schema.allOf === undefined && schema.anyOf === undefined && schema.oneOf === undefined) {
    throw new Error(`${file}: schema has no recognizable validation keyword`)
  }
  schemas.push({ file, schema })
}

const ids = new Map()
for (const { file, schema } of schemas) {
  if (ids.has(schema.$id)) throw new Error(`${file}: duplicate $id ${schema.$id}`)
  ids.set(schema.$id, file)
}

const knownIds = new Set(ids.keys())
const refs = new Set()
const visit = (value) => {
  if (!value || typeof value !== 'object') return
  if (typeof value.$ref === 'string') refs.add(value.$ref)
  for (const child of Object.values(value)) visit(child)
}
for (const { schema } of schemas) visit(schema)
for (const ref of refs) {
  if (ref.startsWith('https://luckread.com/contracts/v1/common/') && !knownIds.has(ref)) {
    throw new Error(`Unresolved common schema reference: ${ref}`)
  }
}

console.log(`Contract CI GREEN: ${schemas.length} common schemas structurally validated; ${refs.size} references resolved.`)
