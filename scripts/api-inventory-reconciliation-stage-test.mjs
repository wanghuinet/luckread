#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checker = path.join(root, 'scripts', 'api-inventory-reconciliation-check.mjs');
const reportPath = path.join(root, 'artifacts', 'api-inventory', 'reconciliation-report.json');

function runStage(stage) {
  try {
    execFileSync(process.execPath, [checker, `--stage=${stage}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0 };
  } catch (error) {
    return { exitCode: Number.isInteger(error.status) ? error.status : 1 };
  }
}
function readReport(expectedStage) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.stage, expectedStage);
  assert.equal(report.schemaVersion, '1.3.0');
  return report;
}

const contractRun = runStage('contract');
assert.equal(contractRun.exitCode, 0, 'current API inventory must pass structural contract reconciliation');
const contractReport = readReport('CONTRACT');
assert.equal(contractReport.status, 'PASS');
assert.equal(contractReport.contractStatus, 'PASS');
assert.equal(contractReport.productionReadinessStatus, 'INCOMPLETE',
  'contract structure must not imply production evidence is complete');

const expectedPushEvidenceGaps = ['deletePushEndpoint', 'upsertPushEndpoint'];
const contractPushGaps = contractReport.productionEvidenceFindings
  .filter((item) => expectedPushEvidenceGaps.includes(item.operationId) && item.detail === 'securityE2E')
  .map((item) => item.operationId).sort();
assert.deepEqual(contractPushGaps, expectedPushEvidenceGaps,
  'both push endpoint operations must retain their missing live security E2E evidence');

const productionRun = runStage('production');
assert.notEqual(productionRun.exitCode, 0, 'production stage must remain blocked until evidence is complete');
const productionReport = readReport('PRODUCTION');
assert.equal(productionReport.status, 'INCOMPLETE');
assert.equal(productionReport.productionReadinessStatus, 'INCOMPLETE');
const productionPushGaps = productionReport.productionEvidenceFindings
  .filter((item) => expectedPushEvidenceGaps.includes(item.operationId) && item.detail === 'securityE2E')
  .map((item) => item.operationId).sort();
assert.deepEqual(productionPushGaps, expectedPushEvidenceGaps);

console.log(JSON.stringify({
  stageSeparation: 'PASS',
  contractStatus: contractReport.contractStatus,
  productionReadinessStatus: productionReport.productionReadinessStatus,
  pushSecurityEvidenceGaps: expectedPushEvidenceGaps,
}, null, 2));
