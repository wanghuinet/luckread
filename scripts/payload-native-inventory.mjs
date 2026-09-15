import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const configPath = path.join(root, 'src', 'payload.config.ts')
const collectionsDir = path.join(root, 'src', 'collections')
const outputPath = path.join(root, 'contracts', 'payload', 'payload-native-inventory.v1.json')

const blocked = (message) => {
  throw new Error(`PAYLOAD_NATIVE_DISCOVERY_BLOCKED: ${message}`)
}

const literal = (node, label) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  blocked(`${label} must be a static literal`)
}

const property = (object, name) => object.properties.find((p) =>
  ts.isPropertyAssignment(p) && ((ts.isIdentifier(p.name) && p.name.text === name) || (ts.isStringLiteral(p.name) && p.name.text === name))
)

const objectLiteral = (node, label) => {
  if (!ts.isObjectLiteralExpression(node)) blocked(`${label} must be a static object literal`)
  return node
}

const parseCollection = (sourceFile, exportName) => {
  const source = fs.readFileSync(sourceFile, 'utf8')
  const file = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = file.statements.find((statement) =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => d.name.getText(file) === exportName)
  )
  if (!declaration || !ts.isVariableStatement(declaration)) blocked(`${sourceFile} does not contain a discoverable ${exportName} variable`)

  const variable = declaration.declarationList.declarations.find((d) => d.name.getText(file) === exportName)
  if (!variable?.initializer) blocked(`${sourceFile}:${exportName} has no initializer`)
  const config = objectLiteral(variable.initializer, `${sourceFile}:${exportName}`)

  const slugProperty = property(config, 'slug')
  const authProperty = property(config, 'auth')
  const fieldsProperty = property(config, 'fields')
  if (!slugProperty || !ts.isPropertyAssignment(slugProperty)) blocked(`${sourceFile}:${exportName} has no static slug`)
  if (!fieldsProperty || !ts.isPropertyAssignment(fieldsProperty)) blocked(`${sourceFile}:${exportName} has no static fields array`)

  const slug = literal(slugProperty.initializer, `${sourceFile}:${exportName}.slug`)
  const auth = authProperty && ts.isPropertyAssignment(authProperty) ? Boolean(literal(authProperty.initializer, `${sourceFile}:${exportName}.auth`)) : false

  if (!ts.isArrayLiteralExpression(fieldsProperty.initializer)) blocked(`${sourceFile}:${exportName}.fields must be a static array; spreads/helpers are not admitted`)

  const fields = fieldsProperty.initializer.elements.map((element, index) => {
    const field = objectLiteral(element, `${sourceFile}:${exportName}.fields[${index}]`)
    const nameProperty = property(field, 'name')
    const typeProperty = property(field, 'type')
    if (!nameProperty || !ts.isPropertyAssignment(nameProperty)) blocked(`${sourceFile}:${exportName}.fields[${index}] has no static name`)
    if (!typeProperty || !ts.isPropertyAssignment(typeProperty)) blocked(`${sourceFile}:${exportName}.fields[${index}] has no static type`)

    const name = literal(nameProperty.initializer, `${sourceFile}:${exportName}.fields[${index}].name`)
    const type = literal(typeProperty.initializer, `${sourceFile}:${exportName}.fields[${index}].type`)
    const item = {
      name,
      type,
      sourceRef: `${path.relative(root, sourceFile)}:field:${name}`,
      classification: 'PAYLOAD_CONFIG_DISCOVERED',
    }

    for (const key of ['required', 'unique']) {
      const p = property(field, key)
      if (p && ts.isPropertyAssignment(p)) item[key] = Boolean(literal(p.initializer, `${sourceFile}:${exportName}.fields[${index}].${key}`))
    }

    const defaultProperty = property(field, 'defaultValue')
    if (defaultProperty && ts.isPropertyAssignment(defaultProperty)) item.defaultValue = literal(defaultProperty.initializer, `${sourceFile}:${exportName}.fields[${index}].defaultValue`)

    return item
  })

  return {
    slug,
    sourceRef: `${path.relative(root, sourceFile)}:${exportName}`,
    auth,
    fields,
  }
}

const config = fs.readFileSync(configPath, 'utf8')
const configFile = ts.createSourceFile(configPath, config, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const imports = []
for (const statement of configFile.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
  const moduleName = statement.moduleSpecifier.text
  if (!moduleName.startsWith('./collections/')) continue
  const bindings = statement.importClause?.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) blocked(`collection import ${moduleName} must use a named import`)
  for (const element of bindings.elements) imports.push({ exportName: element.name.text, moduleName: moduleName.slice('./collections/'.length) })
}
if (!imports.length) blocked('no statically discoverable collection imports in src/payload.config.ts')

const collections = imports.map(({ exportName, moduleName }) => {
  const sourceFile = path.join(collectionsDir, `${moduleName}.ts`)
  if (!fs.existsSync(sourceFile)) blocked(`missing collection source ${sourceFile}`)
  return parseCollection(sourceFile, exportName)
})

const inventory = {
  version: '1.0.0',
  status: 'DISCOVERED',
  source: 'TypeScript AST of src/payload.config.ts + statically imported collection configs',
  generatedBy: 'scripts/payload-native-inventory.mjs',
  collections,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`)
console.log(`Payload native inventory generated: ${collections.length} collection(s), ${collections.reduce((n, c) => n + c.fields.length, 0)} field(s)`)
