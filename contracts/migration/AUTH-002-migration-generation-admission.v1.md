# AUTH-002 — Migration Generation Admission Gate v1.0

## Status

`CONTRACTED / GENERATION_BLOCKED_UNTIL_INPUTS_CLOSED`

## Purpose

Define the exact conditions under which a Payload 3.87.1 migration artifact for AUTH-002 may be generated and reviewed. This contract does not apply migrations and does not promote AUTH-002.

## Required authority inputs

1. `contracts/entity/AUTH-002-session-field-contract.v1.json`
2. `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
3. `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
4. Payload 3.87.1 `Users` configuration and D1 adapter configuration on the exact tested commit.

## Native-session invariant

Payload native `users.sessions[]` remains the only source of native session identity. Native fields `id`, `createdAt`, and `expiresAt` must remain owned by Payload. The AUTH-002 extension migration must not create a second full Session table or duplicate those native fields.

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

- Migration must be generated from the frozen repository configuration/contract input, not improvised during DDL authoring.
- Generation must be deterministic for the same repository state and migration input.
- `push: false` must remain enabled.
- Generated artifact must be reviewable before application.
- No migration application occurs in the generation step.

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

`GENERATED` → `STATIC_REVIEWED` → `EMPTY_SCHEMA_TESTED` → `EXPECTED_PRE_SCHEMA_TESTED` → `EXECUTION_ADMITTED`.

Failure at any stage blocks subsequent stages.

## Non-promotion rule

A generated or statically reviewed migration is not evidence that it was applied, and does not prove remote D1 schema, runtime persistence, security, concurrency, or AUTH-002 GREEN.
