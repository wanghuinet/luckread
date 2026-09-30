#!/usr/bin/env node
/**
 * Deterministic Feature -> L1/L2/L3/L4 crosswalk.
 *
 * Only exact normalized name equality is eligible for MATCH. No similarity,
 * fuzzy matching, semantic inference, Feature-ID invention, or API/DB inference
 * is permitted. Unmatched features remain UNRESOLVED and require explicit
 * reconciliation evidence.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const blueprintPath = path.join(root, 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md');
const hierarchyPath = path.join(root, 'contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json');
const outputPath = path.join(root, 'contracts/capability/recovery/feature-l1-l4-exact-crosswalk.v1.json');

const normalize = (value) => value
  .toLowerCase()
  .replace(/[“”"'`]/g, '')
  .replace(/[\/]/g, ' ')
  .replace(/[-–—]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const blueprint = fs.readFileSync(blueprintPath, 'utf8').split(/\r?\n/);
const features = [];
let currentL1 = null;
for (let i = 0; i < blueprint.length; i += 1) {
  const line = blueprint[i].trim();
  const heading = line.match(/^###\s+(.+)$/);
  if (heading) {
    currentL1 = heading[1].trim();
    continue;
  }
  const feature = line.match(/^-\s+([A-Z][A-Z0-9]+-\d+)\s+(.+)$/);
  if (feature && currentL1) {
    features.push({ featureId: feature[1], name: feature[2].trim(), l1: currentL1, sourceLine: i + 1 });
  }
}

const recovered = JSON.parse(fs.readFileSync(hierarchyPath, 'utf8'));
const l4 = (recovered.nodes ?? []).filter((node) => node.level === 'L4' && node.l4);
const byName = new Map();
for (const node of l4) {
  const key = normalize(node.l4);
  const list = byName.get(key) ?? [];
  list.push(node);
  byName.set(key, list);
}

const records = features.map((feature) => {
  const matches = byName.get(normalize(feature.name)) ?? [];
  if (matches.length === 1) {
    const node = matches[0];
    return {
      featureId: feature.featureId,
      name: feature.name,
      hierarchy: { l1: node.l1, l2: node.l2, l3: node.l3, l4: node.l4 },
      evidence: {
        rule: 'EXACT_NORMALIZED_NAME_MATCH',
        blueprintSourceLine: feature.sourceLine,
        historicalSourceLine: node.sourceLine,
        historicalSourceType: node.sourceType
      },
      reconciliationState: 'MATCH',
      admissionState: 'MATCH'
    };
  }
  if (matches.length > 1) {
    return {
      featureId: feature.featureId,
      name: feature.name,
      hierarchy: { l1: feature.l1, l2: null, l3: null, l4: null },
      evidence: { rule: 'EXACT_NORMALIZED_NAME_MATCH', candidateCount: matches.length },
      reconciliationState: 'DUPLICATE',
      admissionState: null
    };
  }
  return {
    featureId: feature.featureId,
    name: feature.name,
    hierarchy: { l1: feature.l1, l2: null, l3: null, l4: null },
    evidence: { rule: 'NO_EXACT_HISTORICAL_MATCH' },
    reconciliationState: 'UNRESOLVED',
    admissionState: null
  };
});

const counts = records.reduce((acc, record) => {
  acc[record.reconciliationState] = (acc[record.reconciliationState] ?? 0) + 1;
  return acc;
}, {});

const result = {
  version: '1.0',
  status: 'RECOVERY_CANDIDATE_ONLY',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  historicalSource: 'contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json',
  rules: [
    'Only exact normalized Feature name to historical L4 equality can produce MATCH.',
    'No fuzzy, similarity, semantic, API, database, Payload, or Feature-ID inference.',
    'Duplicate historical matches are not admitted.',
    'UNRESOLVED records require explicit reconciliation evidence before admission.',
    'Historical hierarchy remains non-authoritative.'
  ],
  counts,
  records
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: result.status, featureCount: records.length, counts }, null, 2));
