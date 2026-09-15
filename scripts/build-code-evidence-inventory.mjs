import fs from 'node:fs';

const root = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'));
const write = (p, value) => fs.writeFileSync(`${root}/${p}`, `${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => { console.error(`CODE_EVIDENCE_BLOCKED: ${message}`); process.exit(1); };

const entityCatalogPath = 'contracts/entity/entity-catalog.v1.json';
const entityEvidencePath = 'contracts/entity/entity-implementation-evidence.v1.json';
const fieldContractPath = 'contracts/entity/entity-field-contract.v1.json';
const payloadPath = 'contracts/alignment/payload-inventory.v1.json';
const apiPath = 'contracts/alignment/api-inventory.v1.json';
const outPath = 'contracts/alignment/code-evidence-inventory.v1.json';

for (const p of [entityCatalogPath, entityEvidencePath, fieldContractPath, payloadPath, apiPath]) {
  if (!fs.existsSync(`${root}/${p}`)) fail(`missing ${p}`);
}

const entities = read(entityCatalogPath);
const evidence = read(entityEvidencePath);
const fields = read(fieldContractPath);
const payload = read(payloadPath);
const api = read(apiPath);

const evidenceByEntity = new Map((evidence.records ?? []).map((r) => [r.entityId, r]));
const records = [];

for (const entity of entities.entities ?? []) {
  const ev = evidenceByEntity.get(entity.entityId);
  if (!ev) {
    records.push({ evidenceId: `ENTITY:${entity.entityId}`, subjectType: 'ENTITY', subjectId: entity.entityId, implementationStatus: 'UNRESOLVED', implementationRefs: [], testRefs: [], schemaEvidenceRefs: [], sourceRefs: [entityCatalogPath], blockers: ['Missing entity implementation evidence'] });
    continue;
  }
  records.push({
    evidenceId: `ENTITY:${entity.entityId}`,
    subjectType: 'ENTITY',
    subjectId: entity.entityId,
    implementationStatus: ev.implementationStatus ?? 'UNRESOLVED',
    implementationRefs: ev.implementationRefs ?? [],
    testRefs: ev.testEvidenceRefs ?? [],
    schemaEvidenceRefs: ev.schemaEvidenceRefs ?? [],
    sourceRefs: [entityCatalogPath, entityEvidencePath],
    blockers: ev.blockers ?? [],
  });
}

for (const field of fields.fields ?? []) {
  records.push({
    evidenceId: `FIELD:${field.fieldId}`,
    subjectType: 'FIELD',
    subjectId: field.fieldId,
    implementationStatus: field.status === 'VERIFIED' ? 'IMPLEMENTED' : 'UNRESOLVED',
    implementationRefs: field.sourceRef ? [field.sourceRef] : [],
    testRefs: [],
    schemaEvidenceRefs: field.sourceRef ? [field.sourceRef] : [],
    sourceRefs: [fieldContractPath],
    blockers: field.status === 'VERIFIED' && field.sourceRef ? [] : ['Field implementation evidence is incomplete'],
  });
}

for (const collection of payload.records ?? []) {
  records.push({
    evidenceId: `PAYLOAD_COLLECTION:${collection.collection}`,
    subjectType: 'PAYLOAD_COLLECTION',
    subjectId: collection.collection,
    implementationStatus: collection.origin === 'PAYLOAD_CONFIG_DISCOVERED' ? 'IMPLEMENTED' : 'UNRESOLVED',
    implementationRefs: [collection.collectionSourceRef],
    testRefs: [],
    schemaEvidenceRefs: [collection.collectionSourceRef],
    sourceRefs: [payloadPath, collection.collectionSourceRef],
    blockers: collection.origin === 'PAYLOAD_CONFIG_DISCOVERED' ? [] : ['Payload collection origin unresolved'],
  });
  for (const field of collection.fields ?? []) {
    records.push({
      evidenceId: `PAYLOAD_FIELD:${collection.collection}:${field.name}`,
      subjectType: 'PAYLOAD_FIELD',
      subjectId: `${collection.collection}.${field.name}`,
      implementationStatus: field.origin === 'PAYLOAD_CONFIG_DISCOVERED' ? 'IMPLEMENTED' : 'UNRESOLVED',
      implementationRefs: [field.sourceRef],
      testRefs: [],
      schemaEvidenceRefs: [field.sourceRef],
      sourceRefs: [payloadPath, field.sourceRef],
      blockers: field.origin === 'PAYLOAD_CONFIG_DISCOVERED' ? [] : ['Payload field origin unresolved'],
    });
  }
}

for (const operation of api.records ?? []) {
  records.push({
    evidenceId: `API_OPERATION:${operation.operationId}`,
    subjectType: 'API_OPERATION',
    subjectId: operation.operationId,
    implementationStatus: 'UNRESOLVED',
    implementationRefs: [],
    testRefs: [],
    schemaEvidenceRefs: operation.schemaRef ? [operation.schemaRef] : [],
    sourceRefs: operation.sourceRefs ?? [apiPath],
    blockers: ['Runtime API implementation evidence is not yet mechanically discovered'],
  });
}

records.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
write(outPath, {
  version: '1.0.0',
  status: 'NOT_GREEN',
  sourceOfTruth: `${entityCatalogPath} + ${entityEvidencePath} + ${fieldContractPath} + ${payloadPath} + ${apiPath}`,
  generatedBy: 'scripts/build-code-evidence-inventory.mjs',
  records,
});
console.log(`Code evidence inventory: ${records.length} evidence records discovered`);
