import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md');
const output = path.resolve('contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json');

const text = fs.readFileSync(source, 'utf8');
const lines = text.split(/\r?\n/);
const nodes = [];
const gaps = [];
let currentL1 = null;
let currentL2 = null;
let currentL3 = null;
let currentL1Line = null;
let currentL2Line = null;
let currentL3Line = null;
let order = 0;

const pushNode = (node) => nodes.push({ order: ++order, ...node });

for (let index = 0; index < lines.length; index += 1) {
  const raw = lines[index];
  const line = raw.trim();
  const heading = line.match(/^(#{1,6})\s+(.+)$/);

  if (heading) {
    const level = heading[1].length;
    const name = heading[2].replace(/`/g, '').trim();

    if (/^LuckRead Fourth-Level Capability Master Matrix/i.test(name)) continue;
    if (/^Status:/i.test(name)) continue;

    if (level === 1) {
      currentL1 = name;
      currentL2 = null;
      currentL3 = null;
      currentL1Line = index + 1;
      currentL2Line = null;
      currentL3Line = null;
      pushNode({ level: 'L1', l1: currentL1, l2: null, l3: null, l4: null, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading' });
    } else if (level === 2 && currentL1) {
      currentL2 = name;
      currentL3 = null;
      currentL2Line = index + 1;
      currentL3Line = null;
      pushNode({ level: 'L2', l1: currentL1, l2: currentL2, l3: null, l4: null, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading' });
    } else if (level === 3 && currentL1 && currentL2) {
      currentL3 = name;
      currentL3Line = index + 1;
      pushNode({ level: 'L3', l1: currentL1, l2: currentL2, l3: currentL3, l4: null, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading' });
    } else if (level >= 4 && currentL1 && currentL2 && currentL3) {
      pushNode({ level: 'L4', l1: currentL1, l2: currentL2, l3: currentL3, l4: name, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading', hierarchyGap: false });
    }
    continue;
  }

  const bullet = line.match(/^[-*+]\s+(.+)$/);
  if (!bullet) continue;

  const name = bullet[1].trim();
  if (!currentL1 || !currentL2) continue;

  if (currentL3) {
    pushNode({ level: 'L4', l1: currentL1, l2: currentL2, l3: currentL3, l4: name, sourceLine: index + 1, sourceHeading: null, sourceType: 'bullet', hierarchyGap: false });
  } else {
    gaps.push({
      sourceLine: index + 1,
      sourceType: 'bullet',
      l1: currentL1,
      l2: currentL2,
      l3: null,
      l4: name,
      parentL1Line: currentL1Line,
      parentL2Line: currentL2Line,
      issue: 'L4 candidate has no explicit L3 heading in the recovered source; no L3 was inferred.'
    });
  }
}

const counts = nodes.reduce((acc, node) => {
  acc[node.level] = (acc[node.level] ?? 0) + 1;
  return acc;
}, { L1: 0, L2: 0, L3: 0, L4: 0 });

const result = {
  version: '1.1',
  status: 'RECOVERED_NON_AUTHORITATIVE',
  source: 'docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md',
  parser: 'scripts/recover-l1-l4-hierarchy.mjs',
  rules: [
    'Parse explicit Markdown hierarchy and bullet ordering only; do not infer Feature IDs.',
    'Markdown #/##/###/#### headings map to L1/L2/L3/L4 respectively.',
    'Bullets under an explicit L3 map to L4.',
    'Bullets under L2 without an explicit L3 are preserved as unresolved L4 candidates; no L3 is inferred.',
    'Do not infer hierarchy from feature names, APIs, Payload collections, or database tables.',
    'Historical output is reconciliation evidence only and cannot directly populate the formal Capability Contract Graph.'
  ],
  counts,
  nodes,
  unresolvedL4Candidates: gaps
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`recovered hierarchy headings=${nodes.length}, unresolvedL4Candidates=${gaps.length}`);
