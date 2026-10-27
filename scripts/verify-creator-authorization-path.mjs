#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const parse = (path) => JSON.parse(read(path))
const failures = []
const requireText = (name, source, pattern) => { if (!pattern.test(source)) failures.push(name) }

const w01Config = parse('workers/W01-payload/wrangler.jsonc')
const w08Config = parse('workers/W08-creator/wrangler.jsonc')
const layers = parse('contracts/authz/layers.json')
const authzPermissions = parse('contracts/authz/permissions.json')
const publicBinding = parse('contracts/transport/W01-W08-creator-http-binding.v1.json')
const grantBinding = parse('contracts/transport/W08-W02-role-assignment-http-binding.v1.json')
const routeContract = parse('contracts/transport/public-worker-terminal-routing.v1.json')
const inventory = parse('contracts/api/api-inventory.v1.json')
const w01Client = read('workers/W01-payload/src/auth/w08-creator-client.ts')
const membershipPlanRoute = read('workers/W01-payload/src/app/api/v1/membership/plans/route.ts')
const w06ModerationClient = read('workers/W01-payload/src/moderation/w06-moderation-client.ts')
const w06Runtime = read('workers/W06-governance/src/index.ts')
const w08Casl = read('workers/W08-creator/src/authz/casl-policy.ts')
const w08AuthzHandler = read('workers/W08-creator/src/authz/handler.ts')
const w08RoleLayer = read('workers/W08-creator/src/authz/role-layer.ts')
const w08Runtime = read('workers/W08-creator/src/worker.ts')
const w08Migration = read('workers/W08-creator/migrations/0001_creator_authorization.sql')
const w02Runtime = read('workers/W02-identity/src/index.ts')
const w02Grant = read('workers/W02-identity/src/authz/role-assignment-command.ts')
const applicationUi = read('workers/W01-payload/src/app/(frontend)/creator-application/CreatorApplicationClient.tsx')
const reviewPage = read('workers/W01-payload/src/app/(frontend)/creator-review/page.tsx')
const reviewUi = read('workers/W01-payload/src/app/(frontend)/creator-review/CreatorReviewClient.tsx')
const creatorPage = read('workers/W01-payload/src/app/(frontend)/creator-center/page.tsx')

const roleMap = Object.fromEntries(layers['x-layers'].flatMap((item) => (item.roles ?? []).map((role) => [role, item.id])))
for (const [role, layer] of [['user','L1'],['verified_user','L2'],['creator','L3']]) {
  if (roleMap[role] !== layer) failures.push('canonical role map mismatch: '+role)
}
if (!(w01Config.services ?? []).some((x) => x.binding === 'W08_CREATOR' && x.service === 'luckread-w08-creator')) failures.push('W01 W08 service binding missing')
if (w08Config.name !== 'luckread-w08-creator') failures.push('W08 worker name mismatch')
if ((w08Config.d1_databases ?? []).length !== 1 || !(w08Config.d1_databases ?? []).some((x) => x.binding === 'D1_01')) failures.push('W08 must use only existing D1-01')
if ((w08Config.services ?? []).some((x) => x.binding === 'W01' || x.service === 'luckread-w01-payload')) failures.push('W08 must not bind back to W01')
if (publicBinding.callee.logicalWorker !== 'W08' || publicBinding.transport.binding !== 'W08_CREATOR') failures.push('W01-W08 contract target mismatch')
if (grantBinding.caller.logicalWorker !== 'W08' || grantBinding.callee.logicalWorker !== 'W02') failures.push('W08-W02 contract target mismatch')
if (grantBinding.operation.allowedRoleScopePairs.length !== 1 || grantBinding.operation.allowedRoleScopePairs[0]?.roleId !== 'creator') failures.push('W08-W02 must admit only global L3 creator grants')
if (routeContract.topology.workerCount !== 12 || routeContract.topology.d1Count !== 5 || routeContract.topology.taskCount !== 25) failures.push('12 Worker / 4 D1 / 25 Task topology drift')
const creatorRoute = routeContract.routes.find((x) => x.operationIdFamily === 'creator')
if (!creatorRoute || creatorRoute.ingressWorker !== 'W01' || creatorRoute.terminalWorker !== 'W08') failures.push('public creator routing contract missing')
if (creatorRoute?.publicPaths.some((x) => x.includes('creator-scopes'))) failures.push('out-of-stage L4 public routes remain')
if (inventory.domains.creator_ip_mcn.endpoint_groups.some((x) => x.includes('creator-scopes'))) failures.push('out-of-stage creator-scope routes remain in API inventory')

