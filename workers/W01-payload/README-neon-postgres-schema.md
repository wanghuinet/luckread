# W01 PostgreSQL Schema Generation (D1-01)

This is a schema-only Payload adapter path for the staged Neon migration.

- Production continues to use `src/payload.config.ts`, `@payloadcms/db-d1-sqlite@3.90.2`, D1-01 and R2.
- `src/neon-postgres-schema.config.ts` uses the pinned official `@payloadcms/db-postgres@3.90.2` adapter.
- The existing `Users` and `Media` Collections, redirects configuration, and R2 metadata fields are reused.
- The R2 plugin is disabled for schema generation while `alwaysInsertFields: true` keeps its database fields present; no R2 bucket I/O is enabled.
- The existing `users.reset_password_requested_at` column is retained with Payload's supported Drizzle `afterSchemaInit` hook.
- PostgreSQL migrations are kept in `src/neon-postgres-migrations`; D1 files in `src/migrations` are never imported by this config.

CI uses only a disposable PostgreSQL 18 service database named `luckread_schema`. The verifier rejects any other host/database combination and confirms business tables are empty. It may write the Payload migration bookkeeping row only.

No workflow step reads Neon credentials, connects to Neon, changes D1, updates the production Payload config, enables automatic schema push, or imports business data. Never point this schema-only config at a remote production database.
