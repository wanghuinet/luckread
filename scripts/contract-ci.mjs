import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import Ajv from 'ajv/dist/2020.js'

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
  const schema = JSON.parse(await readFile(path, 'utf8'))
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${file}: must declare JSON Schema Draft 2020-12`)
  }
  if (typeof schema.$id !== 'string' || !schema.$id.startsWith('https://luckread.com/contracts/v1/')) {
    throw new Error(`${file}: invalid or missing $id`)
  }
  schemas.push({ file, schema })
}

const ids = new Set()
for (const { file, schema } of schemas) {
  if (ids.has(schema.$id)) throw new Error(`${file}: duplicate $id ${schema.$id}`)
  ids.add(schema.$id)
}

const ajv = new Ajv({ strict: true, allErrors: true })
for (const { schema } of schemas) ajv.addSchema(schema)
for (const { file, schema } of schemas) {
  try {
    ajv.compile(schema)
  } catch (error) {
    throw new Error(`${file}: schema compilation failed: ${error.message}`)
  }
}

console.log(`Contract CI GREEN: ${schemas.length} common schemas compiled successfully.`)
