# Change Control — AUTH-002 Historical Migration Evidence Admission

- ID: CC-MAPPING-0-AUTH-002-HISTORICAL-MIGRATION-EVIDENCE-ADMISSION-2026-09-28
- Date: 2026-09-28
- Status: CLOSED — TECHNICAL EXECUTION EVIDENCE ADMITTED; AUTHORIZATION NOT RETROACTIVELY GRANTED
- Feature: AUTH-002
- Evidence unit: MIGRATION_EXECUTION
- Scope: Mapping 0 evidence admission only

## Purpose

Close the remaining AUTH-002 migration-execution evidence unit without re-running runtime evidence and without re-applying an already-executed migration.

## Decision

The historical E5 execution is admitted as **technical execution evidence** under the existing evidence contract.

This admission does **not** retroactively authorize the execution. The historical governance incident remains recorded exactly as it occurred: execution was not authorized at the time.

The distinction is explicit:

- execution fact: VERIFIED;
- execution authorization at the historical time: NOT AUTHORIZED;
- retroactive authorization: NOT GRANTED;
- current evidence admission: ACCEPTED.

## Evidence completeness

The original E5 artifact contains the required migration evidence chain:

1. controlled-target preflight;
2. exact-source checkout and source-SHA validation;
3. migration execution;
4. post-migration schema/catalog validation;
5. migration-history confirmation;
6. native users/users_sessions schema comparison;
7. integrity/foreign-key check;
8. provenance manifest.

Canonical artifact:

- run: `35552919573`
- job: `106190897137`
- artifact: `10618729380`
- artifact SHA-256: `c9bfcadba7ade81c8002786e6f323a5849c13dfb6f2390aeef44ea27584c44a1`
- tested commit: `fe1f2784d21f3f629bbad0baa971f1aa56520914`

## Freshness / scope determination

The migration execution evidence is bound to its own exact tested commit and migration unit. The migration source file itself is byte-identical between the historical execution and current main:

`2b43a7b08fe7c5be98793da7eb07ddd2cf9e6921`

The migration index changed later, but that index change does not modify the already-executed migration file or its recorded remote postconditions. Therefore the migration evidence is inherited only for this unchanged migration scope; no general stale-commit exception is introduced.

This is a **freshness/scope determination**, not a Contract exception.

## Registry admission

Register:

`EVD-AUTH002-B27-MIGRATION-EXECUTION-HISTORICAL-001`

as:

- claim: `AUTH-002::MIGRATION_EXECUTION`
- result: `PASS`
- status: `VERIFIED`
- freshnessMode: `INHERITED_UNCHANGED_SCOPE`

The older `EVD-AUTH002-B16-MIGRATION-REMOTE-001` and all other historical records remain preserved. No evidence is deleted or rewritten.

## Safety / non-goals

- Do not rerun AUTH-002 Runtime.
- Do not reapply `20260921_003203_MIG_AUTH_002_SESSION_V1`.
- Do not perform a D1 rollback or compensating mutation.
- Do not change Worker/D1/Queue topology.
- Do not change the persistence contract.
- Do not promote Mapping 0 GREEN from this record alone.
- Do not treat this admission as retroactive execution authorization.

## Result

AUTH-002 migration execution evidence is now technically VERIFIED.

The remaining blocker is the final Evidence Registry / Mapping 0 / entity-promotion gate.
