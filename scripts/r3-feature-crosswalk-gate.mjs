#!/usr/bin/env node
/**
 * R3 admission gate for the deterministic Feature -> L1/L2/L3/L4 crosswalk.
 *
 * The crosswalk is a recovery candidate until every Blueprint feature has an
 * explicit, non-duplicate historical match or an explicit reviewed decision.
 * No inference is allowed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const builder = path.join(root, 'scripts/build-feature-l1-l4-exact-crosswalk.mjs');
const output = path.join(root, 'contracts/capability/recovery/feature-l1-l4-exact-crosswalk.v1.json');

execFileSync(process.execPath, [builder], { stdio: 'inherit' });
const result = JSON.parse(fs.readFileSync(output, 'utf8'));
const counts = result.counts ?? {};
const unresolved = Number(counts.UNRESOLVED ?? 0);
const duplicate = Number(counts.DUPLICATE ?? 0);
const matched = Number(counts.MATCH ?? 0);
const featureCount = Number(result.records?.length ?? 0);

const failures = [];
if (featureCount <= 0) failures.push('Blueprint contains no recoverable Feature records');
if (unresolved > 0) failures.push(`unresolved Feature mappings: ${unresolved}`);
if (duplicate > 0) failures.push(`duplicate historical mappings: ${duplicate}`);
if (matched + unresolved + duplicate !== featureCount) failures.push('crosswalk counts do not reconcile');
if (result.status !== 'RECOVERY_CANDIDATE_ONLY') failures.push(`unexpected crosswalk status: ${result.status}`);

const report = {
  gate: 'R3-FEATURE-L1-L4-EXACT-CROSSWALK',
  featureCount,
  counts,
  status: failures.length ? 'BLOCKED' : 'READY_FOR_REVIEWED_ADMISSION',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
