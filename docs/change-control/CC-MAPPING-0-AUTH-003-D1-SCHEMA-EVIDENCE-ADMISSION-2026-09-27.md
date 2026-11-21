# CC-MAPPING-0-AUTH-003-D1-SCHEMA-EVIDENCE-ADMISSION-2026-09-27

Status: **EVIDENCE_ADMITTED / IMPLEMENTATION_BLOCKED**

## Scope

Admit the successful read-only remote D1-01 schema/migration evidence captured by GitHub Actions run **36295541846** at exact source SHA `ce308e202ff737e236f3bf35f30097e9e4e3b42c`.

This control admits observation of the existing remote schema only. It does not execute DDL/DML, create a migration, promote entities, or mark AUTH-003/Mapping 0 GREEN.

## Evidence provenance

- Workflow: `.github/workflows/w02-remote-d1-readonly-evidence.yml`
- Run: `36295541846`
- Job: `108553580507`
- Artifact: `auth-003-d1-readonly-schema-evidence-ce308e202ff737e236f3bf35f30097e9e4e3b42c`
- Artifact ID: `10923578328`
- Artifact SHA256: `2282760c39ba1229eadd0cf585c5f4a73735a95350f90f50de095a7dd941ecf5`
- Source SHA: `ce308e202ff737e236f3bf35f30097e9e4e3b42c`
- D1 binding: `D1_01`
- Database: `luckread`
- Database UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`
- Environment: `CONTROLLED_REMOTE_D1_READONLY`
- Remote DDL: none
- Remote DML: none

## Observed schema

The captured `sqlite_master` and `PRAGMA table_list` evidence shows the current D1-01 database contains Payload/native and already-admitted auxiliary tables including:

- `users`
- `users_sessions`
- `auth_session_state`
- `role_assignments`
- `role_authorization_versions`
- `auth_013_publication_journal`
- Payload migration/preference/lock tables
- `d1_migrations`

The current `users` table has native `email`, `username`, password/recovery fields, and the existing account-state fields. Unique indexes are evidenced for `users.email` and `users.username`.

No table named for, or otherwise explicitly evidenced as, ENT-IDENTITY or ENT-CREDENTIAL exists in the captured table list. No AUTH-003-specific credential persistence structure is therefore admitted by this evidence.

The migration ledger contains only:

1. `0001_role_assignments.sql`
2. `0002_auth_013_account_state.sql`
3. `0003_auth_013_publication_journal.sql`
4. `0003_role_authorization_versions.sql`

No `MIG-AUTH-003-CREDENTIAL-V1` execution is evidenced.

## Contract reconciliation

AUTH-003 remains **CONTRACTED_NOT_VERIFIED**.

- ENT-IDENTITY remains contract-only/proposed.
- ENT-CREDENTIAL remains contract-only/proposed.
- `contracts/alignment/mapping-batches/AUTH-002-006-d1-schema-mapping.v1.json#AUTH-003` remains PENDING for physical table/field/index/constraint mapping.
- `MIG-AUTH-003-CREDENTIAL-V1` remains `NOT_EXECUTED`.
- Existing Payload `users.email`/`users.username` are not silently promoted into ENT-IDENTITY/ENT-CREDENTIAL. Their current existence is evidence, not permission to collapse the frozen AUTH-003 entity model into Payload native Users.

## Decision

**Schema evidence gate is CLOSED. AUTH-003 implementation admission remains BLOCKED on migration admission/design.**

The evidence establishes the pre-migration state needed to design and review the smallest AUTH-003 persistence migration. It does not authorize executing that migration.

## Next gate

Prepare the smallest migration admission package for `MIG-AUTH-003-CREDENTIAL-V1`, including:

1. exact physical schema to be created;
2. field-by-field mapping to ENT-IDENTITY and ENT-CREDENTIAL;
3. authoritative uniqueness constraints;
4. secret-derived material protection;
5. normalization-version handling;
6. precondition/postcondition and recovery posture;
7. exact tested commit binding;
8. isolated migration/runtime/security evidence plan.

Only after that admission is closed may migration execution and the smallest runtime vertical slice proceed.

## Explicitly not changed

- AUTH-002 E6 evidence remains closed; do not rerun.
- W01 baseline evidence remains closed; do not rerun.
- AUTH-003 wire/OpenAPI/DTO authority remains closed.
- AUTH-004 remains Payload-native and NOT_GREEN.
- Mapping 0 is not GREEN.
