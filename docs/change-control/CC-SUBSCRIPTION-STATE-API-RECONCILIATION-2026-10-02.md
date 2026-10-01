# Change Control: Subscription State / API / Permission Reconciliation — 2026-10-02

- Change Control ID: `CC-SUBSCRIPTION-STATE-API-RECONCILIATION-2026-10-02`
- Status: `CONTRACT-FIRST / ADMITTED / IMPLEMENTATION-BLOCKED`
- Repository authority: GitHub `main` baseline `ede42217a90cfdc0592a6be2ece636ea84b23a40`
- Backup: `backup/batch-20261002-before-subscription-state-api`
- Work branch: `codex/subscription-state-api-contract-20261002`

## Reconciliation completed

Existing Membership contracts already define pause/resume/change-plan behavior. The machine-readable layer was incomplete.

This slice now aligns:

- `contracts/state-machines/subscription.json`
  - adds the explicit `PAUSED` state;
  - adds ACTIVE → PAUSED and PAUSED → ACTIVE transitions;
  - keeps CANCELED/EXPIRED terminal;
  - records the pause/resume source contracts.
- `contracts/authz/permissions.json`
  - adds `subscription.pause`;
  - adds `subscription.resume`;
  - adds `subscription.change_plan`;
  - all require own scope, L2 minimum layer and audit.
- `contracts/openapi/v1/operation-policy.json`
  - binds create/cancel/pause/resume/change-plan to the Subscription state machine, required permissions, audit, optimistic locking and idempotency.
- `contracts/api/rc-04-06-share-subscription-entitlement.v1.json`
  - admits canonical pause/resume/change-plan operation IDs and wire paths.
- `contracts/openapi/v1/openapi.yaml`
  - admits the three previously missing lifecycle endpoints.
- `docs/113-MEMBERSHIP-PERMISSION-AND-SECURITY-CONTRACT-v1.0.md`
  - reconciles the subscriber permission vocabulary.

## Important boundary

This is contract reconciliation only.

Still blocked:

- W07 runtime implementation;
- D1-01 physical Subscription persistence;
- cross-D1 payment → membership authority transition;
- entitlement runtime;
- subscription E2E;
- Evidence Registry PASS / GREEN.

No new Worker, D1, Payload Collection or infrastructure is introduced.

## Open semantic boundary

`PAUSED` is introduced only as the machine-readable counterpart of the existing Membership pause/resume capability. Trial, renewal scheduling details, proration, and payment-provider runtime behavior remain governed by their respective Membership/Commerce contracts and are not invented here.

## Next gate

```
Subscription plan/entity mapping
→ physical D1-01 persistence contract
→ W07 scoped runtime authority
→ entitlement transition
→ runtime/E2E/evidence
```
