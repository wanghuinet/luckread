# Change Control — Membership Subscription API / Entity Binding — 2026-10-01

- Status: CONTRACT-FIRST / VERIFICATION-PENDING
- Repository authority: GitHub main
- Work branch: work/social-follow-subscription-20261001

## Scope

Bind the already-existing Subscription / Entitlement API surface to the frozen Membership domain model:

- createSubscription -> ENT-SUBSCRIPTION + ENT-MEMBERSHIP-PLAN
- cancelSubscription -> ENT-SUBSCRIPTION
- getSubscription -> ENT-SUBSCRIPTION
- getEntitlements -> ENT-ENTITLEMENT-GRANT
- checkEntitlement -> ENT-ENTITLEMENT-GRANT

Existing canonical API contract remains:
contracts/api/rc-04-06-share-subscription-entitlement.v1.json

## Reused authorities

- Entity model: contracts/entity/MEMBERSHIP-SUBSCRIPTION-FOUNDATION.v1.json
- DTO: contracts/dto/MEMBERSHIP-SUBSCRIPTION-DTO.v1.json
- Binding: contracts/api/MEMBERSHIP-SUBSCRIPTION-ENTITY-BINDING.v1.json
- Permission authority: contracts/authz/permissions.json

## Architecture boundary

- No new Worker.
- No new D1 database.
- No new Task.
- No Payload Collection.
- No payment or ledger duplication into Subscription/Entitlement.
- Creator Center remains a derived read surface.
- Subscription state remains server-authoritative.
- Plan version is retained for historical semantics.

## Verification boundary

This change does not claim:

- W07 runtime GREEN
- D1 migration execution
- remote persistence evidence
- payment-provider E2E
- entitlement fail-closed runtime evidence
- concurrency/security E2E
- Evidence Registry completion

## Next gate

W07 implementation admission -> controlled persistence migration -> runtime/security/concurrency evidence -> payment reconciliation -> Evidence Registry reconciliation.
