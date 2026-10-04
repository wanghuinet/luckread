# CC-MAPPING-0-AUTH-013-PERSISTENCE-EXECUTION-RECONCILIATION-2026-09-29

## Status

`APPROVED_FOR_PERSISTENCE-EVIDENCE_RECONCILIATION`

## Trigger

Existing controlled evidence already proves AUTH-013 persistence migration execution,
but `contracts/persistence/AUTH-013-account-state-persistence-contract.v1.json`
still contained stale execution fields indicating `NOT_EXECUTED` and
`TARGET_DEFINED_AWAITING_MIGRATION`.

## Evidence

Controlled remote D1 migration Run `35937873769` succeeded against D1-01
`luckread`, source `b40ae46fe5862c77f935a54adf4bd7e91c69159a`.

Artifact `10784305258` proves:

- migration `0002_auth_013_account_state.sql` applied;
- `users.account_state` exists as TEXT NOT NULL DEFAULT PENDING_VERIFICATION;
- `users.account_state_version` exists as INTEGER NOT NULL DEFAULT 1;
- post-migration users count was zero;
- post-schema verification succeeded.

## Reconciliation

Update only the factual execution/state fields:

- mark the two target field mappings as verified for the current zero-row target;
- record remote migration execution as `REMOTE_DDL_APPLIED_POSTMIGRATION_READONLY_EVIDENCE_VERIFIED`;
- preserve the migration evidence provenance;
- retain the top-level contract as `CONTRACTED_NOT_VERIFIED` because future non-zero
  targets still require an explicit authoritative backfill policy and the broader
  AUTH-013 lifecycle/security/evidence gates remain open.

## Non-changes

No migration is re-executed. No D1 mutation is performed.
No runtime Worker code, Contract/OpenAPI semantics, Payload version, Worker topology,
Service Binding topology, authorization rule, or Evidence Registry promotion is changed.

## Controls

Backup: `backup/pre-auth013-persistence-contract-execution-reconciliation-20260929`
Working branch: `reconcile/auth013-persistence-contract-execution-20260929`
Evidence: Run `35937873769` / artifact `10784305258`


## Current-head schema evidence reconciliation — 2026-10-04

A fresh controlled remote read-only schema evidence package completed successfully:

- Run: https://github.com/wanghuinet/luckread/actions/runs/37196564139
- Artifact: https://github.com/wanghuinet/luckread/actions/runs/37196564139/artifacts/11300814115
- Tested source: `d36474da3a848c6b390e83bff2056c25bfd9cf7f`
- Database: `luckread` / D1-01
- Evidence query writes: `0`
- `users.account_state`: TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
- `users.account_state_version`: INTEGER NOT NULL DEFAULT 1
- Migration `20261002_120000_media_owner`: present at batch 6
- Users count observed: 56

This refreshes the persistence-schema evidence at the current main source and is admitted as:
`EVD-AUTH013-PERSISTENCE-SCHEMA-REMOTE-002` = `PASS / VERIFIED`.

This does not promote AUTH-013 or Mapping 0. Downstream lifecycle, event/publication, W04 side-effect, and Evidence Registry/global Mapping 0 gates remain separate.
