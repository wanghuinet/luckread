# W01 PostgreSQL Schema Generation (D1-01)

This is a schema-only Payload adapter path for the staged Neon migration.

- Production continues to use `src/payload.config.ts`, `@payloadcms/db-d1-sqlite@3.90.2`, D1-01 and R2.
- `src/neon-postgres-schema.config.ts` uses the pinned official `@payloadcms/db-postgres@3.90.2` adapter.
- The existing `Users` and `Media` Collections, redirects configuration, and R2 metadata fields are reused.
- The official R2 plugin is configured with a schema-only placeholder bucket and `alwaysInsertFields: true`, so it derives its own `prefix` and `_objectKey` fields. A PostgreSQL `afterSchemaInit` fallback guarantees the two physical columns exist even if the plugin omits them. The CI migration CLI runs with `disableOnInit`, and this workflow never invokes upload/delete handlers or contacts R2.
- Existing W01 physical columns `users.reset_password_requested_at`, `media.prefix`, and `media._objectkey` are retained with Payload's supported Drizzle `afterSchemaInit` extension hook.
- PostgreSQL migrations are kept in `src/neon-postgres-migrations`; D1 files in `src/migrations` are never imported by this config.

CI uses disposable PostgreSQL 18 service databases named `luckread_schema` and `luckread_schema_rollback`. The schema verifier rejects other hosts/database names and confirms the primary database's business tables are empty. A second ephemeral database receives one synthetic `payload_kv` fixture to prove the generated `down` migration refuses to drop a non-empty schema and leaves the fixture intact. Only the Payload migration ledger is written during the baseline application.

The generated `down` migration first checks every W01 business table is empty, then drops tables in FK-safe order without `CASCADE`; any external dependency also blocks rollback. No workflow step reads Neon credentials, connects to Neon, changes D1, updates the production Payload config, enables automatic schema push, or imports business data. Never point this schema-only config at a remote production database.


## Controlled Neon D1-01 application

The already reviewed W01 baseline can be applied to the pre-created Neon `luckread` database only by the manual workflow:

`.github/workflows/neon-d1-01-w01-payload-schema-apply.yml`

The workflow is `workflow_dispatch` only, runs from `main` only, and requires the explicit confirmation input `INITIALIZE_EMPTY_D1_01_LUCKREAD`. It reads only the `NEON_DATABASE_URL_LUCKREAD` GitHub secret.

Before any DDL, the workflow:

1. Requires a Neon `*.neon.tech` PostgreSQL URL whose database path is exactly `/luckread`.
2. Requires TLS and channel binding, verifies the live TLS socket certificate, and checks PostgreSQL 18 / `current_database() = 'luckread'`.
3. Opens a `BEGIN READ ONLY` transaction and rejects any extra schema, relation, custom type, routine, non-default extension, or global database object.
4. Runs the committed Payload migration with `push: false`.
5. Re-checks the exact 11-table Payload catalog, exact column sets, source indexes, required relationships, and all business tables empty (only the Payload migration ledger row is allowed).

The workflow does not import accounts, media, content, social records, subscription rows, orders, payment rows, or analytics events. It does not change Cloudflare D1, Worker bindings, runtime connections, or production API traffic.

Do not run the workflow from any branch other than `main`. A non-empty target is deliberately blocked and must be reviewed manually, never cleaned automatically.
