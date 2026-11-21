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

The W06 `0001_audit_event.sql` file remains the legacy Cloudflare D1 compatibility migration source; it is fingerprinted/reconciled only and is never executed against Neon. The W09-owned `src/audit-event-postgres-adapter.ts` is the runtime SQL boundary used by W06's existing D1-03 PostgreSQL compatibility bridge when Neon is selected. It permits only AuditEvent `SELECT` and `INSERT`, preserves caller-owned batch transactions and D1 `changes()` ordering, and rejects UPDATE/DELETE/TRUNCATE/REPLACE operations. W06 keeps its existing Cloudflare D1 fallback; this adapter adds no Worker, service binding, or independent connection.

## W09 logical-owner / schema-source reconciliation

- Machine-readable reconciliation: `contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json`.
- Executable guard and regression tests: `scripts/neon/verify-d1-03-w09-owner-reconciliation.mjs` and its `.test.mjs` companion; the guard runs in the W09 PostgreSQL 18 rehearsal workflow.
- The canonical W09 logical owner set includes `AuditEvent`, `NotificationPushEndpoint`, `PlatformRuntime`, `ReconciliationOperation`, and `RecoveryOperation`.
- Only `AuditEvent` and `NotificationPushEndpoint` currently have admitted physical schema sources. The other three are explicitly recorded as logical-owner-only / schema-not-admitted because no W09 entity-field contract, persistence contract, or source migration is admitted.
- Do not generate placeholder tables for those three entities from the owner map. Each requires its own field/persistence/source admission and PostgreSQL 18 rehearsal before physical schema inclusion.

## D1 migration boundary

`wrangler.d1-03-migrations.jsonc` is a migration-only Cloudflare D1 configuration for the existing `secondary` database. It is not a Worker deployment configuration.

Platform, storage and reliability execution belongs to W09. Index/recommendation read-model authority belongs to W04. W09 does not acquire authoritative ownership of feed/search/recommendation data by path inference.

No schema-only workflow imports business rows, mutates Cloudflare D1 or authorizes production cutover.
