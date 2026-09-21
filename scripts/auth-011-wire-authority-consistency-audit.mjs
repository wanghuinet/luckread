import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const openapiPath = resolve(root, 'contracts/openapi/v1/openapi.yaml')
const inventoryPath = resolve(root, 'contracts/api/api-inventory.v1.json')
const crosscheckPath = resolve(root, 'artifacts/mapping-0/api-dto-four-layer-crosscheck-2026-09-19.json')

const openapi = readFileSync(openapiPath, 'utf8')
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const crosscheck = JSON.parse(readFileSync(crosscheckPath, 'utf8'))

const inventoryText = JSON.stringify(inventory)
const hasInventoryRefresh = inventoryText.includes('POST /v1/auth/refresh')
const hasOpenApiRefreshPath = /^  \/auth\/refresh:\s*$/m.test(openapi)
const hasOpenApiRefreshOperation = /operationId:\s*authRefresh\b/.test(openapi)

const row = crosscheck.rows.find((item) => item.operationId === 'authRefresh')
const historicalCrosscheckClaimsOpenApi = row?.openapiExactlyOnce === true

const report = {
  version: '1.0.0',
  generatedBy: 'scripts/auth-011-wire-authority-consistency-audit.mjs',
  scope: 'AUTH-011 authRefresh API/OpenAPI authority consistency',
  status: hasInventoryRefresh && !hasOpenApiRefreshPath && !hasOpenApiRefreshOperation
    ? 'DRIFT_CONFIRMED'
    : 'NO_DRIFT_OR_UNEXPECTED_STATE',
  current: {
    apiInventoryRequiredPath: 'POST /v1/auth/refresh',
    apiInventoryContainsRefresh: hasInventoryRefresh,
    canonicalOpenApiContainsRefreshPath: hasOpenApiRefreshPath,
    canonicalOpenApiContainsRefreshOperationId: hasOpenApiRefreshOperation
  },
  staleEvidence: {
    artifact: 'artifacts/mapping-0/api-dto-four-layer-crosscheck-2026-09-19.json',
    historicalAuthRefreshOpenApiExactlyOnce: historicalCrosscheckClaimsOpenApi
  },
  conclusion: hasInventoryRefresh && !hasOpenApiRefreshPath && !hasOpenApiRefreshOperation
    ? 'Current authority is API Inventory required endpoint only; canonical OpenAPI does not currently define authRefresh. The historical four-layer crosscheck is stale for this fact and must not be used to claim OpenAPI admission.'
    : 'Current state requires review because the expected inventory/OpenAPI relationship differs from the observed state.',
  noInference: true,
  implementationAuthorized: false
}

console.log(JSON.stringify(report, null, 2))
if (report.status !== 'DRIFT_CONFIRMED') process.exit(1)
