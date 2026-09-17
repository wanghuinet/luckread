# AUTH-002 — Migration Generation Runbook v1.1

## Status

`CONTRACTED_NOT_EXECUTED / NOT_GREEN`

## Runtime authority

The active runtime authority is `workers/W01-payload/`.
The active dependency baseline is the official `templates/with-cloudflare-d1` structure with the current W01 lock: Payload `3.87.1` and `@payloadcms/db-d1-sqlite` `3.87.1`. The `3.82.1` family is the historical upstream template observation recorded by the W01 upstream manifest.

The older `3.82.1` references are historical upstream observations and are not valid current W01 runtime evidence.

## Purpose

Generate the first Payload migration artifact for AUTH-002 from the frozen W01 configuration and contracts without applying it to any remote D1 database.

## Authority

- `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
- `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/migration/AUTH-002-006-migration-gate.v1.md`
- `workers/W01-payload/src/payload.config.ts`
- `workers/W01-payload/src/collections/Users.ts`
- `workers/W01-payload/src/migrations/`

## Preconditions

1. W01 Payload dependency is exactly `3.87.1`.
2. W01 `@payloadcms/db-d1-sqlite` dependency is exactly `3.87.1`.
3. `Users` has native Payload authentication enabled.
4. D1 adapter uses `push: false`.
5. D1 adapter has an explicit `migrationDir` pointing to W01 migrations.
6. Dependency resolution is captured for the exact tested commit, including a reproducible lockfile reference.
7. The working tree is clean except for intentionally staged migration-generation changes.
8. No production or controlled remote D1 mutation is permitted during generation.

## Generation command

Use the W01 Payload CLI:

`pnpm payload migrate:create MIG-AUTH-002-SESSION-V1`

The official Cloudflare template documents `payload migrate:create` for generating migrations and `payload migrate` for applying them. Generation alone does not execute a migration. citeturn0search0

## Immediate static review

After generation, the artifact MUST:

- create or modify only the contracted `auth_session_state` extension state;
- contain `session_id`, `user_id`, `device_id`, `token_version`, `refresh_credential_hash`, `revoked_at`, and `last_seen_at` as required by the extension contract;
- establish `session_id` as the primary key/unique identity;
- contain the four contracted extension indexes;
- not create a parallel `sessions` or `session` table;
- not duplicate native `createdAt` or `expiresAt` inside `auth_session_state`;
- not persist `raw_access_token`, `raw_refresh_token`, or password data;
- preserve the logical relationship `auth_session_state.session_id -> users.sessions[].id` rather than introducing a physical FK to the embedded session element.

## Required checks before commit acceptance

1. Run the W01 migration admission validator.
2. Run the migration static audit.
3. Inspect the generated migration manually against the frozen contract.
4. Confirm no unrelated collection/table/index changes are included.
5. Confirm `up` and `down` are deterministic and scoped to the migration.
6. Do not run `payload migrate`, `wrangler d1 migrations apply`, or any other D1-mutating SQL in this generation step.

## Promotion rule

Generation success changes status only from `MIGRATION_NOT_PRESENT` to `MIGRATION_GENERATED_PENDING_REVIEW`.

It does not prove:

- migration execution;
- remote D1 schema state;
- runtime session behavior;
- authorization correctness;
- concurrency correctness;
- Evidence Registry completion;
- Mapping 0 verification;
- `AUTH-002 GREEN`.

## Current status

`WAITING_FOR_GENERATED_ARTIFACT`
