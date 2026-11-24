# W01 — Platform / Payload

Role: Payload-based platform and H5 administration runtime.

## Active runtime baseline

- Payload package family: 3.94.1.
- Next.js: 16.4.6.
- React / React DOM: 19.3.1.
- TypeScript: 6.0.3.
- OpenNext Cloudflare: 1.20.18.
- Wrangler: 4.166.0 (latest version admitted by the 24-hour dependency release-age policy).
- Node.js: 24.22.3 in CI; supported range follows the Payload 3.94.x engine declaration.
- Database: Neon PostgreSQL through the LuckRead-owned adapter and official `@payloadcms/db-postgres@3.94.1` runtime dependency.
- Media/object storage: official Payload R2 integration.

## Runtime boundaries

- Payload Core, Admin and official adapters remain upstream packages; do not fork or modify their core implementation.
- `src/payload.config.ts` selects the Neon adapter.
- `src/neon-postgres-adapter.ts` keeps `push: false` and uses `src/neon-postgres-migrations/`.
- `pg` remains the PostgreSQL driver; Hyperdrive is the Cloudflare connection binding.
- `wrangler.jsonc` and `wrangler.neon.jsonc` are the Worker configurations. Neither declares a Cloudflare D1 database binding.
- The OpenNext asset binding uses explicit exact-path handling because `run_worker_first` is enabled.

## Historical D1 provenance

The original `templates/with-cloudflare-d1` scaffold and `src/migrations/` SQLite/D1 migrations are retained only for provenance and schema reconciliation. They are not the active database adapter or migration directory and must never be executed against Neon PostgreSQL. See `PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md`.

## Release validation

The W01 upgrade is not accepted until the root npm lockfile and W01 pnpm lockfile are reproducible, dependency audits pass, TypeScript and unit checks pass, Next.js and OpenNext Worker builds pass, and the disposable PostgreSQL 18 schema/runtime rehearsals pass. These checks do not authorize remote Neon DDL, production deployment, or traffic changes.
