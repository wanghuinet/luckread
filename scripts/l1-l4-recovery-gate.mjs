#!/usr/bin/env node
/**
 * R2.5 historical L1-L4 recovery gate.
 *
 * The recovered hierarchy is evidence only. This gate verifies that the
 * deterministic parser can recover explicit hierarchy from the archived
 * fourth-level matrix without synthesizing missing levels or Feature IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const parser = path.join(root, 'scripts/recover-l1-l4-hierarchy.mjs');
const output = path.join(root, 'contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json');

execFileSync(process.execPath, [parser], { stdio: 'inherit' });
const result = JSON.parse(fs.readFileSync(output, 'utf8'));
const counts = result.counts ?? {};
const gaps = Array.isArray(result.unresolvedL4Candidates) ? result.unresolvedL4Candidates : [];

const failures = [];
for (const level of ['L1', 'L2', 'L3', 'L4']) {
  if (!Number.isInteger(counts[level]) || counts[level] <= 0) failures.push(`missing recovered ${level} nodes`);
}
if (gaps.length > 0) failures.push(`unresolved L4 candidates: ${gaps.length}`);
if (result.status !== 'RECOVERED_NON_AUTHORITATIVE') failures.push(`unexpected recovery status: ${result.status}`);

const report = {
  gate: 'R2.5-L1-L4-HISTORICAL-RECOVERY',
  source: result.source,
  parser: result.parser,
  counts,
  unresolvedL4Candidates: gaps.length,
  status: failures.length ? 'BLOCKED' : 'READY_FOR_CROSSWALK',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
