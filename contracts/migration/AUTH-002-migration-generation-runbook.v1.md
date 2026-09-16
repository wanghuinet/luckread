# AUTH-002 — Migration Generation Runbook v1.0

## Status

`CONTRACTED_NOT_EXECUTED / NOT_GREEN`

## Purpose

Generate the first Payload migration artifact for AUTH-002 from the frozen repository configuration and contracts without applying it to any remote D1 database.

## Authority

- `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
- `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/migration/AUTH-002-006-migration-gate.v1.md`

## Preconditions

1. Payload dependency is exactly `3.87.1`.
2. `@payloadcms/db-d1-sqlite` dependency is exactly `3.87.1`.
3. `Users` has native Payload authentication enabled.
4. D1 adapter uses `push: false`.
5. D1 adapter has an explicit `migrationDir`.
6. The working tree is clean except for intentionally staged migration-generation changes.
7. No production or controlled remote D1 mutation is permitted during generation.

## Generation command

Use the repository Payload CLI:

`npm run payload -- migrate:create MIG-AUTH-002-SESSION-V1`

Payload documents `migrate:create` as the command that generates a migration file in the configured migrations directory; generation does not itself execute the migration. citeturn267405search0

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

1. Run `npm run auth:session:migration:admission`.
2. Run `node scripts/auth-002-migration-static-audit.mjs`.
3. Inspect the generated migration manually against the frozen contract.
4. Confirm no unrelated collection/table/index changes are included.
5. Confirm `up` and `down` are deterministic and scoped to the migration.
6. Do not run `payload migrate`, `d1 migrations apply`, or any D1 mutating SQL in this generation step.

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
