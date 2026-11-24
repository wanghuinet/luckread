# W01 Neon PostgreSQL Runtime and Schema Migrations

W01's active Payload runtime uses the official `@payloadcms/db-postgres@3.94.1` adapter as a runtime dependency through the LuckRead-owned Neon adapter.

- `src/payload.config.ts` selects the Neon PostgreSQL adapter in the Worker runtime.
- `src/neon-postgres-adapter.ts` uses the official Payload PostgreSQL adapter, `push: false`, and `src/neon-postgres-migrations`.
- `@payloadcms/db-postgres@3.94.1` and `pg@8.23.1` are runtime dependencies.
- The upstream Payload 3.94.1 adapter contains the PostgreSQL bootstrap pool-client release fix; no local patch is applied.
- R2 remains the media/object store through Payload's official R2 storage integration.
- Next.js 16.4.6, React 19.3.1, TypeScript 6.0.3, OpenNext 1.20.18, Wrangler 4.166.0, and Node 24.22.3 form the validated upgrade baseline.

## Historical migration sources

`src/migrations` contains the earlier SQLite/D1 migration source set retained for schema provenance and reconciliation only. It is not the active migration directory and is excluded from the W01 TypeScript build. Those files must never be executed against Neon PostgreSQL. The active PostgreSQL migration authority is `src/neon-postgres-migrations`.

## Safety and deployment boundary

The schema-generation and rollback checks use disposable PostgreSQL 18 databases. The generated `down` migration refuses to drop a non-empty business schema and does not use `CASCADE`. Remote schema application and production traffic/deployment remain subject to their separately approved release gates; this dependency upgrade does not deploy a Worker, alter production secrets, migrate business data, or change traffic routing.

The logical domain identifier `D1-01` is retained in historical contracts as a database-domain label. It is not a Cloudflare D1 adapter or a runtime dependency.
