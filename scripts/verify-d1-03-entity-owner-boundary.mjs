#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const contract = JSON.parse(
  readFileSync(resolve(root, 'contracts/transport/d1-03-entity-owner-boundary.v1.json'), 'utf8'),
)
const allowed = new Set(['W06', 'W09', 'W10', 'W11'])
const owners = contract.owners ?? {}

if (contract.domain !== 'D1-03') throw new Error('Expected D1-03 owner contract')
if (contract.topology?.workerCount !== 12 || contract.topology?.d1Count !== 5 || contract.topology?.taskCount !== 25) {
  throw new Error('D1-03 owner contract topology drift')
}

const seen = new Map()
for (const [worker, entities] of Object.entries(owners)) {
  if (!allowed.has(worker)) throw new Error(`D1-03 owner ${worker} is outside the canonical D1-03 owner set`)
  if (!Array.isArray(entities) || entities.length === 0) throw new Error(`D1-03 owner ${worker} has no entity list`)
  for (const entity of entities) {
    if (seen.has(entity)) throw new Error(`D1-03 entity ${entity} has multiple primary owners`)
    seen.set(entity, worker)
  }
}
if (contract.crossCutting?.AuditEvent?.owner !== 'W09') {
  throw new Error('AuditEvent must have exactly one cross-cutting D1-03 owner')
}
if (seen.has('AuditEvent')) throw new Error('AuditEvent must not also appear in ordinary owner lists')

const pushDelegation = contract.scopedDelegations?.NotificationPushEndpoint
if (
  seen.get('NotificationPushEndpoint') !== 'W09' ||
  pushDelegation?.primaryOwner !== 'W09' ||
  pushDelegation?.primaryTask !== 'T25' ||
  pushDelegation?.delegatedWriter !== 'W05' ||
  pushDelegation?.delegatedTask !== 'T14' ||
  !Array.isArray(pushDelegation.allowedOperations) ||
  pushDelegation.allowedOperations.length !== 2 ||
  !pushDelegation.allowedOperations.includes('PUT /v1/push/endpoints/{installationId}') ||
  !pushDelegation.allowedOperations.includes('DELETE /v1/push/endpoints/{installationId}')
) {
  throw new Error('NotificationPushEndpoint must remain W09-owned with only the explicit W05/T14 self-service writer delegation')
}

for (const rule of contract.boundaryRules ?? []) {
  if (typeof rule !== 'string' || rule.length === 0) throw new Error('Invalid D1-03 boundary rule')
}

console.log('D1_03_ENTITY_OWNER_BOUNDARY=PASS')
console.log(JSON.stringify({
  entityOwners: Object.fromEntries(seen),
  auditEventOwner: contract.crossCutting.AuditEvent.owner,\n  notificationPushEndpointOwner: seen.get('NotificationPushEndpoint'),\n  notificationPushEndpointDelegatedWriter: pushDelegation.delegatedWriter,
}, null, 2))
