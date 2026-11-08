# W01 PostgreSQL Schema Generation (D1-01)

This is a schema-only Payload adapter path for the staged Neon migration.

- Production continues to use `src/payload.config.ts`, `@payloadcms/db-d1-sqlite@3.90.2`, D1-01 and R2.
- `src/neon-postgres-schema.config.ts` uses the pinned official `@payloadcms/db-postgres@3.90.2` adapter.
- The existing `Users` and `Media` Collections, redirects configuration, and R2 metadata fields are reused.
- The official R2 plugin is configured with a schema-only placeholder bucket and `alwaysInsertFields: true`, so it derives its own `prefix` and `_objectKey` fields. A PostgreSQL `afterSchemaInit` fallback guarantees the two physical columns exist even if the plugin omits them. The CI migration CLI runs with `disableOnInit`, and this workflow never invokes upload/delete handlers or contacts R2.
- Existing W01 physical columns `users.reset_password_requested_at`, `media.prefix`, and `media._objectkey` are retained with Payload's supported Drizzle `afterSchemaInit` extension hook.
- PostgreSQL migrations are kept in `src/neon-postgres-migrations`; D1 files in `src/migrations` are never imported by this config.

CI uses disposable PostgreSQL 18 service databases named `luckread_schema` and `luckread_schema_rollback`. The schema verifier rejects other hosts/database names and confirms the primary database's business tables are empty. A second ephemeral database receives one synthetic `payload_kv` fixture to prove the generated `down` migration refuses to drop a non-empty schema and leaves the fixture intact. Only the Payload migration ledger is written during the baseline application.

The generated `down` migration first checks every W01 business table is empty, then drops tables in FK-safe order without `CASCADE`; any external dependency also blocks rollback. The local PostgreSQL generation/test workflow never reads Neon credentials or connects to Neon. Only the separate manually dispatched, main-only apply workflow described below can connect to the one approved Neon target. Neither workflow changes D1, updates the production Payload config, enables automatic schema push, or imports business data. Never point the local-only schema CI workflow at a remote production database.



## W01 schema-only closeout — 2026-11-08

**Status: `ACCEPTED_SCHEMA_BASELINE_NEON_RECONCILED`**

W01's D1-01 Payload schema owner slice is accepted and frozen for the schema-only migration scope. This does **not** mean W01 runtime traffic has moved to Neon.

Verified evidence:

- Standalone W01 Payload PostgreSQL 18 schema plus non-empty rollback guard: [run 42452902432](https://github.com/wanghuinet/luckread/actions/runs/42452902432) — `success`.
- Full ordered D1-01 W01/W02/W07/W08 PostgreSQL 18 rehearsal: [run 42460599618](https://github.com/wanghuinet/luckread/actions/runs/42460599618) — `success`; the official W01 Payload native migration was applied first in the disposable database and the combined owner/ledger/empty-business-data checks passed.
- Actual Neon W01 read-only reconciliation: [run 42453402142](https://github.com/wanghuinet/luckread/actions/runs/42453402142) — `success`. It verified the exact Neon `luckread` database on PostgreSQL `18.6`, TLS chain and hostname, all 11 expected relations, columns/indexes/foreign keys, ten business tables at zero rows, and exactly one `payload_migrations` row named `20261107_202531_neon_d1_01_payload_baseline`. The report confirms `readOnlyTransactionVerified=true`, `readOnlyTransactionRolledBack=true`, `failures=[]`, and no business data import or production authority change.

### Remote execution rule

The former owner-specific W01 manual apply workflow has been removed. It is not an allowed Neon execution path.

The **only** approved remote D1-01 schema workflow is `.github/workflows/neon-d1-01-reviewed-remote-schema-apply.yml`, dispatched from `main` with the exact confirmation `APPLY_REVIEWED_SCHEMA_D1_01_LUCKREAD`. That shared workflow re-runs W01's detailed read-only verifier before and after the shared runner.

The manifest keeps W01 as order `100`, kind `PAYLOAD_NATIVE`. The shared runner must preserve the already-existing Payload baseline: it validates the baseline and writes its common migration-ledger provenance row; it must **not** replay W01 DDL. The remote shared runner has not yet been manually dispatched, so that common ledger row is still pending as part of the overall D1-01 initialization.

The local `neon:schema:apply` and `neon:schema:rollback` scripts are for disposable local PostgreSQL CI only. They are not a Neon remote apply interface.

### Runtime and data boundary

- Cloudflare D1 remains the production authority; the production Payload config and runtime connection remain unchanged.
- Cloudflare R2 remains the media/object store. The schema-only PostgreSQL config does not move media objects or enable R2 handlers.
- No accounts, credentials, sessions, content, media rows, subscriptions, payment records, or other business data are imported.
- No Worker, D1, Queue, Service Binding, production API route, dual-write path or traffic cutover is introduced by this W01 schema closeout.
- W01's accepted schema baseline does not imply that D1-01's W02/W07/W08 schemas or the shared remote ledger have been applied.
