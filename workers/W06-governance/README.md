# W06 — Rights / Trust & Safety / Governance

Canonical Worker identity: **W06**  
Canonical responsibility: **Rights / Trust & Safety / Governance**  
Primary D1: **D1-03**

This directory is the canonical source-implementation boundary for the frozen W06 Worker.

Important governance constraints:

- Worker authority comes from the canonical Worker Master, not from directory names.
- The existing `workers/W06-media` directory is a historical/physical-layout mismatch and is not promoted as W06 authority.
- W09 is the frozen D1-03 primary owner for AuditEvent. W06 retains the existing Cloudflare D1 compatibility write path only until a separate runtime-adapter slice moves publication/persistence to the W09 owner boundary.
- AUTH-013 source implementation may consume W02 transition results but may not take ownership of D1-01 account-state mutation.
- No ad-hoc AuditEvent table may be created in W02.
- Physical Cloudflare Worker name and D1-03 UUID are not yet admitted in the current repository; deployment remains blocked until explicit physical-binding evidence exists.

Current source slice:

- canonical immutable AuditEvent construction and legacy Cloudflare D1 compatibility persistence;
- AUTH-013 `identity.account_state_changed` audit record construction;
- strict version-increment validation.

No remote D1 mutation or production deployment is implied by this source directory.


## Staged Neon D1-03 moderation schema

- W06 owns the staged PostgreSQL 18 schema for the seven physical moderation/report tables admitted by the existing D1 migrations 0002_moderation_queue_foundation.sql and 0003_moderation_report_v1.sql.
- The generated PostgreSQL artifact is workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql; its source contract and disposable PostgreSQL 18 rehearsal are maintained under contracts/database/neon-d1-03-w06-moderation-schema.v1.json and .github/workflows/neon-d1-03-w06-moderation-postgres-rehearsal.yml.
- Appeal remains a W06-owned logical capability but is not included as a physical table: the API/domain contract describes it, while the system contract still marks its implementation pending and no admitted W06 migration defines Appeal persistence.
- AuditEvent remains W09-owned. This schema does not create a duplicate audit_events table or change the existing W06 Cloudflare D1 compatibility path.
- This is a staged schema source only. It does not run remote Neon DDL, change D1 bindings, import business data, deploy a Worker, or authorize production cutover.
