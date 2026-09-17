# AUTH-002 — Migration Generation Admission Gate v1.1

## Status

`CONTRACTED / GENERATION_BLOCKED_UNTIL_INPUTS_CLOSED`

## Runtime authority

The active runtime authority for this contract is `workers/W01-payload/`.
The active Payload baseline is the official `templates/with-cloudflare-d1` structure with the current W01 lock: Payload `3.87.1` and `@payloadcms/db-d1-sqlite` `3.87.1`. The `3.82.1` family is the historical upstream template observation recorded by the W01 upstream manifest and is not the current W01 lock.

Historical AUTH-002 evidence that references the `3.82.1` upstream observation is not current runtime evidence and must not satisfy this admission gate.

## Purpose

Define the exact conditions under which an AUTH-002 migration artifact may be generated and reviewed. This contract does not apply migrations and does not promote AUTH-002.

## Required authority inputs

1. `contracts/entity/AUTH-002-session-field-contract.v1.json`
2. `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
3. `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
4. `workers/W01-payload/src/collections/Users.ts`
5. `workers/W01-payload/src/payload.config.ts`
6. W01 package contract and lockfile evidence for the exact tested commit.

## Native-session invariant

Payload native `users.sessions[]` remains the only source of native session identity. Native fields `id`, `createdAt`, and `expiresAt` must remain owned by Payload when runtime/schema evidence proves those representations. The AUTH-002 extension migration must not create a second full Session table or duplicate native fields.

## Extension schema target

`auth_session_state` with exactly:

- `session_id TEXT NOT NULL PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `device_id TEXT NOT NULL`
- `token_version INTEGER NOT NULL`
- `refresh_credential_hash TEXT NOT NULL`
- `revoked_at TEXT NULL`
- `last_seen_at TEXT NULL`

Required indexes:

- `auth_session_state_user_id_idx`
- `auth_session_state_device_id_idx`
- `auth_session_state_token_version_idx`
- `auth_session_state_revoked_at_idx`

Forbidden columns:

- `raw_access_token`
- `raw_refresh_token`
- `password`

## Generation rules

- Migration must be generated from the frozen W01 repository configuration and approved contract input, not improvised during DDL authoring.
- Generation must be deterministic for the same repository state and migration input.
- `push: false` must remain enabled.
- Generated artifact must be reviewable before application.
- No migration application occurs in the generation step.
- Actual installed Payload/D1 schema evidence must precede any promotion of canonical field equivalence.

## Pre-application review

The artifact is rejected when it:

- changes Payload native session shape;
- creates an independent canonical Session identity;
- duplicates `createdAt` or `expiresAt` in the extension table;
- introduces forbidden secret columns;
- omits a required extension field or index;
- introduces an unauthorized physical FK from `session_id` to an embedded `users.sessions[]` element;
- performs destructive changes without a separately contracted recovery strategy.

## Verification sequence

`DEPENDENCY_EVIDENCE` → `GENERATED` → `STATIC_REVIEWED` → `EMPTY_SCHEMA_TESTED` → `EXPECTED_PRE_SCHEMA_TESTED` → `EXECUTION_ADMITTED`.

Failure at any stage blocks subsequent stages.

## Non-promotion rule

A generated or statically reviewed migration is not evidence that it was applied, and does not prove remote D1 schema, runtime persistence, security, concurrency, or AUTH-002 GREEN.
