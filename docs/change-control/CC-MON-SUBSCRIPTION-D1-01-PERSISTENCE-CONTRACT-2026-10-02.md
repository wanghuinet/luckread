# Change Control: Subscription D1-01 Persistence Contract — 2026-10-02

- Change Control ID: `CC-MON-SUBSCRIPTION-D1-01-PERSISTENCE-CONTRACT-2026-10-02`
- Status: `CONTRACT-FIRST / ADMITTED / IMPLEMENTATION-BLOCKED`
- Stack base: `PR #399` head `5ac3afee64d85d615fb34c0ca2c3859dac848ab4`
- Backup: `backup/batch-20261002-before-subscription-persistence`
- Work branch: `codex/subscription-persistence-contract-20261002`

## Scope

Define the logical D1-01 persistence contract for the already-admitted `ENT-SUBSCRIPTION` entity.

## Canonical authority

- D1-01 remains Subscription/access-state authority.
- W07 remains the T16 Subscription business-workflow owner.
- D1-04 remains payment/order/financial authority.
- No second Subscription authority is introduced.

## Persistence binding

New contract:

`contracts/persistence/SUBSCRIPTION-D1-01-persistence.v1.json`

Logical table:

`membership_subscriptions`

It binds the existing 13 `ENT-SUBSCRIPTION` fields to D1-01 and defines query indexes without creating a physical migration.

## Deliberately unresolved

1. Optimistic concurrency: the current entity field contract has no standalone version field, so the exact If-Match/version source is still pending.
2. Active-subscription uniqueness: the existing Membership Data Contract requires duplicate prevention where policy requires it, but does not define the authoritative business key. No speculative unique constraint is introduced.

## Non-actions

- no D1 migration;
- no remote schema execution;
- no Worker runtime handler;
- no new Worker/D1/Payload Collection;
- no cross-D1 foreign key;
- no GREEN promotion.

## Next gate

```
Resolve concurrency version source + active-subscription uniqueness policy
→ physical binding/migration admission
→ W07 runtime admission
→ subscription/entitlement E2E
→ Evidence Registry
```
