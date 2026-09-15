import fs from 'node:fs';

const root = process.cwd();
const sourcePath = 'contracts/payload/payload-native-inventory.v1.json';
const outPath = 'contracts/alignment/payload-inventory.v1.json';

const fail = (message) => {
  console.error(`PAYLOAD_ALIGNMENT_BLOCKED: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(sourcePath)) fail(`missing ${sourcePath}; run payload:native:inventory first`);
const inventory = JSON.parse(fs.readFileSync(`${root}/${sourcePath}`, 'utf8'));
if (!['DISCOVERED'].includes(inventory.status)) fail(`Payload inventory status is ${inventory.status}`);
if (!Array.isArray(inventory.collections)) fail('Payload collections are not an array');

const records = [];
const collectionNames = new Set();
for (const collection of inventory.collections) {
  if (collectionNames.has(collection.slug)) fail(`duplicate Payload collection '${collection.slug}'`);
  collectionNames.add(collection.slug);
  const fields = [];
  const fieldNames = new Set();
  for (const field of collection.fields ?? []) {
    if (fieldNames.has(field.name)) fail(`duplicate Payload field '${collection.slug}.${field.name}'`);
    fieldNames.add(field.name);
    fields.push({
      name: field.name,
      type: field.type,
      sourceRef: field.sourceRef,
      origin: field.classification === 'PAYLOAD_CONFIG_DISCOVERED' ? 'PAYLOAD_CONFIG_DISCOVERED' : 'UNRESOLVED',
      ...(field.required !== undefined ? { required: field.required } : {}),
      ...(field.unique !== undefined ? { unique: field.unique } : {}),
      ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
      ...(field.hasAccess !== undefined ? { hasAccess: field.hasAccess } : {}),
    });
  }
  records.push({
    collection: collection.slug,
    collectionSourceRef: collection.sourceRef,
    origin: 'PAYLOAD_CONFIG_DISCOVERED',
    auth: Boolean(collection.auth),
    fields,
    sourceRefs: [sourcePath, collection.sourceRef],
  });
}

records.sort((a, b) => a.collection.localeCompare(b.collection));
const output = {
  version: '1.0.0',
  status: 'NOT_GREEN',
  sourceOfTruth: sourcePath,
  generatedBy: 'scripts/build-payload-alignment-inventory.mjs',
  records,
};
fs.writeFileSync(`${root}/${outPath}`, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Payload alignment inventory: ${records.length} collections discovered`);
