# CC-MAPPING-0-CURSOR-AUTH-004-REMOTE-E2E-RECONCILIATION — 2026-09-28

## Status

`CURRENT_HEAD_RECONCILED / REMOTE_E2E_GATE_OPEN`

## Purpose

Reconcile the authoritative execution cursor after the AUTH-004 Payload 3.90.2 implementation/deployment batch advanced `main` beyond the cursor's former 3.87.1 state.

## Current source

- Current `main`: `39489d6bddcc9a768c9b8c2bd9c18de5c26c0b20`
- Backup created before this batch: `backup/main-before-auth004-batch-20260928-2003`
- W01 Payload family: `3.90.2`
- W01/W02 binding deployment: run `36418911699`
- Deployment conclusion: `success`
- Deployment tested source: exact current `main` SHA above

## Evidence boundary

Already established and inherited without rerun:

- AUTH-004 local native lifecycle evidence: run `36411953998`
- Payload 3.90.2 dependency/version alignment is merged
- W01 build and W01/W02 Service Binding deployment succeeded

The deployment result is **not** remote HTTP/E2E runtime evidence and does **not** promote AUTH-004, the Evidence Registry, or Mapping 0.

## Current remaining AUTH-004 gate

The existing workflow `.github/workflows/auth-004-remote-e2e.yml` and script `scripts/auth-004-remote-e2e.mjs` remain the sole controlled remote evidence path.

The pending evidence dimensions are:

- protected-account / missing-account reset-request enumeration resistance;
- password-change invalidation of all pre-change native sessions;
- password-reset invalidation of pre-reset native sessions;
- single-use recovery-token replay rejection;
- expired recovery-token rejection;
- remote persistence confirmation for Payload-native reset token/expiration;
- secret-free evidence output and cleanup.

No new authentication subsystem, custom session invalidation store, Worker, D1 database, queue, AUTH-004 migration, or Payload core fork is introduced by this reconciliation.

## Non-actions

- No local AUTH-004 lifecycle rerun.
- No AUTH-002/AUTH-003 runtime rerun.
- No duplicate migration execution.
- No Evidence Registry GREEN.
- No Mapping 0 GREEN.
- No entity promotion.

## Next cursor

`AUTH-004-REMOTE-E2E-LIFECYCLE-CLOSURE-001` / `BLOCKED_REMOTE_E2E`

The dedicated current-execution cursor is updated to the exact current `main` SHA and Payload `3.90.2` baseline. Historical cursor text remains historical and must not drive work selection.
