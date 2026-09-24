#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts/entity/entity-field-contract.v1.json'), 'utf8'));
const failures = [];
const baseField = ['fieldId', 'name', 'type', 'nullable', 'status'];
const verifiedField = ['lifecycle', 'classification', 'payloadNative', 'sourceRef', 'payloadConfigRef', 'apiExposure', 'adminExposure', 'eventExposure', 'migrationVersion', 'postgresqlPortability', 'evidenceRefs'];

if (!/^1\.\d+$/.test(String(contract.version ?? ''))) failures.push(`unsupported contract version: ${contract.version}`);

for (const entity of contract.records ?? []) {
  if (!Array.isArray(entity.fields)) failures.push(`${entity.entityId}: fields must be array`);
  for (const field of entity.fields ?? []) {
    for (const key of baseField) {
      if (field[key] === undefined) failures.push(`${entity.entityId}.${field.name ?? field.fieldId}: missing ${key}`);
    }
    if (field.status === 'VERIFIED') {
      for (const key of verifiedField) {
        if (field[key] === undefined) failures.push(`${entity.entityId}.${field.name ?? field.fieldId}: verified field missing ${key}`);
      }
    }
    if (field.status === 'VERIFIED' && (!Array.isArray(field.evidenceRefs) || field.evidenceRefs.length === 0)) {
      failures.push(`${entity.entityId}.${field.name}: missing field evidence`);
    }
  }
}

const result = {
  gate: 'ENTITY-FIELD-SCHEMA-CONTRACT',
  status: failures.length ? 'BLOCKED' : 'PASS',
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
