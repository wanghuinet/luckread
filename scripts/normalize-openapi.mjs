#!/usr/bin/env node
import fs from 'node:fs';

const file = 'contracts/openapi/v1/openapi.yaml';
let raw = fs.readFileSync(file, 'utf8');

const licenseBefore = `  license:\n    name: Proprietary`;
const licenseAfter = `  license:\n    name: Proprietary\n    identifier: LicenseRef-LuckRead-Proprietary`;
if (raw.includes(licenseBefore) && !raw.includes('identifier: LicenseRef-LuckRead-Proprietary')) {
  raw = raw.replace(licenseBefore, licenseAfter);
}

const shareBefore = `  /content/{contentId}/shares:\n    post:`;
const shareAfter = `  /content/{contentId}/shares:\n    parameters:\n      - $ref: '#/components/parameters/ContentId'\n    post:`;
if (raw.includes(shareBefore) && !raw.includes(`${shareAfter}\n`)) {
  raw = raw.replace(shareBefore, shareAfter);
}

if (!raw.includes(`${shareAfter}\n`)) {
  throw new Error('canonical OpenAPI share path parameter normalization failed');
}
if (!raw.includes('identifier: LicenseRef-LuckRead-Proprietary')) {
  throw new Error('canonical OpenAPI license normalization failed');
}

fs.writeFileSync(file, raw);
console.log('canonical OpenAPI normalization passed');
