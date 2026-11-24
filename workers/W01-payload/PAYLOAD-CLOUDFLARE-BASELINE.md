# W01 Payload — Cloudflare Runtime Baseline

Status: NEON-POSTGRESQL-RUNTIME

## Active runtime boundary

W01 runs Payload Core on the existing Cloudflare Worker + OpenNext runtime, with Neon PostgreSQL as its only database provider.

- Payload Core / Admin runtime remains the official Payload implementation.
- Next.js + OpenNext Cloudflare runtime remains unchanged.
- Neon PostgreSQL is accessed through the existing Hyperdrive binding `HYPERDRIVE`.
- `PAYLOAD_DATABASE_DRIVER=neon` is required; the runtime fails closed when it is missing or unsupported.
- R2 remains the media/object storage integration through the official Payload R2 plugin.
- Existing Worker service bindings and rate-limit bindings remain unchanged.

The active configurations are `wrangler.jsonc` and `wrangler.neon.jsonc`; both declare the Neon Hyperdrive binding and do not declare a D1 database binding.

## Historical upstream template

The original W01 Cloudflare scaffold was derived from Payload's official `with-cloudflare-d1` template. That template observation is historical provenance only. It does not describe the current W01 database provider and does not authorize restoring the D1 adapter.

The detailed upstream observation is retained in `PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md`.

## Database and migration boundary

- Active runtime adapter: official `@payloadcms/db-postgres` through `src/neon-postgres-adapter.ts`.
- Active migration directory: `src/neon-postgres-migrations`.
- `src/migrations` contains historical SQLite/D1 source migrations retained for lineage and schema reconciliation only. It is excluded from the W01 TypeScript build and must not be executed against PostgreSQL.
- The historical logical domain label `D1-01` may remain in migration contracts; it is not a Cloudflare D1 runtime binding.

## Release safety

Local PostgreSQL rehearsals and schema verifiers do not authorize remote schema application, Worker deployment, production data changes, or traffic switching. Those actions remain behind their separate release gates and explicit authorization.

## Verification

W01's Neon-only runtime contract is verified by:
- `src/payload-database-driver.ts` fail-closed provider and Hyperdrive validation.
- `src/neon-postgres-adapter.ts` official Payload PostgreSQL adapter with `push: false`.
- `wrangler.jsonc` and `wrangler.neon.jsonc` Neon Hyperdrive configuration.
- `scripts/neon/rehearse-payload-postgres-runtime.mjs` local PostgreSQL 18 Payload create/update/read/delete rehearsal.
- `scripts/neon/verify-w01-payload-pg-schema.mjs` PostgreSQL schema verification.

No Payload Core, collection ownership, plugin implementation, R2 integration, historical migration source, or production resource is changed by this baseline reconciliation.
