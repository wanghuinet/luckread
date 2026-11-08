# Change Control — Neon Five-Domain PostgreSQL Schema Bootstrap

**Date:** 2026-11-08  
**Status:** `APPROVED_FOR_EMPTY_SCHEMA_INITIALIZATION_ONLY`  
**Authorization basis:** Explicit user direction to migrate the five existing data domains to the five pre-created Neon databases from an empty-data baseline; no account/content/business data import.  
**Scope:** Contract and schema-bootstrap stages only.  
**Production effect:** None. Cloudflare D1 remains the live production authority until a separate cutover decision is approved and verified.

## 1. Decision

Authorize a staged, schema-only PostgreSQL bootstrap on the five pre-created Neon databases. This is a bounded migration track behind the existing logical domain/API contracts; it is not an immediate production database replacement.

The five logical domain identities and their Worker ownership remain unchanged. Existing D1 bindings remain in place during schema development and verification. Neon is the approved PostgreSQL schema target for this migration track.

The empty-schema preflight completed successfully on all five targets:

- Workflow: [Neon Five Database Connectivity and Empty Schema Preflight](https://github.com/wanghuinet/luckread/actions/runs/42408288064)
- Main SHA inspected: `1eec18510a34ef94ab25c6fcde1ad0212ee70caf`
- Commit status: `Neon Empty Schema Preflight = success / PASS_EMPTY 5/5`
- PostgreSQL server reported by the five targets: `18.6`

The preflight ran in a read-only transaction and confirmed the default schema with no user relations or non-default user objects. It did not create any schema objects.

## 2. Five-domain target mapping

| Logical domain | Neon database | Schema authority / owners | Existing D1 source remains live |
|---|---|---|---|
| D1-01 — Identity, Payload account projection, creator and membership entitlement state | `luckread` | W01 Payload; W02 identity; W07 subscription identity/entitlement references; W08 creator | Yes |
| D1-02 — Content and community/social | `luckreadpro` | W03 content; W05 social | Yes |
| D1-03 — Governance and platform runtime | `luckread_governance` | W06 governance; W09 platform; W05's existing governance-scoped records | Yes |
| D1-04 — Commerce and finance | `luckread_finance` | W07 orders, payment, billing and financial authority | Yes |
| D1-05 — Analytics only | `allluck` | W11 exclusively | Yes |

The database names above are normalized PostgreSQL database names. The historical Wrangler D1 binding names and IDs remain unchanged until a separate runtime-adapter and cutover change control.

No cross-domain database foreign keys or distributed transactions are introduced. Cross-domain references remain opaque IDs governed by the existing domain contracts.

## 3. Authorized operations

This change authorizes only:

1. Repository-side PostgreSQL schema design, migration source generation, deterministic migration packaging, and CI validation.
2. Connection and read-only catalog verification against the five Neon targets.
3. Applying reviewed, versioned schema-only migrations to the matching Neon database after a PR and CI review.
4. Creating a dedicated migration ledger needed to make each schema migration deterministic and idempotent.
5. Inserting only migration bookkeeping/provenance rows required to record applied schema versions.

Schema initialization must be one logical domain at a time, beginning with D1-01. Each domain must pass its own schema, constraints, index, transaction, rollback/recovery and migration replay tests before the next domain starts.

The first implementation slice is D1-01. Its source inventory must include the W01 Payload collections and supported Payload migrations, W02 Better Auth and W02-owned D1-01 migrations, W07's D1-01 membership/entitlement migrations, and W08's creator authorization migrations. Those authorities must remain separate even though they share one physical database.

## 4. Explicitly excluded

This change does **not** authorize:

- importing or copying any existing accounts, users, credentials, sessions, content, media, social graph, subscriptions, payment records, analytics events or other business rows;
- seeding production identities, creator roles, admin accounts, plans, prices, payment methods or application content;
- changing Cloudflare D1 schemas, deleting D1 data, or stopping D1 migrations;
- changing production Worker bindings, database URLs, Hyperdrive bindings, Service Bindings, Queues, Workers or R2;
- changing Payload Core, forking Payload, or using undocumented Payload internals;
- changing public API/DTO semantics or domain authority;
- dual-authoritative writes, uncontrolled dual writes, or silent write routing to Neon;
- production traffic cutover, D1 retirement, or rollback-point removal.

A PostgreSQL migration ledger is schema provenance, not an import of business data.

## 5. Required implementation properties

- **Official adapters:** use Payload's supported PostgreSQL adapter and Better Auth's supported PostgreSQL persistence path. Do not emulate SQLite/D1 with a connection-string substitution.
- **W02 application SQL:** Better Auth's built-in PostgreSQL adapter does not port W02's own D1 code. W02 currently uses `D1Database.prepare/bind/first/run/batch` across identity, session, authorization, lifecycle and outbox paths. Each owning module must receive a PostgreSQL query/transaction implementation and tests; do not put a fake D1 shim in front of PostgreSQL or alter business semantics to make SQL appear portable.
- **Payload migrations:** current W01 migration files import `@payloadcms/db-d1-sqlite`; they are not PostgreSQL migration files. Generate a PostgreSQL-native migration baseline from the W01 Payload config using the official `@payloadcms/db-postgres` adapter and reconcile it against the existing W01 schema/contracts. Do not invoke the D1 migration runner against Neon.
- **Domain ownership:** preserve W01/W02/W03/W05/W06/W07/W08/W09/W11 responsibility as mapped above.
- **Schema determinism:** version every migration; record checksum; reject changed content for an already-applied version; serialize migrations per database; use PostgreSQL transactions where supported.
- **Fail closed:** reject wrong database names, wrong target domain, unknown pre-existing objects, checksum drift, missing prerequisites or unsupported SQL semantics.
- **No destructive cleanup:** bootstrap scripts must never drop schemas, tables, indexes or extensions to make a target appear empty.
- **Least privilege:** separate migration credentials from Worker runtime credentials. Runtime credentials must not own the database or have DDL privileges.
- **TLS:** use `sslmode=verify-full&channel_binding=require` in connection URLs. Avoid relying on the current `pg` driver's transitional interpretation of `sslmode=require`.
- **Compatibility:** map D1/SQLite booleans, epoch timestamps, JSON text, identity generation, partial indexes, constraints, triggers and transactions explicitly to PostgreSQL semantics.
- **Payload boundary:** keep Payload Core unchanged. W01 adapter changes must use official Payload extension/configuration points only.
- **Security:** never print connection strings, passwords, tokens, private keys or row payloads in workflow logs.

## 6. Per-domain execution sequence

1. Freeze the source inventory and ownership map.
2. Generate/review the PostgreSQL schema from authoritative contracts and supported adapters.
3. Validate the migration package statically and check SQL for unhandled SQLite-only syntax.
4. Run a fresh PostgreSQL 18 test instance and apply migrations from an empty database.
5. Verify tables, columns, types, defaults, constraints, indexes, triggers/functions and migration checksums against the expected manifest.
6. Run targeted repository tests for the owning Worker and adapter boundary.
7. Apply the same reviewed schema migration to the matching Neon target only after the PR and CI are green.
8. Re-run read-only catalog verification and store evidence.
9. Stop after that domain's schema-only slice is complete; do not proceed to the next domain until the result is recorded.

Domain order: D1-01 → D1-02 → D1-03 → D1-04 → D1-05.

## 7. Production cutover remains a separate gate

A separate change control is required before any Worker or Payload runtime starts using Neon for authoritative production traffic. It must include:

- completed PG-001..PG-009 compatibility evidence;
- a provider/adapter design for every Worker that currently binds the corresponding D1 domain;
- unit, integration, contract, security and production-like E2E tests;
- latency, connection-pool, capacity, backup/restore and failure-recovery evidence;
- secrets and least-privilege runtime/migration role configuration;
- a single-writer cutover plan, DNS/API routing plan where needed, observability and rollback;
- explicit approval to switch the production authority;
- post-cutover reconciliation and a defined D1 retirement decision.

Until then, Cloudflare D1 remains authoritative for production writes. The existence of empty Neon schemas is not evidence of runtime readiness.

## 8. Stop conditions

Stop the affected domain immediately if its schema cannot be reconciled to a canonical entity/field contract, a migration requires undocumented Payload internals, SQL semantics differ without an explicit mapping, domain ownership becomes ambiguous, the target contains unexpected objects, or runtime code would require dual-authoritative writes.

Record the gap and keep the remaining databases untouched.

## 9. Completion criteria for this change control

This change control is complete when the repository has an agreed five-domain schema map and a reviewed, deterministic schema-bootstrap implementation contract. It does not claim that any Neon database has yet received application tables, that any Worker has been switched, or that production migration/cutover is complete.


## 10. Implementation progress — 2026-11-08

- PR #1619 added the W02 MFA PostgreSQL schema source. PR #1620 added the W07 D1-01 membership/entitlement schema source. PR #1621 added the W08 Creator schema source. These schema slices were verified on disposable PostgreSQL 18 CI and merged to main.
- PR #1622 added the append-only shared schema migration ledger contract/DDL and the ordered 14-entry D1-01 migration manifest. Its PostgreSQL 18 ledger CI, Mapping 0 and Contract Admission checks passed before merge.
- The owner-specific W01 remote apply path is permanently denied. Only a future reviewed shared runner may become an eligible remote apply path.
- PR #1624 generates the Better Auth 1.7.8 PostgreSQL core schema twice through W02's official pinned CLI and requires byte-identical output. The generated artifact is committed at `workers/W02-identity/artifacts/neon/w02-better-auth-postgres-schema.sql`; SHA-256: `32705a1bb3aba85e0d831d65191f07d1aa08574a3d86d87e5b332de81d952593`. The workflow now fails if regenerated SQL differs from the committed artifact.
- Disposable PostgreSQL 18 evidence: exactly five Better Auth core tables (`user`, `session`, `account`, `verification`, `twoFactor`) and five indexes; core business tables remained empty. The W02 custom schema migrations 0001..0010 and their targeted postflight checks passed in the same disposable run. No Neon target was contacted.
- Current implementation slice: D1-01 migration planner plus committed W02 Better Auth schema artifact. The 14-entry manifest now has all committed artifacts/checksums; ledger schema remains uninstalled, shared runner remains unimplemented, and remote apply remains disabled.
- Next slices are intentionally separate: (1) full local PostgreSQL 18 rehearsal of all D1-01 owners in manifest order, with W01 Payload's native migration path treated separately; (2) read-only remote target preflight; (3) shared runner transaction/ledger implementation; (4) Payload native migration reconciliation. No business data import or production cutover is included.


## 11. D1-01 full local PostgreSQL 18 rehearsal — implementation slice

- Build a single disposable PostgreSQL 18 rehearsal that applies the committed manifest in order: W01 Payload native migration; W02 Better Auth core plus W02 custom migrations 0001..0010; W07 membership; W08 creator.
- Preserve each owner's existing deep verifier. The W07/W08 SQL verifiers now accept only the previously registered D1-01 owner table union while continuing to reject any table outside the declared W01/W02/W07/W08 set.
- After owner migrations complete, install and verify the append-only shared ledger, then record exactly fourteen local rehearsal provenance rows using the manifest artifact and manifest-entry checksums.
- The final combined verifier checks the exact table union, Worker ownership collisions, same-owner-only foreign keys, empty business tables, the single Payload schema migration record, and all fourteen ledger rows.
- This is a CI-only disposable PostgreSQL test. It does not connect to Neon, execute remote DDL, import business rows, mutate Cloudflare D1, change Worker runtime bindings or authorize production cutover.
