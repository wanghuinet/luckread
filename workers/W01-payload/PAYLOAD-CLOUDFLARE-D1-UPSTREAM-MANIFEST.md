# Payload Cloudflare D1 Upstream Manifest — Historical Provenance

Status: HISTORICAL_UPSTREAM_OBSERVATION_NOT_ACTIVE_RUNTIME

## Upstream source observation

- Repository: `payloadcms/payload`
- Template: `templates/with-cloudflare-d1`
- Upstream ref: `main`
- Upstream commit observed: `9a2cdcb87aacae41b66ab558a056d974c8f38f4e`
- Template `src/` tree: `6a3650d40b78110169641681f02e79f2dff667b2`
- Official template package manifest SHA: `b9d6de5442e65a7674e67f925f1b140f2d6738ef`
- Official template: https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1

This file preserves the historical origin of W01's Cloudflare/OpenNext scaffold. The upstream D1 adapter and migration setup are not the active W01 database architecture.

## Historical upstream package observation

The following versions belong only to the original upstream observation recorded by this manifest:
- Payload: `3.82.1`
- `@payloadcms/db-d1-sqlite`: `3.82.1`
- `@payloadcms/next`: `3.82.1`
- `@payloadcms/richtext-lexical`: `3.82.1`
- `@payloadcms/storage-r2`: `3.82.1`
- `@payloadcms/ui`: `3.82.1`
- `@opennextjs/cloudflare`: `^1.11.0`
- Next: `16.3.3`
- React / React DOM: `19.2.6`
- Node engine: `>=24.15.0`

These are not the current W01 dependency versions.

## Current W01 architecture (reconciled)

- W01 directory: `workers/W01-payload/`
- Payload package family: `3.90.2`
- `@opennextjs/cloudflare`: `1.20.1`
- Next: `16.3.3` as declared by the current package manifest.
- React / React DOM: `19.2.6`
- Node engine: `>=24.15.0`
- Database adapter: official `@payloadcms/db-postgres` through `src/neon-postgres-adapter.ts`.
- Database connection: existing Hyperdrive binding `HYPERDRIVE`, with `PAYLOAD_DATABASE_DRIVER=neon`.
- Active PostgreSQL migrations: `src/neon-postgres-migrations/`.
- R2 integration remains the official Payload R2 storage plugin.

The active Worker configurations `wrangler.jsonc` and `wrangler.neon.jsonc` declare Neon Hyperdrive and do not declare a D1 database binding. The W01 package manifest does not include `@payloadcms/db-d1-sqlite`.

## Historical migration provenance

`src/migrations/` retains SQLite/D1 source migrations for schema lineage and reconciliation. These are not the active Payload migration directory and must never be executed against Neon PostgreSQL. The active migration authority is `src/neon-postgres-migrations/`.

The logical domain label `D1-01` may remain in migration/evidence contracts as historical ownership lineage. It does not mean that W01 uses a Cloudflare D1 database.

## Evidence and safety

The active Neon implementation is verified by the W01 PostgreSQL adapter, fail-closed database-driver resolver, local PostgreSQL 18 runtime rehearsal, and schema verifier. The historical upstream observation itself does not establish current runtime compatibility.

No upstream Payload source is forked or patched by this manifest reconciliation. No remote schema application, production data change, Worker deployment, or traffic switch is authorized by this file.
