#!/usr/bin/env node
/**
 * Blueprint -> Capability Registry reconciliation.
 *
 * This gate is intentionally fail-closed. The Blueprint is the functional
 * source of truth; the Capability Graph is the engineering contract. The
 * validator does not invent L2/L3 hierarchy or API/DB mappings.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const blueprintPath = path.join(root, 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md');
const registryPath = path.join(root, 'contracts/capability/capability-contract-graph.v1.json');

const text = fs.readFileSync(blueprintPath, 'utf8');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const records = Array.isArray(registry.features) ? registry.features : [];

let currentL1 = null;
const blueprint = [];
for (const line of text.split(/\r?\n/)) {
  const heading = line.match(/^###\s+(.+)$/);
  if (heading) currentL1 = heading[1].trim();
  const feature = line.match(/^[-*]\s+([A-Z][A-Z0-9_]+-\d{3,})\s+(.+)$/);
  if (feature) {
    blueprint.push({ featureId: feature[1], name: feature[2].trim(), l1: currentL1 });
  }
}

const byId = new Map();
const duplicateRegistry = [];
for (const record of records) {
  if (!record?.featureId) continue;
  if (byId.has(record.featureId)) duplicateRegistry.push(record.featureId);
  byId.set(record.featureId, record);
}

const blueprintIds = new Set(blueprint.map((x) => x.featureId));
const registryIds = new Set(byId.keys());
const missing = blueprint.filter((x) => !registryIds.has(x.featureId));
const unknown = [...registryIds].filter((id) => !blueprintIds.has(id)).sort();
const hierarchyUnresolved = [];
const mappingUnresolved = [];

for (const item of blueprint) {
  const record = byId.get(item.featureId);
  if (!record) continue;
  const h = record.hierarchy ?? {};
  if (!h.l1 || !h.l2 || !h.l3 || !h.l4 || [h.l1, h.l2, h.l3, h.l4].some((v) => /^UNMAPPED$/i.test(String(v)))) {
    hierarchyUnresolved.push(item.featureId);
  }
  if (!Array.isArray(record.apiOperationIds) || !Array.isArray(record.domainEntityIds) || !Array.isArray(record.persistenceMappingIds)) {
    mappingUnresolved.push(item.featureId);
  }
}

const result = {
  contractVersion: '1.0',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  registry: 'contracts/capability/capability-contract-graph.v1.json',
  blueprintFeatureCount: blueprint.length,
  registryFeatureCount: records.length,
  duplicateRegistryFeatureIds: [...new Set(duplicateRegistry)].sort(),
  missingFeatureIds: missing.map((x) => x.featureId),
  unknownFeatureIds: unknown,
  hierarchyUnresolvedFeatureIds: hierarchyUnresolved.sort(),
  mappingUnresolvedFeatureIds: mappingUnresolved.sort(),
  status: missing.length || unknown.length || duplicateRegistry.length || hierarchyUnresolved.length || mappingUnresolved.length ? 'FAIL' : 'PASS'
};

console.log(JSON.stringify(result, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
