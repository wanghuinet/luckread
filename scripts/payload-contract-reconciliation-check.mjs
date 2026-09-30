#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const inventory = read('contracts/payload/payload-native-inventory.v1.json')
const catalog = read('contracts/entity/entity-catalog.v1.json')
const fieldContract = read('contracts/entity/entity-field-contract.v1.json')
const supportExemptions = read('contracts/payload/payload-support-collection-exemptions.v1.json')
const outputPath = path.join(root, 'contracts/payload/payload-contract-reconciliation.v1.json')

const failures = []
const results = []
const catalogBySource = new Map()
for (const entity of catalog.records) {
  if (entity.implementationRef) catalogBySource.set(entity.implementationRef, entity)
}

const supportExemptionBySource = new Map(
  (supportExemptions.collections ?? []).map((item) => [item.sourceRef, item]),
)

for (const collection of inventory.collections) {
  const exemption = supportExemptionBySource.get(collection.sourceRef)
  if (exemption) {
    results.push({
      entityId: 'EXEMPT',
      collection: collection.slug,
      status: 'EXEMPT',
      classification: exemption.classification,
      fields: collection.fields.map((f) => ({
        name: f.name,
        status: 'EXEMPT',
        details: [exemption.reason],
      })),
    })
    continue
  }

  const entity = catalogBySource.get(collection.sourceRef.split(':').slice(0, -1).join(':'))
  if (!entity) {
    results.push({ entityId: 'UNKNOWN', collection: collection.slug, status: 'UNKNOWN', fields: collection.fields.map((f) => ({ name: f.name, status: 'UNKNOWN', details: ['collection source has no exact Entity implementationRef mapping'] })) })
    failures.push(`unmapped Payload collection: ${collection.sourceRef}`)
    continue
  }

  const contractRecord = fieldContract.records.find((r) => r.entityId === entity.entityId)
  if (!contractRecord) {
    results.push({ entityId: entity.entityId, collection: collection.slug, status: 'UNKNOWN', fields: collection.fields.map((f) => ({ name: f.name, status: 'UNKNOWN', details: ['entity has no field contract record'] })) })
    failures.push(`missing field contract: ${entity.entityId}`)
    continue
  }

  const discoveredByName = new Map(collection.fields.map((f) => [f.name, f]))
  // Only fields explicitly admitted as Payload-native are reconciled against
  // the discovered Payload configuration. Contracted domain fields with
  // payloadNative=false are authoritative outside Payload (for example,
  // AUTH-013 account lifecycle state owned by W02/D1-01).
  const contractedByName = new Map(
    contractRecord.fields
      .filter((f) => f.payloadNative !== false)
      .map((f) => [f.name, f]),
  )
  const fieldResults = []

  for (const discovered of collection.fields) {
    const contracted = contractedByName.get(discovered.name)
    if (!contracted) {
      fieldResults.push({ name: discovered.name, status: 'EXTRA', details: ['Payload configuration field is absent from the Entity field contract'] })
      failures.push(`EXTRA Payload field: ${entity.entityId}.${discovered.name}`)
      continue
    }

    const drift = []
    if (contracted.type !== discovered.type) drift.push(`type ${contracted.type} != ${discovered.type}`)
    if (Boolean(contracted.required) !== Boolean(discovered.required)) drift.push(`required ${Boolean(contracted.required)} != ${Boolean(discovered.required)}`)
    if (Boolean(contracted.unique) !== Boolean(discovered.unique)) drift.push(`unique ${Boolean(contracted.unique)} != ${Boolean(discovered.unique)}`)
    if (Object.prototype.hasOwnProperty.call(discovered, 'defaultValue') && contracted.defaultValue !== discovered.defaultValue) drift.push(`defaultValue ${JSON.stringify(contracted.defaultValue)} != ${JSON.stringify(discovered.defaultValue)}`)
    if (contracted.sourceRef !== discovered.sourceRef.split(':field:')[0]) drift.push(`sourceRef ${contracted.sourceRef} != ${discovered.sourceRef.split(':field:')[0]}`)

    // Payload inventory records a field as `:field:<name>` while the Entity field
    // contract intentionally records the canonical config path as `:fields.<name>`.
    // Normalize the generated inventory reference before comparing the two forms.
    const normalizedPayloadConfigRef = discovered.sourceRef.replace(':field:', ':fields.')
    if (contracted.payloadConfigRef !== normalizedPayloadConfigRef) drift.push(`payloadConfigRef ${contracted.payloadConfigRef} != ${normalizedPayloadConfigRef}`)

    if (drift.length) {
      fieldResults.push({ name: discovered.name, status: 'DRIFT', details: drift })
      failures.push(`DRIFT Payload field: ${entity.entityId}.${discovered.name}: ${drift.join('; ')}`)
    } else {
      fieldResults.push({ name: discovered.name, status: 'MATCH' })
    }
  }

  for (const contracted of contractRecord.fields) {
    if (contracted.payloadNative === false) {
      fieldResults.push({
        name: contracted.name,
        status: 'NON_PAYLOAD',
        details: ['Entity field is contractually authoritative outside Payload; Payload reconciliation is not applicable'],
      })
      continue
    }

    if (!discoveredByName.has(contracted.name)) {
      fieldResults.push({ name: contracted.name, status: 'MISSING', details: ['Entity field contract declares a Payload-native field absent from the discovered Payload configuration'] })
      failures.push(`MISSING Payload field: ${entity.entityId}.${contracted.name}`)
    }
  }

  const status = fieldResults.some((f) => f.status === 'CONFLICT') ? 'CONFLICT' : fieldResults.some((f) => ['MISSING', 'EXTRA', 'DRIFT', 'UNKNOWN'].includes(f.status)) ? 'DRIFT' : 'MATCH'
  results.push({ entityId: entity.entityId, collection: collection.slug, status, fields: fieldResults })
}

const report = {
  version: '1.0.0',
  status: failures.length ? 'BLOCKED' : 'GREEN',
  source: 'Payload discovered inventory + Entity catalog + Entity field contract',
  results,
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ gate: 'PAYLOAD-CONTRACT-RECONCILIATION', status: report.status, failures, results }, null, 2))
if (failures.length) process.exitCode = 1
