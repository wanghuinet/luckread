# W09 — Platform / Storage / Reliability

Canonical Worker identity: **W09**
Canonical responsibility: **Platform / Storage / Reliability**
Primary Task: **T25**
Primary D1 authority: **D1-03**

Canonical repository path: `workers/W09-platform`.

## D1-03 ownership

W09 is the primary owner of:

- `AuditEvent`: immutable, append-only platform audit persistence.
- `NotificationPushEndpoint`: Expo push endpoint registry.

W05/T14 has only the explicit self-service endpoint PUT/DELETE and owner-scoped notification-delivery read / conditional invalid-token-clearing delegations. W05 does not own the D1-03 schema or general D1-03 runtime state.

## Neon PostgreSQL schema slice

- Source contract: `contracts/database/neon-d1-03-w09-platform-schema.v1.json`.
- Deterministic PostgreSQL artifact: `src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql`.
- Generator/template: `scripts/neon/generate-d1-03-w09-postgres-migration.mjs` and `scripts/neon/templates/d1-03-w09-platform-postgres.sql`.
- Local PostgreSQL 18 rehearsal: `.github/workflows/neon-d1-03-w09-platform-postgres-rehearsal.yml`.

The W06 `0001_audit_event.sql` file remains the legacy Cloudflare D1 compatibility migration source for the current W06 runtime. It is fingerprinted/reconciled only; it is never executed against Neon. W06's runtime path remains unchanged until a separately reviewed W09 runtime-adapter slice.

## D1 migration boundary

`wrangler.d1-03-migrations.jsonc` is a migration-only Cloudflare D1 configuration for the existing `secondary` database. It is not a Worker deployment configuration.

Platform, storage and reliability execution belongs to W09. Index/recommendation read-model authority belongs to W04. W09 does not acquire authoritative ownership of feed/search/recommendation data by path inference.

No schema-only workflow imports business rows, mutates Cloudflare D1 or authorizes production cutover.
