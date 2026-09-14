# LuckRead 1.0 Reuse Closure — Batch R8 Data / Migration / Portability v1.0

> Status: **CLOSED / REUSE ALLOCATED / DATA PORTABILITY FOUNDATION LOCKED**

## 1. Objective

Formally consolidate the existing Data, Cloudflare, Payload compatibility, PostgreSQL/GCP portability, schema migration, backfill and disaster-recovery assets into the 2.0 canonical implementation boundary.

This batch creates no second data authority and does not require a new database architecture.

Implementation rule:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

## 2. Canonical source assets

The following existing contracts are the reuse base:

- `contracts/database/cloudflare-d1-pg-portability.v1.json`
- `contracts/database/cloudflare-d1-payload-compatibility.v1.json`
- `docs/162-SCHEMA-MIGRATION-COMPATIBILITY-BACKFILL-CONTRACT-v1.0.md`
- `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- existing Backup / DR / BCP contract assets
- existing Data / PostgreSQL portability assets
- existing Payload database compatibility and migration assets

The portability contract already requires application logic to avoid PostgreSQL-only behavior without a portable fallback, application-owned tables to remain independent of undocumented Payload internals, and stable application identifiers to be used as domain keys. fileciteturn289file1

The Payload compatibility contract already defines the boundary around Payload collections, authentication, migrations, generated schema and APIs, while preventing application design from depending on undocumented internals. fileciteturn289file0

The migration contract already establishes Expand → Compatible Read → Backfill → Verification → Switch → Cleanup and requires explicit migration ownership, checkpoints, idempotency, reconciliation and rollback/forward-fix. fileciteturn292file0

## 3. Canonical data authority

```text
Domain Contract
    -> Application-owned data model
    -> Payload adapter / database adapter
    -> Current Cloudflare implementation
    -> Future PostgreSQL/GCP implementation
```

Cloudflare is an implementation environment, not the domain data contract.

Payload is an application framework boundary, not a reason to expose or depend on Payload internal persistence details.

## 4. Reuse disposition

| Capability | Canonical owner | Disposition | Decision |
|---|---|---|---|
| DATA feature inventory | DATA | ALREADY-ABSORBED | Use Blueprint DATA-001..011 |
| Schema versioning | DATA / MIGRATION | DIRECT-REUSE | Existing migration contract |
| Seed / bootstrap | DATA | DIRECT-REUSE | Versioned and repeatable |
| Backup / restore | DATA / OPS | DIRECT-REUSE | Existing DR/BCP authority |
| Import / export | DATA | DIRECT-REUSE | Stable contract, provider-neutral format |
| Retention / deletion | DATA / PRIVACY | MERGE | Respect legal/privacy policy |
| PII classification | DATA / PRIVACY | MERGE | Apply classification and access policy |
| Data access / deletion | DATA / PRIVACY | MERGE | Auditable subject operations |
| Data lineage | DATA / ANALYTICS | MERGE | Analytics remains derived |
| Cloudflare D1 adapter boundary | CF | DIRECT-REUSE | Infrastructure-specific implementation only |
| R2 object boundary | STORAGE | DIRECT-REUSE | Domain stores provider-neutral object reference |
| KV / cache boundary | CF / STORAGE | DIRECT-REUSE | Never authoritative business storage |
| Queue boundary | JOB / CF | DIRECT-REUSE | Async transport only |
| Cron boundary | JOB / CF | DIRECT-REUSE | Scheduling transport only |
| Payload compatibility | PAYLOAD / DATA | DIRECT-REUSE | No undocumented internal dependency |
| Payload migrations | PAYLOAD / MIGRATION | DIRECT-REUSE | Versioned migration evidence |
| Application-owned tables | DATA | DIRECT-REUSE | Portable schema ownership |
| PostgreSQL portability | PG | ALREADY-ABSORBED | Use PG-001..009 |
| GCP migration boundary | PG / OPS | DIRECT-REUSE | Provider migration, not domain rewrite |
| Schema compatibility | MIGRATION | ALREADY-ABSORBED | Reuse `162-*` contract |
| Backfill | JOB / DATA | DIRECT-REUSE | Checkpointed, idempotent, reconcilable |
| Derived data rebuild | SEARCH / ANALYTICS / CACHE | MERGE | Rebuild rather than distort authority |
| Disaster recovery | OPS / DATA | ALREADY-ABSORBED | Existing BCP/DR contract |
| Data reconciliation | DATA / OPS | MERGE | Explicit owner and evidence |
| Vendor-specific SQL | DATA / PG | REJECT | Unless portable fallback is contracted |
| Payload internal table dependency | PAYLOAD | REJECT | No undocumented schema coupling |
| Database-generated identity as domain identity | DATA | REJECT | Stable application IDs are canonical |
| Cache as authoritative data | STORAGE | REJECT | Cache is derived |
| Replica as security/authorization authority | DATA | REJECT | Security-sensitive state uses authoritative consistency |

## 5. Stable identity and schema portability

Domain entities must use stable application identifiers rather than database-specific generated row identity as the business key.

Foreign-key relationships must be expressible across the current SQLite/D1 environment and PostgreSQL without depending exclusively on vendor-specific behavior.

Application-owned schema must remain migratable independently of Payload internal table names.

## 6. Cloudflare-first boundary

Current implementation may use:

```text
Workers
D1
R2
KV / Cache
Queues
Cron
WAF / Turnstile
```

But contracts must describe portable domain semantics rather than Cloudflare-only business behavior.

Examples:

- object references must not encode an irreversible R2-only domain assumption;
- queues are transport, not business truth;
- KV/cache are projections, not authoritative records;
- scheduled execution is replaceable by another scheduler;
- D1 is replaceable by PostgreSQL;
- Cloudflare security services are boundary controls, not domain authorization.

## 7. D1 primary / replica consistency

Existing compatibility rules remain authoritative:

- writes are authoritative on primary;
- replicas are not assumed immediately consistent;
- authentication, authorization, idempotency and security-sensitive state use an authoritative consistency path;
- feeds and analytics may use bounded staleness only when declared by contract;
- read-after-write requirements must be explicit. fileciteturn290file0

No new replica authority is introduced by R8.

## 8. Migration lifecycle

All schema/data migrations follow:

```text
PLANNED
 -> APPROVED
 -> READY
 -> RUNNING
 -> VALIDATING
 -> COMPLETED