requireText('fixed W08 service proxy missing', w01Client, /service\.fetch\(new Request\('https:\/\/luckread-w08-creator\.internal' \+ path/)
const expectedCreatorProxyPaths = [
  '/api/v1/creator-applications',
  '/api/v1/creator-applications/me',
  '/api/v1/admin/creator-applications',
  '/api/v1/admin/creator-applications/decision',
  '/internal/creator/self',
  '/internal/authz/check-permission',
]
for (const path of expectedCreatorProxyPaths) {
  if (!w01Client.includes("'"+path+"'")) failures.push('W01 W08 proxy path missing: '+path)
}
if (w01Client.includes('creator-scopes')) failures.push('W01 W08 proxy must not expose out-of-stage creator-scope paths')
if (!w01Client.includes('const pathname = path.split(/[?#]/, 1)[0]')) failures.push('W01 W08 proxy must match exact pathnames while preserving query strings')
if (/headers\.delete\(['"]authorization['"]\)/i.test(w01Client)) {
  failures.push('W01 W08 proxy must preserve the canonical browser-cookie or native Bearer credential for W02 validation')
}
requireText('W01 W08 proxy must copy the incoming session headers', w01Client, /const headers = new Headers\(request\.headers\)/)
if (/headers\.delete\(['"]authorization['"]\)/i.test(w08Runtime)) {
  failures.push('W08 creator routes must forward the session credential to W02 for validation')
}
if (/headers\.delete\(['"]authorization['"]\)/i.test(w08AuthzHandler)) {
  failures.push('W08 CASL endpoint must forward the session credential to W02 for validation')
}
requireText('new creator applications must use CASL L2-only authorization', w08Runtime, /evaluateCreatorApplicationPermission\(principal, 'creator\.application\.apply'/)
requireText('applicant status reads must use own-scope CASL authorization', w08Runtime, /evaluateCreatorApplicationPermission\(principal, 'creator\.application\.read\.own'/)
requireText('reviewer endpoints must use CASL L7/L8 authorization', w08Runtime, /evaluateCreatorApplicationPermission\(principal, 'creator\.application\.review'/)
requireText('W08 must serve the private CASL permission endpoint', w08Runtime, /internal\/authz\/check-permission/)
requireText('CASL policy must model creator applications', w08Casl, /'CreatorApplication'/)
const canonicalPermissionNames = new Set((authzPermissions['x-permissions'] ?? []).map((permission) => permission.name))
for (const match of w08Casl.matchAll(/\bgrant\('([^']+)'/g)) {
  if (!canonicalPermissionNames.has(match[1])) failures.push('CASL action missing from canonical permission catalog: '+match[1])
}
requireText('shared authorization context must resolve persisted D1 role assignments', w08RoleLayer, /FROM role_assignments/)
requireText('internal CASL endpoint must reject caller-supplied layer or state', w08AuthzHandler, /CALLER_SUPPLIED_AUTHORIZATION_CONTEXT/)
if (!w08AuthzHandler.includes('/internal/auth/principal')) failures.push('internal CASL endpoint must resolve actor identity through W02 session binding')
if (!w08AuthzHandler.includes("new Set(['action', 'resourceType', 'resourceAttributes'])")) failures.push('internal CASL endpoint must not accept body-supplied subjectId')
requireText('W08 must independently resolve the W02 principal', w08Runtime, /internal\/auth\/principal/)
requireText('W08 must return only an ACTIVE creator identity for creator plan management', w08Runtime, /handleActiveCreatorSelf[\s\S]*creator\.read\.self[\s\S]*status = 'ACTIVE'/)
requireText('MembershipPlan is a CASL subject and own-scope plan permissions are granted', w08Casl, /'MembershipPlan'[\s\S]*membership\.plan\.create\.own[\s\S]*membership\.plan\.read\.own/)
requireText('creator plan creation must use existing W06 binding for durable audit', membershipPlanRoute, /callW06MembershipPlanAudit[\\s\\S]*Membership plan audit was not durably confirmed/)
requireText('W01 must wait for W06 durable confirmation before returning plan success', membershipPlanRoute, /Membership plan audit was not durably confirmed[\\s\\S]*return w07Response/)
requireText('W01 W06 client must use the fixed membership plan audit path', w06ModerationClient, /\/internal\/audit-events\/membership-plan-created/)
requireText('W06 membership plan audit endpoint must require W01 transport', w06Runtime, /membership-plan-created[\\s\\S]*requireW01Transport/)

requireText('W08 must call the W02 RoleAssignment authority', w08Runtime, /internal\/authz\/role-assignment/)
requireText('W08 must persist submission, decision and grant audit', w08Runtime, /CREATOR_APPLICATION_SUBMITTED[\s\S]*CREATOR_APPLICATION_APPROVED[\s\S]*CREATOR_ROLE_GRANTED/)
requireText('creator audit table must exist', w08Migration, /CREATE TABLE IF NOT EXISTS creator_authorization_audit/)
requireText('W02 must authorize the current approver', w02Runtime, /mayApproveRoleGrant\(actor\.layer\)/)
requireText('W02 endpoint must reject role/scope escalation', w02Runtime, /body\.roleId !== 'creator' \|\| body\.scopeType !== 'global' \|\| body\.scopeId !== null/)
requireText('W02 must verify role-to-layer mapping', w02Grant, /roleToLayer\.get\(command\.roleId\)/)
requireText('W02 must require active and email-verified target', w02Grant, /TARGET_NOT_ELIGIBLE/)
requireText('W02 must require effective L2 role', w02Grant, /VERIFIED_ROLE_REQUIRED/)
requireText('H5 page must submit through authoritative API', applicationUi, /fetchJson[\s\S]*\/api\/v1\/creator-applications/)
requireText('H5 retries must preserve idempotency key', applicationUi, /Idempotency-Key/)
requireText('creator center requires L3', creatorPage, /principal\.layer !== 'L3'/)
requireText('submission retries must compare allow-listed request data', w08Runtime, /creatorApplicationReplayMatches/)
requireText('self-review and final-state conflicts must fail closed', w08Runtime, /admitCreatorDecision[\s\S]*SELF_APPROVAL_DENIED[\s\S]*DECISION_CONFLICT/)
requireText('one pending application per user must be enforced in D1', w08Migration, /creator_applications_one_pending_per_user/)
requireText('review page must restrict entry to L7/L8', reviewPage, /principal\.layer !== 'L7' && principal\.layer !== 'L8'/)
requireText('review UI must use existing admin API and optimistic locking', reviewUi, /\/api\/v1\/admin\/creator-applications[\s\S]*If-Match[\s\S]*Idempotency-Key/)
requireText('approved grant retries must remain explicit', reviewUi, /重试授权/)

if (failures.length) {
  console.error('CREATOR_AUTHORIZATION_PATH=FAIL')
  for (const failure of failures) console.error('- '+failure)
  process.exitCode=1
} else {
  console.log('CREATOR_AUTHORIZATION_PATH=PASS')
  console.log(JSON.stringify({
    topology:'12 Workers / 4 D1 / 25 Tasks unchanged',
    l2ToL3:'L2 application -> L7/L8 decision -> W02 RoleAssignment -> W08 audited grant confirmation',
    owner:'W08 creator qualification; W02 sole RoleAssignment writer',
    productionE2E:'PENDING until approved controlled deployment and real-user verification'
  },null,2))
}
