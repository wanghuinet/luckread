#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const catalog = read('contracts/entity/entity-catalog.v1.json');
const contract = read('contracts/entity/entity-field-contract.v1.json');
const failures = [];
const catalogById = new Map((catalog.records ?? []).map((r) => [r.entityId, r]));
const seen = new Set();

if (!/^1\.\d+$/.test(String(contract.version ?? ''))) failures.push(`unsupported contract version: ${contract.version}`);
if (contract.sourceOfTruth !== 'contracts/entity/entity-catalog.v1.json') failures.push('sourceOfTruth mismatch');

const statusCompatible = (catalogStatus, contractStatus) => {
  if (catalogStatus === 'VERIFIED') return contractStatus === 'VERIFIED';
  if (catalogStatus === 'PROPOSED') return contractStatus === 'PROPOSED' || contractStatus === 'CONTRACTED_NOT_VERIFIED';
  return contractStatus === catalogStatus;
};

for (const r of contract.records ?? []) {
  if (!catalogById.has(r.entityId)) failures.push(`unknown entity: ${r.entityId}`);
  if (seen.has(r.entityId)) failures.push(`duplicate entity: ${r.entityId}`);
  seen.add(r.entityId);

  const catalogEntity = catalogById.get(r.entityId);
  if (catalogEntity && !statusCompatible(catalogEntity.status, r.status)) {
    failures.push(`entity status mismatch: ${r.entityId} (${r.status} vs ${catalogEntity.status})`);
  }

  const fieldIds = new Set();
  const fieldNames = new Set();
  for (const f of r.fields ?? []) {
    const baseKeys = ['fieldId', 'name', 'type', 'nullable', 'status'];
    const verifiedKeys = ['lifecycle', 'classification', 'payloadNative', 'sourceRef', 'payloadConfigRef', 'apiExposure', 'adminExposure', 'eventExposure', 'migrationVersion', 'postgresqlPortability', 'evidenceRefs'];
    for (const k of baseKeys) if (f[k] === undefined) failures.push(`${r.entityId}.${f.name || f.fieldId || 'unknown'} missing ${k}`);
    if (r.status === 'VERIFIED') {
      for (const k of verifiedKeys) if (f[k] === undefined) failures.push(`${r.entityId}.${f.name || f.fieldId || 'unknown'} missing ${k}`);
    }

    if (fieldIds.has(f.fieldId)) failures.push(`duplicate fieldId: ${r.entityId}.${f.fieldId}`);
    fieldIds.add(f.fieldId);
    if (fieldNames.has(f.name)) failures.push(`duplicate field name: ${r.entityId}.${f.name}`);
    fieldNames.add(f.name);

    if (r.status === 'VERIFIED' && typeof f.payloadNative !== 'boolean') {
      failures.push(`${r.entityId}.${f.name}: payloadNative must be boolean`);
    }
    if (f.status === 'VERIFIED' && (!Array.isArray(f.evidenceRefs) || f.evidenceRefs.length === 0)) {
      failures.push(`verified field lacks evidence: ${r.entityId}.${f.name}`);
    }

    const sensitive = ['CREDENTIAL', 'SECRET', 'PASSWORD', 'TOKEN', 'SECURITY'];
    if (sensitive.some((x) => String(f.classification).toUpperCase().includes(x)) && String(f.apiExposure).toUpperCase().startsWith('PUBLIC')) {
      failures.push(`${r.entityId}.${f.name}: sensitive field cannot be public`);
    }
    if (f.payloadNative === true && (!f.sourceRef || !f.payloadConfigRef)) {
      failures.push(`${r.entityId}.${f.name}: native Payload field requires concrete config/source evidence`);
    }
    if (String(f.migrationVersion).toUpperCase() === 'VERIFIED' && (!Array.isArray(f.evidenceRefs) || f.evidenceRefs.length === 0)) {
      failures.push(`${r.entityId}.${f.name}: verified migration requires evidence`);
    }
  }

  if (r.status === 'VERIFIED' && (!(r.fields ?? []).length || !(r.evidenceRefs ?? []).length)) {
    failures.push(`verified entity lacks fields/evidence: ${r.entityId}`);
  }
}

for (const r of catalog.records ?? []) {
  if (!seen.has(r.entityId)) failures.push(`missing field contract: ${r.entityId}`);
}

const result = {
  gate: 'ENTITY-FIELD-CONTRACT',
  entityCount: catalog.records?.length ?? 0,
  contractCount: contract.records?.length ?? 0,
  status: failures.length ? 'BLOCKED' : 'READY',
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
