import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const output = execFileSync(process.execPath, ['scripts/api-endpoint-registry-check.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const report = JSON.parse(output);
assert.ok(report.inventoryEndpointCount > 0, 'inventory blueprint must contain endpoints');
assert.ok(report.domainOperationCount > 0, 'domain contracts must contain operations');
assert.ok(report.canonicalOpenapiEndpointCount > 0, 'canonical OpenAPI must contain operations');
assert.equal(report.normalization.normalizedPrefix, '/api/v1');
console.log(`Endpoint registry evidence generated: ${report.status}`);
