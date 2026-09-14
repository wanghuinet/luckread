#!/usr/bin/env node
/**
 * Capability Contract Graph validator v1.
 *
 * Source of truth: docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md
 * Registry: contracts/capability/capability-contract-graph.v1.json
 *
 * Fail closed: every Feature ID found in the Blueprint must have exactly one
 * registry record. The registry must not contain unknown Feature IDs.
 * This validator intentionally does not infer API/DB mappings from code.
 * Missing mappings remain failures until explicitly contracted.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const blueprintPath = path.join(root, 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md');
const registryPath = path.join(root, 'contracts/capability/capability-contract-graph.v1.json');

const blueprint = fs.readFileSync(blueprintPath, 'utf8');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

// Feature IDs are contract identifiers, not a hard-coded list of domains.
// Keeping this generic prevents the validator from silently accepting a new
// domain merely because its prefix was not added to this script.
const featurePattern = /\b[A-Z][A-Z0-9_]*-\d{3}\b/g;
const blueprintIds = [...new Set(blueprint.match(featurePattern) ?? [])].sort();
const records = Array.isArray(registry.features) ? registry.features : [];
const registryIds = records.map((r) => r?.featureId).filter(Boolean);

const duplicate = [...new Set(registryIds.filter((id, i) => registryIds.indexOf(id) !== i))].sort();
const missing = blueprintIds.filter((id) => !registryIds.includes(id));
const unknown = registryIds.filter((id) => !blueprintIds.includes(id)).sort();
const malformed = records
  .map((record, index) => ({ record, index }))
  .filter(({ record }) => !record || typeof record !== 'object' || !record.featureId)
  .map(({ index }) => `record[${index}]`);

const result = {
  contractVersion: '1.0',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  registry: 'contracts/capability/capability-contract-graph.v1.json',
  blueprintFeatureCount: blueprintIds.length,
  registryFeatureCount: registryIds.length,
  duplicateFeatureIds: duplicate,
  missingFeatureIds: missing,
  unknownFeatureIds: unknown,
  malformedRecords: malformed,
  status: duplicate.length || missing.length || unknown.length || malformed.length ? 'FAIL' : 'PASS'
};

console.log(JSON.stringify(result, null, 2));

if (result.status !== 'PASS') process.exitCode = 1;
