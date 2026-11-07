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
