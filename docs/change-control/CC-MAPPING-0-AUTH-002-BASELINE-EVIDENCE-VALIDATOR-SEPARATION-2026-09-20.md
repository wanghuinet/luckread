# Change Control — AUTH-002 Baseline Evidence / Post-Migration Validation Separation

- ID: CC-MAPPING-0-AUTH-002-BASELINE-EVIDENCE-VALIDATOR-SEPARATION-2026-09-20
- Date: 2026-09-20
- Status: GREEN — TOOLING-ONLY
- Scope: AUTH-002 evidence validator classification only

## Problem

The controlled remote evidence workflow can legitimately observe an uninitialized controlled D1 target before the approved W01 baseline migration is executed. The existing validator treated absence of the physical `users` table as unconditional evidence-package rejection.

That conflates two states:

1. **BASELINE_CONFIRMED_UNINITIALIZED** — remote target is reachable and contains no application tables, proving the pre-migration starting state.
2. **POST_MIGRATION_SCHEMA_VERIFIED** — the approved baseline migration has been executed and the resulting physical schema has been verified.

The first state must not be promoted to the second state.

## Admitted change

Update only the AUTH-002 evidence validator so it recognizes an explicitly uninitialized controlled baseline as a valid **baseline evidence result**, while retaining fail-closed behavior for AUTH-002 promotion.

The validator must continue to reject:
- missing physical `users` table when the evidence claims post-migration schema verification;
- missing/invalid evidence artifacts;
- secret leakage;
- unexpected application tables during baseline capture;
- schema mismatches after migration.

The validator must not:
- execute migrations;
- modify D1;
- change Blueprint or Contract semantics;
- promote Mapping status;
- infer physical schema;
- mark AUTH-002 implementation/runtime evidence as verified.

## Evidence authority

Current real capture:
- Workflow: `AUTH-002 Session Schema Evidence`
- Run: `35498648527`
- Target: `luckread / 2f80471e-3756-49f9-8db1-7707a433ad64`
- Environment: `CONTROLLED_REMOTE_D1`
- Observed application tables: none
- `payload_migrations`: absent
- `users`: absent
- `auth_session_state`: absent
- Evidence workflow writes: zero

## Acceptance

A baseline-only package may return:
`AUTH-002_BASELINE_EVIDENCE_VALIDATION_PASS`

It must remain explicitly classified as:
`BASELINE_CONFIRMED_UNINITIALIZED`

It must not satisfy the post-migration AUTH-002 promotion gate.

The existing W01 migration execution admission and workflow remain unchanged.
