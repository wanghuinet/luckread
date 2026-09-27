# Change Control — Current Mapping 0 Cursor Supersession / AUTH-003
## 2026-09-27

- Control ID: `CC-MAPPING-0-CURRENT-CURSOR-SUPERSESSION-AUTH-003-2026-09-27`
- Status: `CURRENT CURSOR RECONCILED / NOT GREEN`
- Source main: `2b1367368c24569a4e65598cef4e4639cf937e6f`
- Backup: `backup/pre-auth003-current-cursor-freshness-20260927`
- Machine cursor: `artifacts/mapping-0/current-execution-cursor-2026-09-27.json`

## Current execution authority

The current Mapping 0 execution cursor is:

`AUTH-003-RUNTIME-PERSISTENCE-EVIDENCE-ADMISSION`

State:

`BLOCKED_RUNTIME_PERSISTENCE_IMPLEMENTATION_ADMISSION_REQUIRED`

The governing admission control is:

`docs/change-control/CC-MAPPING-0-AUTH-003-RUNTIME-PERSISTENCE-IMPLEMENTATION-ADMISSION-GAP-2026-09-27.md`

## Supersession rule

Several historical Mapping 0 artifacts retain earlier cursor values such as `WAIT_AUTHORITY_DECISION`, `W01-MIGRATION-BASELINE-AUTHORITY-001`, or wording that places AUTH-004 next.

Those records remain preserved as historical governance evidence. They are superseded as execution instructions by this current cursor package and must not trigger repeat searches, repeated AUTH-002 runtime work, repeated W01 baseline work, or reopening of the AUTH-003 wire contract.

## Current blockers

1. AUTH-003 operation-policy resource/cache/retry/event/queue/anti-abuse authority is incomplete.
2. AUTH-003 physical D1 schema mapping remains pending actual schema authority.
3. AUTH-003 runtime/migration implementation has not been admitted.
4. ENT-IDENTITY and ENT-CREDENTIAL remain contract-only/proposed.
5. Final Evidence Registry and Mapping 0 promotion remain downstream.

## Prohibited repetition

- W01 baseline evidence run `35508571153` unchanged.
- AUTH-002 E6 Runtime Evidence run `36219132123` unchanged.
- AUTH-003 wire/OpenAPI/DTO closure.
- Historical cursor artifacts as new work items.

No API, DTO, entity, migration, Worker, D1 physical schema, operationId or Evidence PASS is created by this control.

## 2026-09-27 current-head / authority-input reconciliation

The previous cursor package recorded `62005334267f3db3237ad42774c3a5ca984615cb` as its assessment head. Current `main` is `2b1367368c24569a4e65598cef4e4639cf937e6f`; this reconciliation advances the cursor package to that actual current head without changing the execution state.

A source review was performed across the canonical Auth operation policy, AUTH-003 wire authority, public/API inventory governance, user-account operation policy, feed/interaction operation policies, and the AUTH-003 evidence reconciliation. No AUTH-003-specific authority was found for resource/D1 budgets, cache mode, retry profile, event consumers, queue limits/task type, or anti-abuse scope/actions. Neighbor-domain policy values remain reference material only and are not promoted into AUTH-003.

Therefore the current decision remains:
- operation-policy authority: `BLOCKED / DECISION_REQUIRED`
- physical D1 schema authority: `BLOCKED / PENDING_SCHEMA_EVIDENCE`
- runtime/migration implementation: `NOT_AUTHORIZED`
- Evidence Registry promotion: `NOT_AUTHORIZED`
- Mapping 0 GREEN promotion: `NOT_AUTHORIZED`

This reconciliation closes the search step without manufacturing authority and does not reopen any already-closed AUTH-003 wire/API/DTO work.
