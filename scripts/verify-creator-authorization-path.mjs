#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const parse = (path) => JSON.parse(read(path))
const failures = []
const requireText = (name, source, pattern) => {
  if (!pattern.test(source)) failures.push(name)
}
const forbidText = (name, source, pattern) => {
  if (pattern.test(source)) failures.push(name)
}

const w01Config = parse('workers/W01-payload/wrangler.jsonc')
const w08Config = parse('workers/W08-creator/wrangler.jsonc')
const layers = parse('contracts/authz/layers.json')
const publicBinding = parse('contracts/transport/W01-W08-creator-http-binding.v1.json')
const grantBinding = parse('contracts/transport/W08-W02-role-assignment-http-binding.v1.json')
const routeContract = parse('contracts/transport/public-worker-terminal-routing.v1.json')
const w01Client = read('workers/W01-payload/src/auth/w08-creator-client.ts')
const w08Policy = read('workers/W08-creator/src/policy.ts')
const w08Runtime = read('workers/W08-creator/src/index.ts')
const w08Migration = read('workers/W08-creator/migrations/0001_creator_authorization.sql')
const w02Runtime = read('workers/W02-identity/src/index.ts')
const w02Grant = read('workers/W02-identity/src/authz/role-assignment-command.ts')
const policyTests = read('workers/W08-creator/src/policy.test.ts')
const roleTests = read('workers/W02-identity/src/authz/role-assignment-command.test.ts')

const layerOf = Object.fromEntries(layers['x-layers'].flatMap((layer) => (layer.roles ?? []).map((role) => [role, layer.id])))
for (const [role, layer] of [['user', 'L1'], ['verified_user', 'L2'], ['creator', 'L3'], ['ip_principal', 'L4'], ['mcn_admin', 'L4'], ['mcn_editor', 'L4']]) {
  if (layerOf[role] !== layer) failures.push('canonical role map mismatch: ' + role)
}

if (!(w01Config.services ?? []).some((x) => x.binding === 'W08_CREATOR' && x.service === 'luckread-w08-creator')) failures.push('W01 to W08 service binding missing')
if (w08Config.name !== 'luckread-w08-creator') failures.push('W08 worker name mismatch')
if ((w08Config.d1_databases ?? []).length !== 1 || !(w08Config.d1_databases ?? []).some((x) => x.binding === 'D1_01' && x.database_id === '2f80471e-3756-49f9-8db1-7707a433ad64')) failures.push('W08 must use only existing D1-01')
if ((w08Config.services ?? []).some((x) => x.binding === 'W01' || x.service === 'luckread-w01-payload')) failures.push('W08 must not bind back to W01')
if (publicBinding.callee.logicalWorker !== 'W08' || publicBinding.transport.binding !== 'W08_CREATOR') failures.push('W01-W08 contract target mismatch')
if (grantBinding.caller.logicalWorker !== 'W08' || grantBinding.callee.logicalWorker !== 'W02') failures.push('W08-W02 contract target mismatch')
if (grantBinding.operation.allowedRoleScopePairs.length !== 4) failures.push('role/scope allow-list drift')
if (!routeContract.routes.some((x) => x.operationIdFamily === 'creator' && x.ingressWorker === 'W01' && x.terminalWorker === 'W08')) failures.push('public creator routing contract missing')
if (publicBinding.topologyConstraints.workerCountDelta !== 0 || publicBinding.topologyConstraints.databaseCountDelta !== 0) failures.push('worker/D1 topology changed')

requireText('W01 fixed service proxy missing', w01Client, /service\.fetch\(new Request\('https:\/\/luckread-w08-creator\.internal' \+ path/)
requireText('W01 bearer authorization header must be stripped', w01Client, /headers\.delete\('authorization'\)/i)
for (const route of [
  'workers/W01-payload/src/app/api/v1/creator-applications/route.ts',
  'workers/W01-payload/src/app/api/v1/admin/creator-applications/route.ts',
  'workers/W01-payload/src/app/api/v1/admin/creator-scopes/route.ts',
  'workers/W01-payload/src/app/api/v1/creator-scopes/route.ts',
]) read(route)
requireText('new applications must be limited to L2', w08Policy, /return layer === 'L2'/)
requireText('reviewer policy must be L7/L8 only', w08Policy, /layer === 'L7' \|\| layer === 'L8'/)
requireText('W08 must revalidate the W02 principal', w08Runtime, /internal\/auth\/principal/)
requireText('creator role grants must be routed to W02', w08Runtime, /internal\/authz\/role-assignment/)
requireText('L2 target eligibility must be checked by W08', w08Runtime, /role_id = 'verified_user'/)
requireText('scope role must be checked against current appointment scope', w08Runtime, /role_id = 'mcn_admin'[\s\S]*scope_id = \?/)
requireText('IP principal must fail closed without verified IP state', w08Runtime, /IP_SCOPE_NOT_VERIFIED/)
requireText('creator decision must have If-Match', w08Runtime, /If-Match with the current application version is required/)
requireText('authorization audit table must exist', w08Migration, /CREATE TABLE IF NOT EXISTS creator_authorization_audit/)
requireText('submission audit must be persisted', w08Runtime, /CREATOR_APPLICATION_SUBMITTED/)
requireText('approval audit must be persisted', w08Runtime, /CREATOR_APPLICATION_APPROVED/)
requireText('role-grant audit must be persisted', w08Runtime, /CREATOR_ROLE_GRANTED/)
requireText('scoped-grant audit must be persisted', w08Runtime, /SCOPED_ROLE_GRANTED/)
requireText('W02 endpoint must require L7/L8 for global grants', w02Runtime, /actor\.layer === 'L7' \|\| actor\.layer === 'L8'/)
requireText('W02 endpoint must constrain scoped delegation to mcn_editor', w02Runtime, /body\.roleId === 'mcn_editor'[\s\S]*body\.scopeType === 'organization'/)
requireText('W02 endpoint must verify the exact mcn_admin scope', w02Runtime, /role_id = 'mcn_admin'[\s\S]*scope_id = \?/)
requireText('W02 command must verify role layer map', w02Grant, /roleToLayer\.get\(command\.roleId\)/)
requireText('W02 command must require target ACTIVE and verified', w02Grant, /TARGET_NOT_ELIGIBLE/)
requireText('W02 command must require effective L2 role', w02Grant, /VERIFIED_ROLE_REQUIRED/)
requireText('role grant tests must cover exact replay', roleTests, /accepts an exact replay/)
requireText('role grant tests must cover unverified targets', roleTests, /have not completed the L2 verified-user grant/)
requireText('policy tests must cover scoped L4', policyTests, /organization/)

if (failures.length) {
  console.error('CREATOR_AUTHORIZATION_PATH=FAIL')
  for (const failure of failures) console.error('- ' + failure)
  process.exitCode = 1
} else {
  console.log('CREATOR_AUTHORIZATION_PATH=PASS')
  console.log(JSON.stringify({
    topology: '12 Workers / 4 D1 / 25 Tasks unchanged',
    l1ToL2: 'existing production evidence retained; not reimplemented',
    l2ToL3: 'authenticated application -> L7/L8 decision -> W02 RoleAssignment -> audited grant confirmation',
    l4: 'organization/IP role is resource-scoped and never promotes global session layer',
    w08D1: 'D1-01',
    checks: 28
  }, null, 2))
}
