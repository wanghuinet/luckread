import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md');
const output = path.resolve('contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json');

const text = fs.readFileSync(source, 'utf8');
const lines = text.split(/\r?\n/);
const nodes = [];
let currentL1 = null;
let currentL2 = null;
let currentL3 = null;
let order = 0;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (!match) continue;

  const level = match[1].length;
  const name = match[2].replace(/`/g, '').trim();
  if (/^LuckRead Fourth-Level Capability Master Matrix/i.test(name)) continue;
  if (/^Status:/i.test(name)) continue;

  if (level === 2) {
    currentL1 = name;
    currentL2 = null;
    currentL3 = null;
    nodes.push({ order: ++order, level: 'L1', l1: currentL1, l2: null, l3: null, l4: null, sourceLine: index + 1, sourceHeading: name });
  } else if (level === 3 && currentL1) {
    currentL2 = name;
    currentL3 = null;
    nodes.push({ order: ++order, level: 'L2', l1: currentL1, l2: currentL2, l3: null, l4: null, sourceLine: index + 1, sourceHeading: name });
  } else if (level === 4 && currentL1 && currentL2) {
    currentL3 = name;
    nodes.push({ order: ++order, level: 'L3', l1: currentL1, l2: currentL2, l3: currentL3, l4: null, sourceLine: index + 1, sourceHeading: name });
  } else if (level >= 5 && currentL1 && currentL2 && currentL3) {
    nodes.push({ order: ++order, level: 'L4', l1: currentL1, l2: currentL2, l3: currentL3, l4: name, sourceLine: index + 1, sourceHeading: name });
  }
}

const result = {
  version: '1.0',
  status: 'RECOVERED_NON_AUTHORITATIVE',
  source: 'docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md',
  parser: 'scripts/recover-l1-l4-hierarchy.mjs',
  rules: [
    'Parse headings and ordering only; do not infer Feature IDs.',
    'Do not infer hierarchy from feature names, APIs, Payload collections, or database tables.',
    'Historical output is reconciliation evidence only and cannot directly populate the formal Capability Contract Graph.'
  ],
  nodes
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`parsed ${nodes.length} hierarchy headings from ${source}`);
