# CC-MAPPING-0-AUTH-003-MIGRATION-ADMISSION-2026-09-27

Status: **MIGRATION_DESIGN_ADMITTED / NOT_EXECUTED**

## Scope
Admit the smallest physical persistence design for MIG-AUTH-003-CREDENTIAL-V1 after review of the captured D1-01 pre-migration state from workflow run 36295541846.

This control authorizes creation of the migration source and controlled execution evidence. It does not claim that the migration has been applied remotely, and it does not promote AUTH-003, ENT-IDENTITY, ENT-CREDENTIAL, or Mapping 0 to GREEN.

## Authoritative evidence baseline
- Exact observed source SHA: ce308e202ff737e236f3bf35f30097e9e4e3b42c
- Remote D1: luckread
- D1 UUID: 2f80471e-3756-49f9-8db1-7707a433ad64
- Binding: D1_01
- Evidence run: 36295541846
- Evidence artifact: 10923578328
- Remote state is read-only evidence; no DDL/DML occurred during capture.
- Existing migration ledger ends at the four already-observed migrations and contains no AUTH-003 migration.

## Physical design admitted for execution
The migration creates exactly two AUTH-003 tables in D1-01.

### auth_identities
| Contract field | Physical column | Rules |
| --- | --- | --- |
| id | id | TEXT PRIMARY KEY NOT NULL |
| userId | user_id | TEXT NOT NULL UNIQUE |
| username | username | TEXT nullable |
| usernameNormalized | username_normalized | TEXT nullable UNIQUE |
| email | email | TEXT nullable |
| emailNormalized | email_normalized | TEXT nullable UNIQUE |
| phone | phone | TEXT nullable |
| phoneNormalized | phone_normalized | TEXT nullable UNIQUE |
| normalizationVersion | normalization_version | TEXT NOT NULL |

### auth_credentials
| Contract field | Physical column | Rules |
| --- | --- | --- |
| id | id | TEXT PRIMARY KEY NOT NULL |
| identityId | identity_id | TEXT NOT NULL FK -> auth_identities.id |
| kind | kind | username/email/phone CHECK |
| valueHash | value_hash | TEXT NOT NULL UNIQUE |
| normalizedValue | normalized_value | TEXT NOT NULL |
| verifiedAt | verified_at | TEXT nullable |
| active | active | INTEGER NOT NULL DEFAULT 1, CHECK 0/1 |
| createdAt | created_at | TEXT NOT NULL |
| updatedAt | updated_at | TEXT NOT NULL |

Authoritative uniqueness is (kind, normalized_value). normalized_value is separately indexed but not globally unique because the frozen AUTH-003 operation contract defines uniqueness scope as kind + normalizedValue.

## Security boundary
The migration stores no raw credential value in auth_credentials.

value_hash is a reserved secret-derived representation. The Worker runtime must derive it using the admitted application secret/key boundary; the SQL migration does not invent a database cryptographic primitive and cannot accept plaintext credential material.

auth_identities contains identifier-side fields required by the frozen entity contract. Those fields are never part of the public AUTH-003 credential projection.

## Backfill posture
**No automatic credential backfill is admitted in this migration.**

Reason: D1 migration SQL has no authorized application secret/key context for producing the required protected value_hash. Inventing a migration-side hash or storing plaintext would violate the contract.

The migration is therefore schema-only. Existing Payload users.email / users.username remain Payload-native authentication state. Synchronization into AUTH-003 entities requires a later explicitly admitted runtime/backfill path with exact provenance and negative-security evidence.

## Required postconditions
1. auth_identities exists with the exact admitted columns and constraints.
2. auth_credentials exists with the exact admitted columns, FK and uniqueness boundary.
3. Required secondary indexes exist for fields marked indexed by the entity contracts.
4. No password, raw credential, raw recovery token, or raw verification token column is introduced.
5. Existing Payload users schema is unchanged by this migration.
6. Migration ledger records exactly 0004_auth_003_credentials.sql.
7. Exact commit SHA is bound to migration execution evidence.
8. PRAGMA foreign_key_check returns no violations.

## Explicit non-goals
- No AUTH-003 request handler implementation.
- No public W02 endpoint activation.
- No modification of Payload native authentication/recovery.
- No change to users.email or users.username.
- No new D1 database, Worker, queue, cache, or cross-Worker RPC.
- No Mapping 0 GREEN.
- No entity promotion before executable evidence.

## Next gate
Execute 0004_auth_003_credentials.sql through the controlled migration workflow against the exact admitted source SHA. Register pre/post schema and migration evidence. Runtime admission remains separate and requires same-SHA persistence/security/runtime evidence.
