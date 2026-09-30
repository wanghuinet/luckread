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

const refreshMatch = openapi.match(
  /^  \/auth\/refresh:\s*\n([\s\S]*?)(?=^  \/auth\/revoke:\s*$)/m,
)
const refreshBlock = refreshMatch?.[1] ?? ''

const hasOpenApiRefreshPath = refreshMatch !== null
const hasOpenApiRefreshOperation = /operationId:\s*authRefresh\b/.test(refreshBlock)
const hasDiscoveryDraftStatus =
  /x-luckread-contract-status:\s*DISCOVERY_DRAFT\b/.test(refreshBlock)
const hasUndefinedSummary = /summary:\s*Discovery draft for POST undefined/.test(refreshBlock)
const hasConcreteRequestBody = /^      requestBody:\s*$/m.test(refreshBlock)
const hasConcreteSuccessResponse = /^        ['"]?2\d\d['"]?:\s*$/m.test(refreshBlock)
const refreshRouteAdmitted =
  hasOpenApiRefreshPath &&
  hasOpenApiRefreshOperation &&
  !hasDiscoveryDraftStatus &&
  !hasUndefinedSummary &&
  hasConcreteRequestBody &&
  hasConcreteSuccessResponse

const row = crosscheck.rows.find((item) => item.operationId === 'authRefresh')
const historicalCrosscheckClaimsOpenApi = row?.openapiExactlyOnce === true

const wireSchemaComplete = refreshRouteAdmitted

const report = {
  version: '1.1.0',
  generatedBy: 'scripts/auth-011-wire-authority-consistency-audit.mjs',
  scope: 'AUTH-011 authRefresh API/OpenAPI authority consistency',
  status: hasInventoryRefresh && !wireSchemaComplete
    ? 'DRIFT_CONFIRMED'
    : 'NO_DRIFT_OR_UNEXPECTED_STATE',
  current: {
    apiInventoryRequiredPath: 'POST /v1/auth/refresh',
    apiInventoryContainsRefresh: hasInventoryRefresh,
    canonicalOpenApiContainsRefreshPath: hasOpenApiRefreshPath,
    canonicalOpenApiContainsRefreshOperationId: hasOpenApiRefreshOperation,
    canonicalOpenApiRefreshContractStatus: hasDiscoveryDraftStatus
      ? 'DISCOVERY_DRAFT'
      : hasOpenApiRefreshPath
        ? 'NON_DRAFT_STATUS_REQUIRES_REVIEW'
        : 'ABSENT',
    canonicalOpenApiRefreshSummaryIsUndefinedDiscoveryText: hasUndefinedSummary,
    canonicalOpenApiRefreshHasConcreteRequestBody: hasConcreteRequestBody,
    canonicalOpenApiRefreshHasConcreteSuccessResponse: hasConcreteSuccessResponse,
    canonicalOpenApiRefreshWireSchemaComplete: wireSchemaComplete,
    canonicalOpenApiRefreshRouteAdmitted: refreshRouteAdmitted,
  },
  staleEvidence: {
    artifact: 'artifacts/mapping-0/api-dto-four-layer-crosscheck-2026-09-19.json',
    historicalAuthRefreshOpenApiExactlyOnce: historicalCrosscheckClaimsOpenApi,
    conclusion:
      'Historical occurrence evidence must not be treated as current canonical Wire admission. Current OpenAPI presence is a Discovery Draft only.',
  },
  conclusion: hasInventoryRefresh && hasOpenApiRefreshPath && hasOpenApiRefreshOperation && hasDiscoveryDraftStatus
    ? 'Current authority has a /auth/refresh discovery-draft shell, but it does not yet establish the exact canonical request/response/error Wire Schema or admitted operation. AUTH-011 remains blocked.'
    : hasInventoryRefresh && !hasOpenApiRefreshPath
      ? 'Current authority is API Inventory required endpoint only; canonical OpenAPI does not currently define authRefresh.'
      : 'Current state requires review because the expected inventory/OpenAPI relationship differs from the observed state.',
  noInference: true,
  implementationAuthorized: false,
}

console.log(JSON.stringify(report, null, 2))
if (report.status !== 'DRIFT_CONFIRMED') process.exit(1)
