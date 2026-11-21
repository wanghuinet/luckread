# CC-MAPPING-0-CURSOR-AUTH003-CURRENT-SUPERSESSION-2026-09-28

## Status

`RECONCILED_GOVERNANCE_ONLY`

## Scope

Reconcile historical AUTH-003 continuation wording that remains in
`contracts/alignment/mapping-batches/AUTH-003-006-next-closure-queue.v1.md`
and the earlier AUTH-003 cursor control with the dedicated current execution cursor:

`artifacts/mapping-0/current-execution-cursor-2026-09-27.json`

No API, DTO, Entity, Field, Worker, D1, Queue, migration, runtime, or Evidence status is changed.

## Observed historical wording

The AUTH-003 closure queue contains an earlier "Current authoritative continuation" for AUTH-003 runtime lifecycle closure and a later "CREDENTIAL-LIST RUNTIME/EVIDENCE REQUIRED" state.

The 2026-09-27 dedicated Mapping 0 cursor was subsequently established as the current execution authority and explicitly declares:

- `status = CURRENT_CURSOR_AUTHORITATIVE`
- `currentCursor.id = AUTH-001-REGISTRATION-CLOSURE`
- `currentCursor.state = BLOCKED_PRIV004_POLICY_INSTANCE`

## Reconciliation rule

For current work selection, the dedicated current-execution cursor supersedes all earlier feature-queue "current continuation" text.

The older AUTH-003 continuation entries remain intact as historical traceability. They must not be used to:

- bypass the current PRIV-004 gate;
- reopen AUTH-003 runtime work;
- rerun already admitted AUTH-003 evidence;
- promote ENT-IDENTITY / ENT-CREDENTIAL;
- promote Mapping 0 GREEN.

## Current execution state

The active gate remains:

`PRIV-004 -> admit first approved ACCOUNT_REGISTRATION / LEGAL_AUDIT policy instance`

Until that external authority input is admitted, AUTH-001 runtime remains fail-closed.

## Source-head rule

The dedicated cursor's deliberate source reconciliation boundary remains authoritative. Governance-only reconciliation commits do not require advancing its `sourceHead` to every later merge.

## Provenance

- Main reviewed: `d159be5631483a60a2e4af64839cd257a2acd56a`
- Backup: `backup/pre-auth003-queue-cursor-authority-reconcile-20260928`
- Working branch: `fix/auth003-queue-cursor-authority-reconcile-20260928`
