# Change Control — AUTH-002 Migration Evidence Admissibility Boundary

- ID: CC-MAPPING-0-AUTH-002-MIGRATION-EVIDENCE-ADMISSIBILITY-BOUNDARY-2026-09-28
- Date: 2026-09-28
- Status: BLOCKED — CURRENT CONTRACT DOES NOT ADMIT HISTORICAL UNAUTHORIZED EXECUTION
- Feature: AUTH-002
- Evidence unit: MIGRATION_EXECUTION
- Scope: Mapping 0 closure / evidence admissibility only

## Purpose

Record the exact evidence boundary after PR #154 cursor reconciliation without changing the persistence contract, re-running Runtime evidence, re-applying the already-executed migration, or promoting Mapping 0.

## Contract inputs

The current persistence evidence contract requires the MIGRATION_EXECUTION unit to contain:

- migrationId
- preconditionResult
- executionResult
- postconditionResult
- commitSha

The AUTH-002 Evidence Registry Instance Contract also requires:

- executable source;
- resolvable sourceRef;
- commitSha;
- every evidence commit must equal the tested commit;
- required claim must resolve to PASS;
- documentation-only or stale evidence cannot satisfy the claim.

Authoritative inputs:

- `contracts/evidence/AUTH-002-006-persistence-evidence-contract.v1.json`
- `contracts/evidence/AUTH-002-evidence-registry-instance-contract.v1.json`
- `contracts/evidence/mapping-0-evidence-registry.v1.json`
- `docs/change-control/CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21.md`

## Technical reconciliation

Historical remote execution:

- Run: `35552919573`
- Migration: `20260921_003203_MIG_AUTH_002_SESSION_V1`
- Historical execution source commit: `fe1f2784d21f3f629bbad0baa971f1aa56520914`
- At that execution point the E5 Change Control was not authorized.
- The technical D1 mutation is retained as a factual historical result and is not retroactively classified as authorized execution evidence.

Current source comparison:

- Migration file `workers/W01-payload/src/migrations/20260921_003203_MIG_AUTH_002_SESSION_V1.ts`
  - historical blob: `2b43a7b08fe7c5be98793da7eb07ddd2cf9e6921`
  - current blob: `2b43a7b08fe7c5be98793da7eb07ddd2cf9e6921`
  - finding: migration SQL source is byte-identical.
- Migration index `workers/W01-payload/src/migrations/index.ts`
  - historical blob: `436c37e395145017d9135f938d69a741a936c60b`
  - current blob: `4a8ee2b68c1b845d06b9f4bb892e59d70a556376`
  - finding: migration index changed after the historical execution and now includes additional migrations.

Therefore the historical execution is not an exact-current-commit execution unit.

## Admissibility finding

No current contract permits an exception that substitutes migration-file identity for exact tested-commit identity.

Accordingly:

1. The historical execution cannot be promoted to current `MIGRATION_EXECUTION=VERIFIED` under the existing contracts.
2. The historical Evidence Registry record remains historical/unadmitted and must not be rewritten to VERIFIED.
3. A duplicate remote execution must not be used merely to manufacture a fresh proof, because the migration is already recorded remotely and the fail-closed E5 workflow is designed to reject re-application.
4. No D1 rollback, compensating mutation, or production deployment is authorized by this control.
5. No Contract, Blueprint, Evidence definition, entity status, or Mapping 0 status is changed by this record.

## Remaining decision boundary

A separate explicit authority/contract decision is required before any alternative admissibility rule can be introduced, such as migration-unit source equivalence across a changed migration index.

Until such an authoritative decision exists:

- AUTH-002 `MIGRATION_EXECUTION` remains BLOCKED;
- AUTH-002 remains not GREEN;
- ENT-SESSION remains blocked from promotion;
- Evidence Registry remains NOT_GREEN;
- Mapping 0 remains NOT_GREEN.

## Safety rule

Do not dispatch `.github/workflows/auth-002-e5-remote-migration-execution.yml` against the already-applied migration unless a new Change Control explicitly authorizes a safe, contract-complete evidence path. This document does not grant such authorization.