```

Exceptional states:

```text
PAUSED / FAILED / ROLLED_BACK / CANCELLED
```

Preferred deployment sequence:

```text
Schema Expand
 -> Compatible Code
 -> Backfill
 -> Validation
 -> Traffic / Feature Switch
 -> Cleanup
```

A migration process returning exit code 0 is not itself evidence that business migration completed.

## 9. Backfill invariants

Backfill must support:

```text
batching
rate limit
pause/resume
checkpoint
retry
idempotency
progress
final count
error count
reconciliation
```

Every backfill defines a selection boundary, watermark/snapshot, write policy and conflict policy. Old data must never silently overwrite newly-created data.

## 10. Backup / restore / portability

Backup and restore must preserve authoritative data, object references, event history where required, migration metadata and recovery evidence.

Derived indexes, caches and analytics projections should be rebuildable from authoritative sources.

A migration to PostgreSQL/GCP must therefore be a controlled adapter/storage migration rather than a domain-model rewrite.

## 11. Payload boundary

Payload remains the application framework and supported extension boundary.

Allowed:

- Payload collections and supported configuration;
- Payload migrations;
- supported database adapters;
- application-owned contracts and extension points;
- explicit API/DTO contracts.

Forbidden:

- depending on undocumented Payload internal table names;
- treating generated persistence schema as the public domain contract;
- modifying Payload Core to encode business rules;
- exposing internal persistence schema to clients;
- coupling domain identifiers to a provider-specific row identity.

## 12. Cost and operational safety

Large migrations/backfills must estimate:

```text
D1 reads/writes
Worker execution
Queue usage
R2/network effects
expected duration
rate cap
resource pressure
```

The system must support pause/resume rather than requiring an all-at-once migration.

## 13. Explicit rejection

R8 rejects:

- Cloudflare-specific domain schemas;
- direct dependence on D1-only SQL semantics without fallback;
- direct dependence on PostgreSQL-only extensions without fallback;
- Payload undocumented internal schema as a contract;
- database-generated IDs as portable business identity;
- cache/KV as authoritative domain storage;
- replica reads as authorization truth;
- destructive cleanup before validation;
- irreversible migration without recovery/forward-fix planning;
- backfill without checkpoint/reconciliation;
- provider-specific object identifiers becoming permanent domain semantics.

## 14. Implementation readiness boundary

R8 closes **reuse/allocation**, not runtime implementation.

Required implementation chain remains:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Unit/Integration/Security/Concurrency Tests -> CI -> GitHub SHA -> Evidence`

## 15. R8 closure decision

**CLOSED at reuse/allocation level.**

No second data authority, no second migration framework and no Cloudflare-only domain architecture are authorized.

The project can implement against the current Cloudflare/Payload stack while retaining a defined migration path to standard PostgreSQL/GCP.

Next batch: **R9 — CI / Validator / Evidence reuse closure.**
