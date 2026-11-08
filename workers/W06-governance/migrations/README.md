# W06 D1-03 schema sources

This directory contains the existing Cloudflare D1/SQLite migration sources. They remain the current runtime compatibility source while Neon schema bootstrap is staged.

## Existing schema ownership

- 0001_audit_event.sql is the legacy Cloudflare D1 implementation used by the current W06 compatibility path. AuditEvent is now owned by W09 in D1-03; do not create a second W06 PostgreSQL AuditEvent table.
- 0002_moderation_queue_foundation.sql is the admitted W06 source for moderation cases, decisions, decision idempotency, transaction guard and enforcement outbox.
- 0003_moderation_report_v1.sql is the admitted W06 source for reports and report idempotency.
- Canonical moderation persistence contract: contracts/persistence/MODERATION-QUEUE-FOUNDATION-persistence.v1.json.
- Canonical D1-03 Worker owner partition: contracts/transport/d1-03-entity-owner-boundary.v1.json.

## PostgreSQL 18 translation

The staged W06-owned PostgreSQL artifact is generated from the admitted sources and contracts:

- Schema contract: contracts/database/neon-d1-03-w06-moderation-schema.v1.json
- Generator: workers/W06-governance/scripts/neon/generate-d1-03-w06-postgres-migration.mjs
- Template: workers/W06-governance/scripts/neon/templates/d1-03-w06-moderation-postgres.sql
- Generated migration: workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql
- Disposable PG18 rehearsal: .github/workflows/neon-d1-03-w06-moderation-postgres-rehearsal.yml

The admitted slice contains 7 tables, 11 explicit indexes, 0 triggers and 0 foreign keys. Timestamp columns use PostgreSQL TIMESTAMPTZ; report evidence references use JSONB with the existing JSON-array invariant; response payloads remain TEXT because the source has no JSON validity constraint. Opaque user/content identifiers remain non-FK values.

Appeal is intentionally excluded. The Report/Appeal API contract describes appeal behavior, but docs/63-MODERATION-APPEALS-SYSTEM-CONTRACT-v1.0.md currently marks implementation pending and the admitted migrations contain no Appeal persistence table. Do not invent one until a dedicated persistence contract and source migration are admitted.

Do not execute the D1/SQLite migrations against Neon PostgreSQL. The local rehearsal uses a disposable PostgreSQL 18.6 service only. No remote Neon connection, Cloudflare D1 mutation, business-data import, Worker runtime/binding change, or production cutover is authorized by this schema source.
