# W01 Neon PostgreSQL Runtime and Schema Migrations

W01's active Payload runtime uses the official `@payloadcms/db-postgres@3.90.2` adapter through the LuckRead-owned Neon adapter. The active runtime has no Cloudflare D1 or SQLite fallback.

- `src/payload.config.ts` selects the Neon PostgreSQL adapter in the Worker runtime.
- `src/neon-postgres-adapter.ts` uses the official Payload PostgreSQL adapter, `push: false`, and `src/neon-postgres-migrations`.
- The official `@payloadcms/db-postgres` adapter remains in the W01 dependency graph; this cleanup leaves its existing dependency classification unchanged.
- R2 remains the media/object store through Payload's official R2 storage integration.
- The existing `Users` and `Media` Collections and supported Payload plugin extension points remain unchanged.

## Historical migration sources

`src/migrations` contains the earlier SQLite/D1 migration source set retained for schema provenance and reconciliation only. It is not the active migration directory and is excluded from the W01 TypeScript build. Those files must never be executed against Neon PostgreSQL. The active PostgreSQL migration authority is `src/neon-postgres-migrations`.

## Safety and deployment boundary

The schema-generation and rollback checks use disposable PostgreSQL 18 databases. The generated `down` migration refuses to drop a non-empty business schema and does not use `CASCADE`. Remote schema application and production traffic/deployment remain subject to their separately approved release gates; this dependency cleanup does not deploy a Worker, alter production secrets, migrate business data, or change traffic routing.

The logical domain identifier `D1-01` is retained in historical contracts as a database-domain label. It is not a Cloudflare D1 adapter or a runtime dependency.
