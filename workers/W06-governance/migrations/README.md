# W06 D1-03 legacy Cloudflare D1 migrations

The files in this directory are Cloudflare D1/SQLite migration sources for the existing W06 runtime compatibility path.

- `0001_audit_event.sql` retains the historical D1 implementation used by the current W06 runtime.
- Canonical field contract: `contracts/schemas/common/audit-event.json`.
- Frozen D1-03 primary entity owner: **W09**, per `docs/09-D1-DOMAIN-MASTER-v1.0.md` and `contracts/transport/d1-03-entity-owner-boundary.v1.json`.
- W09-owned Neon PostgreSQL schema artifact: `workers/W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql`.

Do not execute this SQLite/D1 migration against Neon PostgreSQL. The W06 runtime remains on Cloudflare D1 during the staged schema bootstrap; its future W09 runtime-adapter transition is a separate gate. This documentation change does not mutate Cloudflare D1 or change Worker bindings.
