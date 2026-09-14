import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('docs/archive/1.0-reuse/RECOVERED-35-THIRD-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md');
const output = path.resolve('contracts/capability/recovery/l3-historical-hierarchy.parsed.json');

const text = fs.readFileSync(source, 'utf8');
const lines = text.split(/\r?\n/);
const nodes = [];
let currentL1 = null;
let currentL2 = null;
let order = 0;

for (let index = 0; index < lines.length; index += 1) {
  const raw = lines[index];
  const line = raw.trim();
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    const name = heading[2].replace(/`/g, '').trim();
    if (/^LuckRead Third-Level Capability Master Matrix/i.test(name)) continue;
    if (/^Status:/i.test(name)) continue;
    if (level === 1) {
      currentL1 = name;
      currentL2 = null;
      nodes.push({ order: ++order, level: 'L1', l1: currentL1, l2: null, l3: null, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading' });
    } else if (level === 2 && currentL1) {
      currentL2 = name;
      nodes.push({ order: ++order, level: 'L2', l1: currentL1, l2: currentL2, l3: null, sourceLine: index + 1, sourceHeading: name, sourceType: 'heading' });
    }
    continue;
  }

  const bullet = line.match(/^[-*+]\s+(.+)$/);
  if (bullet && currentL1 && currentL2) {
    nodes.push({ order: ++order, level: 'L3', l1: currentL1, l2: currentL2, l3: bullet[1].trim(), sourceLine: index + 1, sourceHeading: null, sourceType: 'bullet' });
  }
}

const counts = nodes.reduce((acc, node) => {
  acc[node.level] = (acc[node.level] ?? 0) + 1;
  return acc;
}, { L1: 0, L2: 0, L3: 0 });

const result = {
  version: '1.0',
  status: 'RECOVERED_NON_AUTHORITATIVE',
  source: 'docs/archive/1.0-reuse/RECOVERED-35-THIRD-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md',
  sourceBlobSha: 'd76dddaea13746acd01dd6d65f627676ed7ebe95',
  parser: 'scripts/recover-l3-hierarchy.mjs',
  rules: [
    'Parse explicit Markdown L1/L2 headings and L3 bullet ordering only; do not infer Feature IDs.',
    'Do not infer hierarchy from feature names, APIs, Payload collections, or database tables.',
    'Historical output is reconciliation evidence only and cannot directly populate the formal Capability Contract Graph.'
  ],
  counts,
  nodes
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`recovered L3 hierarchy nodes=${nodes.length}`);
