#!/usr/bin/env node
/** R4 fail-closed registry check. Product mappings must be explicit; this gate never infers them. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const blueprintPath = path.join(root, 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md');
const registryPath = path.join(root, 'contracts/capability/feature-entity-persistence-registry.v1.json');
const schemaPath = path.join(root, 'contracts/capability/feature-entity-persistence-registry.v1.schema.json');

const blueprint = fs.readFileSync(blueprintPath, 'utf8').split(/\r?\n/);
const ids = [];
for (const line of blueprint) {
  const m = line.trim().match(/^-\s+([A-Z][A-Z0-9]+-\d+)\s+.+$/);
  if (m) ids.push(m[1]);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const records = registry.records ?? [];
const failures = [];
const expected = new Set(ids);
const seen = new Set();

if (registry.version !== '1.0') failures.push('registry version mismatch');
if (registry.sourceOfTruth !== schema.properties.sourceOfTruth.const) failures.push('sourceOfTruth mismatch');
for (const record of records) {
  if (seen.has(record.featureId)) failures.push(`duplicate featureId: ${record.featureId}`);
  seen.add(record.featureId);
  if (!expected.has(record.featureId)) failures.push(`unknown featureId: ${record.featureId}`);
  if (record.status !== 'VERIFIED') failures.push(`unverified mapping: ${record.featureId}`);
  if (record.persistenceMode === 'UNKNOWN') failures.push(`unknown persistence mode: ${record.featureId}`);
  if (!Array.isArray(record.entityIds)) failures.push(`entityIds missing: ${record.featureId}`);
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length === 0) failures.push(`evidence missing: ${record.featureId}`);
}
for (const id of expected) if (!seen.has(id)) failures.push(`missing feature mapping: ${id}`);

const report = {
  gate: 'R4-FEATURE-ENTITY-PERSISTENCE',
  blueprintFeatureCount: ids.length,
  registryRecordCount: records.length,
  status: failures.length ? 'BLOCKED' : 'READY',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
