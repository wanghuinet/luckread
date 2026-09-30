# Change Control: SOCIAL-001 Follow Migration Contract — 2026-09-30

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-FOLLOW-MIGRATION-CONTRACT-2026-09-30`
- Status: `CONTRACT-FIRST / ADMITTED / EXECUTION-PENDING`
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

## Required execution order

1. Confirm exact W05 deployment SHA and live D1-02 binding evidence.
2. Materialize the versioned migration artifact from this contract without semantic expansion.
3. Record the migration artifact hash before execution.
4. Execute the migration only against the admitted D1 UUID.
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

Static contract validation may establish structural consistency only. It cannot be treated as proof that the migration ran or that the live D1 schema matches.

Promotion remains blocked until executable evidence exists for:

- exact deployment SHA;
- live W05-to-D1-02 binding;
- migration execution run;
- applied migration version;
- table/column/nullability/primary-key schema;
- unique constraint;
- indexes;
- absence of unauthorized schema expansion.

## Gate state

```
Migration contract: ADMITTED
Migration artifact: NOT CREATED
Migration execution: NOT EXECUTED
Schema evidence: NOT PRESENT
W05 runtime: NOT ADMITTED
SOCIAL-001: NOT_GREEN
```
