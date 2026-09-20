# Change Control — AUTH-002 E5 Deterministic Migration Generation Source

- ID: CC-MAPPING-0-AUTH-002-E5-DRIZZLE-SCHEMA-SOURCE-2026-09-21
- Date: 2026-09-21
- Status: EXECUTION ADMITTED — SCHEMA-SOURCE ONLY
- Supersedes disposition only: `CC-MAPPING-0-AUTH-002-E5-MIGRATION-SOURCE-AUTHORITY-2026-09-20`

## Purpose

Close the E5 migration-source authority gap without changing the canonical AUTH-002 contract and without introducing a second Session authority.

## Admitted mechanism

Use the already supported D1 3.87.1 `beforeSchemaInit` adapter hook to add one Drizzle schema table representing the already-contracted `auth_session_state` extension.

The schema source is:

- `workers/W01-payload/src/db/auth-session-state-schema.ts`
- imported by `workers/W01-payload/src/payload.config.ts`
- supplied through `sqliteD1Adapter({ beforeSchemaInit: [...] })`

This mechanism is schema-only. It is not a Payload Collection and therefore does not create a new Payload REST/GraphQL/admin business surface.

## Exact schema boundary

The source MUST define only:

Table:
`auth_session_state`

Columns:
- `session_id TEXT NOT NULL PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `device_id TEXT NOT NULL`
- `token_version INTEGER NOT NULL`
- `refresh_credential_hash TEXT NOT NULL`
- `revoked_at TEXT NULL`
- `last_seen_at TEXT NULL`

Indexes:
- `auth_session_state_user_id_idx`
- `auth_session_state_device_id_idx`
- `auth_session_state_token_version_idx`
- `auth_session_state_revoked_at_idx`

Forbidden additions:
- native `createdAt`
- native `expiresAt`
- `raw_access_token`
- `raw_refresh_token`
- `password`
- any alternate session identifier
- any second Session collection/table

## Runtime authority invariant

Payload native `users.sessions[]` remains the only native session identity authority.

`auth_session_state.session_id` MUST equal the native Payload session id. The extension schema MUST NOT mint or replace native session identity.

## Migration-generation boundary

This Control admits the schema source only.

It does NOT admit:
- hand-authored DDL;
- direct remote D1 mutation;
- broad Payload Config redesign;
- Payload core modification;
- automatic AUTH-002 promotion;
- runtime security/concurrency promotion.

The next gate remains generation + static audit + controlled execution evidence.

## Acceptance

The generated migration is admissible only if the existing migration-generation controls prove:

1. generated from the frozen source/contract;
2. no recreation of existing Payload baseline tables;
3. exact contracted table/column/index set;
4. no forbidden fields;
5. no duplicate Session authority;
6. deterministic up/down scope;
7. no remote D1 application during generation.

## Status impact

Before successful generated-migration audit:

`E5 = GENERATION_PENDING_VERIFICATION`

`AUTH-002 = NOT_GREEN`

`Mapping-0 = NOT_GREEN`
