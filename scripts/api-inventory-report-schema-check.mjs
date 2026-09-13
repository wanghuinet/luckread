#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportPath = path.join(root, 'artifacts', 'api-inventory', 'reconciliation-report.json');
const schemaPath = path.join(root, 'contracts', 'api', 'api-inventory-reconciliation.schema.json');
const errors = [];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { errors.push(`${path.relative(root, file)}: invalid JSON: ${error.message}`); return null; }
}

const report = readJson(reportPath);
const schema = readJson(schemaPath);
if (!report || !schema) process.exit(1);

const required = ['schemaVersion','generatedAt','status','reconciliationGreen','inventoryCount','openapiPolicyCount','failureCount','findingCount','failures','findings','rule'];
for (const key of required) if (!(key in report)) errors.push(`missing report property: ${key}`);
if (report.schemaVersion !== '1.2.0') errors.push(`schemaVersion=${report.schemaVersion}`);
if (!['PASS','INCOMPLETE','CONFLICT'].includes(report.status)) errors.push(`invalid status=${report.status}`);
if (typeof report.reconciliationGreen !== 'boolean') errors.push('reconciliationGreen must be boolean');
for (const key of ['inventoryCount','openapiPolicyCount','failureCount','findingCount']) if (!Number.isInteger(report[key]) || report[key] < 0) errors.push(`${key} must be a non-negative integer`);
for (const key of ['failures','findings']) if (!Array.isArray(report[key])) errors.push(`${key} must be an array`);
if (Array.isArray(report.failures) && report.failureCount !== report.failures.length) errors.push('failureCount does not equal failures.length');
if (Array.isArray(report.findings) && report.findingCount !== report.findings.length) errors.push('findingCount does not equal findings.length');
if (report.status === 'PASS' && (report.reconciliationGreen !== true || report.failureCount !== 0 || report.findingCount !== 0)) errors.push('PASS invariant violated');
if (report.reconciliationGreen === true && report.status !== 'PASS') errors.push('reconciliationGreen=true requires PASS');
if (!schema || schema.$id !== 'https://luckread.com/contracts/v1/api/api-inventory-reconciliation.schema.json') errors.push('unexpected reconciliation schema identity');

for (const finding of Array.isArray(report.findings) ? report.findings : []) {
  if (!finding?.code || typeof finding.code !== 'string') errors.push('finding missing string code');
  if (!('operationId' in finding)) errors.push('finding missing operationId');
  if (!('detail' in finding) || typeof finding.detail !== 'string') errors.push('finding missing string detail');
}

if (errors.length) {
  console.error(JSON.stringify({ schemaCheck: 'FAIL', errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ schemaCheck: 'PASS', report: reportPath, schema: schemaPath }, null, 2));
