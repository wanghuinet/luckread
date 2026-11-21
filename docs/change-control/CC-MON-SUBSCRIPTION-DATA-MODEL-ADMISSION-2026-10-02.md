# Change Control: MON Membership / Subscription Data-Model Admission — 2026-10-02

- Change Control ID: `CC-MON-SUBSCRIPTION-DATA-MODEL-ADMISSION-2026-10-02`
- Status: `CONTRACT-FIRST / ADMITTED / IMPLEMENTATION-BLOCKED`
- Repository authority: GitHub `main`
- Base main: `16d451420e02ca094fb319ada96969922dd2b0fe`
- Backup branch: `backup/batch-20261002-before-social-subscription`
- Work branch: `codex/mon-subscription-data-contract-20261002`

## Purpose

Close the missing canonical Entity/Field contract for the existing `ENT-SUBSCRIPTION` entity using the already-approved Membership capability/data contracts. This slice does not authorize runtime code, migration, or a new database.

## Existing authority

`ENT-SUBSCRIPTION` is already present in the canonical Entity Catalog as a D1-01 entity. The D1 master defines subscription/access state as D1-01 authority, while W07 owns T16 Subscription workflow execution with only explicitly scoped D1-01 transition authority.

## Admitted data model

Canonical persisted fields are now defined in:

`contracts/entity/SUBSCRIPTION-ENTITY-CONTRACT.v1.json`

and registered in:

`contracts/entity/entity-field-contract.v1.json`

Fields:

- `subscriptionId`
- `subscriberId`
- `planId`
- `planVersion`
- `creatorId` (nullable)
- `status`
- `startedAt`
- `currentPeriodStart`
- `currentPeriodEnd`
- `cancelAt` (nullable)
- `entitlementSnapshotRef` (nullable)
- `createdAt`
- `updatedAt`

The capability contract's `startAt` wording is treated as a semantic alias of the data-contract field `startedAt`; no second persisted field is introduced.

## Known contract reconciliation still open

The existing machine-readable Subscription state machine does not yet include `PAUSED`, while Membership contracts and events already define pause/resume behavior. This remains an explicit reconciliation item; this Change Control does not silently add or rename a lifecycle state.

The Membership API contract also describes pause/resume/change-plan operations whose exact machine-readable OpenAPI/permission admission is not yet complete. Those operations remain blocked from runtime implementation until their wire contract is reconciled.

## Mapping effect

The new Entity binding is evidence-backed for:

- `MON-004` trial/subscription lifecycle
- `MON-005` renewal/cancel/pause/resume

These features remain `PARTIAL`, not GREEN, because API/DTO, persistence/physical binding, authorization, runtime, tests and Evidence Registry provenance are still open.

## Non-actions

- No new Entity ID.
- No new Worker.
- No new D1.
- No Payload Collection.
- No migration.
- No runtime handler.
- No entitlement duplication.
- No payment/ledger authority transfer.
- No GREEN promotion.

## Next gate

```
Membership state/API contract reconciliation
→ physical D1-01 persistence contract
→ W07/W02 scoped authority transport
→ runtime implementation admission
→ tests / Evidence Registry
```

The global implementation gate remains authoritative.
