# Change Control: SOCIAL-001 Follow Migration Contract — 2026-09-30

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-FOLLOW-MIGRATION-CONTRACT-2026-09-30`
- Status: `MIGRATION-VERIFIED / RUNTIME-PENDING`
- Base main: `2cbb486a174abc926393dbb2019f33483cbfc37e`
- Backup: `backup/main-follow-migration-contract-before-20260930`
- Feature: `SOCIAL-001`
- Entity: `ENT-SOCIAL-FOLLOW`
- Canonical ownership: `SOCIAL → T11 → W05 → D1-02`

## Scope

This slice establishes the executable migration contract for the already-contracted Follow persistence schema.

It does not execute the migration, deploy a Worker, add a runtime handler, or promote Mapping 0.

## Contract chain

```
SOCIAL-001
  ↓
ENT-SOCIAL-FOLLOW
  ↓
SOCIAL-001-follow-relationship-persistence-contract.v1.json
  ↓
SOCIAL-001-follow-relationship-migration-contract.v1.json
  ↓
controlled W05 → D1-02 deployment
  ↓
migration execution
  ↓
schema evidence
```

## Migration authority

- Worker: `luckread-w05`
- Canonical Worker: `W05`
- D1 domain: `D1-02`
- D1 UUID: `6c342634-97f6-4248-9f4a-85772af4f22c`
- Physical binding contract: `docs/change-control/CC-MAPPING-0-SOCIAL-001-W05-D1-02-PHYSICAL-BINDING-2026-09-30.md`
- Migration contract: `contracts/persistence/SOCIAL-001-follow-relationship-migration-contract.v1.json`
- Expected migration artifact: `workers/W05-transaction/migrations/20260930_001_social_001_follow_v1.sql`
- Migration artifact blob SHA: `effa0a6ca934d9b995611d7612baa1255379c0a7`
- Migration execution workflow: `.github/workflows/social-001-follow-d1-02-migration.yml`
- Fixed verifier commit: `e9057337aac25cb5a18659802863ad13da5572aa`

## Required execution order

1. Confirm exact W05 deployment SHA and live D1-02 binding evidence.
2. Materialize the versioned migration artifact from this contract without semantic expansion.
3. Record the migration artifact hash before execution.
4. Execute the migration only against the admitted D1 UUID through the controlled `SOCIAL-001 Follow D1-02 Migration` workflow.
5. Capture applied migration version and target schema evidence.
6. Validate unique relation constraint and both pagination indexes.
7. Bind execution evidence to SOCIAL-001.
8. Only then admit W05 runtime implementation.

## Explicit non-actions

- No new Worker.
- No new D1 database.
- No Service Binding.
- No Payload Collection.
- No runtime Follow API.
- No follower/following query promotion.
- No cross-D1 foreign key.
- No routine destructive rollback.
- No GREEN claim.

## Evidence boundary

Static contract validation may establish structural consistency only. The verified remote execution evidence for run `36718167892` proves the migration was applied to D1-02 and the post-migration schema matches the contracted shape.

The workflow's final conclusion was `failure` only because its post-migration result collector duplicated nested `results` rows and therefore counted one migration-history row as more than one. The verifier has since been corrected and made safe for already-applied migrations.

Verified evidence:

- exact migration source SHA: `d1b2a0096066c6486cd174e77293b144b9978e93`;
- binding evidence: run `36717067309`;
- remote migration run: `36718167892`;
- applied migration: `20260930_001_social_001_follow_v1.sql`;
- applied exactly once at `2026-09-30 12:57:30`;
- exact four-column schema;
- contracted unique relation index and both pagination indexes;
- zero physical foreign keys;
- no unexpected schema expansion;
- durable evidence record: `artifacts/mapping-0/social-001-follow-d1-02-migration-evidence-20260930.json`.

Promotion remains blocked on W05 runtime implementation and runtime/security/concurrency/event/projection evidence.

## Gate state

```
Migration contract: ADMITTED
Migration artifact: CREATED
Migration execution: VERIFIED_BY_REMOTE_EVIDENCE
Schema evidence: VERIFIED_BY_REMOTE_EVIDENCE
W05 runtime: NOT ADMITTED
SOCIAL-001: NOT_GREEN
```
