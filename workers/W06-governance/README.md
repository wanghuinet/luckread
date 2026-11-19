# W06 — Rights / Trust & Safety / Governance

Canonical Worker identity: **W06**  
Canonical responsibility: **Rights / Trust & Safety / Governance**  
Primary persistence domain: **D1-03** (historical migration source; production runtime uses the existing Neon Hyperdrive)

This directory is the canonical source-implementation boundary for the frozen W06 Worker.

Production deploys with `wrangler.neon.jsonc`, which declares no Cloudflare D1 binding and uses the existing D1-03 Neon Hyperdrive. The original `wrangler.jsonc` and D1 migrations remain as historical schema-source/local-test compatibility only.

Important governance constraints:

- Worker authority comes from the canonical Worker Master, not from directory names.
- The existing `workers/W06-media` directory is a historical/physical-layout mismatch and is not promoted as W06 authority.
- W09 is the frozen D1-03 primary owner for AuditEvent. W06 Report writes, direct AuditEvent HTTP ingestion and AUTH-013/AUTH-007/AUTH-010 queue consumers use native PostgreSQL Stores through the existing D1-03 Hyperdrive pool, with every AuditEvent SELECT/INSERT checked by W09's append-only SQL policy. Moderation decision and outbox persistence remain on the explicit compatibility bridge until separately migrated.
- AUTH-013 source implementation may consume W02 transition results but may not take ownership of D1-01 account-state mutation.
- No ad-hoc AuditEvent table may be created in W02.
- The existing physical D1-03 UUID remains recorded in the historical source config for migration provenance; the deployed W06 Worker uses the already admitted Neon `luckread_governance` schema and existing Hyperdrive binding.

Current source slice:

- canonical immutable AuditEvent construction; Report writes, direct AuditEvent HTTP routes and AUTH-013/AUTH-007/AUTH-010 audit queue consumers use native PostgreSQL Stores;
- AUTH-013 `identity.account_state_changed` audit record construction;
- strict version-increment validation.

## Moderation queue and case-detail reads

- The moderation queue and single-case detail endpoints use dedicated native PostgreSQL read Stores composed from the existing Neon Hyperdrive pool.
- Both moderation read routes fail closed when the existing Neon Hyperdrive binding is missing or invalid; neither constructs a D1 query adapter nor falls back to a D1-shaped database facade.
- The `/reports` route writes W06-owned `moderation_reports` and `moderation_report_idempotency` through a native PostgreSQL Store. It appends to W09-owned `audit_events` only after a successful new report insert, under the W09 append-only SQL policy and inside the same transaction.
- Same-key idempotency replay/conflict, 24-hour dedup buckets, report-plus-audit atomicity and sanitized persistence errors are covered by Store tests and the PostgreSQL 18 rehearsal.
- The AUTH-013 account-state, AUTH-007 MFA and AUTH-010 Session-revocation queue consumers share a native PostgreSQL AuditEvent Store; W09's SQL policy permits only the AuditEvent SELECT/INSERT statements, with the existing W09 table/trigger remaining authoritative.
- Consumer validation, event identity conflicts, duplicate delivery, W10 ACK/retry behavior and the native AuditEvent Store are covered by source tests and the disposable PostgreSQL 18 rehearsal.
- Direct `/internal/audit-events/*` HTTP ingestion now uses the same native AuditEvent Store for SELECT/INSERT and preserves route-specific semantic replay, exact immutable conflict checks, authenticated actor derivation, and 201/200/409/503 responses. The unused D1-only `audit-event-persistence.ts` adapter and its test were removed.
- The W06 Worker HTTP and scheduled entrypoints are PostgreSQL-native. No D1Database facade, D1 prepared-statement contract, SQLite placeholder translator, or D1 batch emulation remains in W06 runtime or rehearsal code. Decision, idempotency, AuditEvent and outbox writes retain their transaction and replay guarantees.

No remote D1 mutation or production deployment is implied by this source directory.


## Staged Neon D1-03 moderation schema

- W06 owns the staged PostgreSQL 18 schema for the seven physical moderation/report tables admitted by the existing D1 migrations 0002_moderation_queue_foundation.sql and 0003_moderation_report_v1.sql.
- The generated PostgreSQL artifact is workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql; its source contract and disposable PostgreSQL 18 rehearsal are maintained under contracts/database/neon-d1-03-w06-moderation-schema.v1.json and .github/workflows/neon-d1-03-w06-moderation-postgres-rehearsal.yml.
- Appeal remains a W06-owned logical capability but is not included as a physical table: the API/domain contract describes it, while the system contract still marks its implementation pending and no admitted W06 migration defines Appeal persistence.
- AuditEvent remains W09-owned. This schema does not create a duplicate audit_events table or alter W09's append-only triggers; W06 Report writes, direct audit HTTP ingestion and AUTH-013/AUTH-007/AUTH-010 queue consumers use the native Neon Store. Moderation decisions and enforcement outbox use native PostgreSQL Stores in the Worker runtime; the historical D1-03 identity remains only as schema/migration lineage.
- The PostgreSQL schema and owner postflight are already admitted for the W06 moderation runtime. This README describes schema ownership; it does not authorize a new production deployment or any business-data import.
