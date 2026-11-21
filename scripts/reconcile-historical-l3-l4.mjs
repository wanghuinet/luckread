import fs from 'node:fs';

const l3Path = 'contracts/capability/recovery/l3-historical-hierarchy.parsed.json';
const l4Path = 'contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json';
const outPath = 'contracts/capability/recovery/l3-l4-historical-crosswalk.v1.json';

const l3 = JSON.parse(fs.readFileSync(l3Path, 'utf8'));
const l4 = JSON.parse(fs.readFileSync(l4Path, 'utf8'));

const l3Nodes = l3.nodes.filter((n) => n.level === 'L3');
const l2Nodes = l3.nodes.filter((n) => n.level === 'L2');
const l4Nodes = l4.nodes.filter((n) => n.level === 'L4');
const l1Nodes = l3.nodes.filter((n) => n.level === 'L1');

const key = (n) => `${n.l1}::${n.l2}`;
const unique = (arr) => new Set(arr.map(key)).size === arr.length;
const l2Keys = new Set(l2Nodes.map(key));
const orphanL3 = l3Nodes.filter((n) => !l2Keys.has(key(n)));
const l4ParentKeys = new Set(l4Nodes.map((n) => `${n.l1}::${n.l2}::${n.l3}`));
const l3Keys = new Set(l3Nodes.map((n) => `${n.l1}::${n.l2}::${n.l3}`));
const orphanL4 = l4Nodes.filter((n) => !l3Keys.has(`${n.l1}::${n.l2}::${n.l3}`));
const duplicateL3 = l3Nodes.length - new Set(l3Nodes.map((n) => `${n.l1}::${n.l2}::${n.l3}`)).size;
const duplicateL4 = l4Nodes.length - new Set(l4Nodes.map((n) => `${n.l1}::${n.l2}::${n.l3}::${n.l4}`)).size;

const result = {
  version: '1.0',
  status: 'RECOVERY_RECONCILIATION_BLOCKED',
  authority: 'recovery-input-only',
  sources: {
    l3: l3Path,
    l4: l4Path,
    l3SourceBlobSha: l3.sourceBlobSha,
    l4SourcePath: l4.source
  },
  counts: {
    L1: l1Nodes.length,
    L2: l2Nodes.length,
    L3: l3Nodes.length,
    L4: l4Nodes.length
  },
  integrity: {
    l2UniqueWithinParent: unique(l2Nodes),
    orphanL3: orphanL3.length,
    orphanL4: orphanL4.length,
    duplicateL3,
    duplicateL4,
    l4ParentCoverage: l4ParentKeys.size
  },
  admission: {
    featureCrosswalkAllowed: false,
    reason: l3Nodes.length === 0 ? 'No explicit L3 nodes recovered; do not infer L3/L4.' : (l4Nodes.length === 0 ? 'No explicit L4 nodes recovered; do not infer L4.' : 'Historical hierarchy requires reconciliation before admission.')
  },
  rules: [
    'Do not synthesize L3 or L4 nodes.',
    'Do not map Blueprint Feature IDs by name similarity.',
    'Historical hierarchy is evidence only until reconciled with Blueprint 2.0.',
    'Any orphan, duplicate, or missing parent is blocking.'
  ]
};

fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result));
if (result.admission.featureCrosswalkAllowed) process.exit(1);
