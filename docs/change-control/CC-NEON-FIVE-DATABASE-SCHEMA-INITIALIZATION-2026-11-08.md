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
- Historical snapshot: at this point the D1-01 migration planner and W02 artifacts were committed, while the full owner rehearsal and shared runner were still pending. Their later completion and review evidence are recorded in Sections 11 and 14 below.


## 11. D1-01 full local PostgreSQL 18 rehearsal — implementation slice

- Build a single disposable PostgreSQL 18 rehearsal that applies the committed manifest in order: W01 Payload native migration; W02 Better Auth core plus W02 custom migrations 0001..0010; W07 membership; W08 creator.
- Preserve each owner's existing deep verifier. The W07/W08 SQL verifiers now accept only the previously registered D1-01 owner table union while continuing to reject any table outside the declared W01/W02/W07/W08 set.
- After owner migrations complete, install and verify the append-only shared ledger, then record exactly fourteen local rehearsal provenance rows using the manifest artifact and manifest-entry checksums.
- The final combined verifier checks the exact table union, Worker ownership collisions, same-owner-only foreign keys, empty business tables, the single Payload schema migration record, and all fourteen ledger rows.
- This is a CI-only disposable PostgreSQL test. It does not connect to Neon, execute remote DDL, import business rows, mutate Cloudflare D1, change Worker runtime bindings or authorize production cutover.


## 12. Five-database read-only target preflight — implementation slice

- Reuse the existing five-database connectivity workflow and its five configured Actions secrets:
  - D1-01 `luckread` / `NEON_DATABASE_URL_LUCKREAD`
  - D1-02 `luckreadpro` / `NEON_DATABASE_URL_LUCKREADPRO`
  - D1-03 `luckread_governance` / `NEON_DATABASE_URL_GOVERNANCE`
  - D1-04 `luckread_finance` / `NEON_DATABASE_URL_FINANCE`
  - D1-05 `allluck` / `NEON_DATABASE_URL_ALLLUCK`
- The new inspection verifies the exact database name and Neon host, requires channel binding, verifies the TLS certificate chain and hostname, and requires PostgreSQL major version 18 before reading the catalog.
- Catalog inspection is performed inside `BEGIN READ ONLY` and always rolled back. It records schema/relations/types/routines/extensions/global-object metadata, checks the shared migration ledger's presence and row count (only when the ledger exists), and does not read business row payloads.
- `PASS_EMPTY` requires the default `public` schema only, no user-defined database objects or non-default extensions, and no migration ledger table. An existing empty ledger is still a blocker because the expected pre-bootstrap state is that the ledger is absent.
- Any non-empty target is blocked for manual review. The workflow never drops, repairs, creates or changes database objects.
- The connectivity workflow is now manual-dispatch-only on `main` with an exact read-only confirmation. PRs run only local syntax/unit tests; the PR validation job receives no Neon secrets. This avoids exposing connection credentials to PR-controlled workflow code.
- This slice does not authorize or perform schema application, migration-ledger installation, business-data import, Cloudflare D1 mutation, Worker runtime/binding changes or production cutover.
- The earlier `PASS_EMPTY 5/5` record remains historical evidence from the original preflight run. The hardened preflight must be manually dispatched after this PR is merged to collect fresh five-target evidence under the stricter checks.


## 13. D1-01 W01 Payload baseline reconciliation — safety follow-up

- The hardened five-database read-only preflight on workflow run [42452559295](https://github.com/wanghuinet/luckread/actions/runs/42452559295) returned `PASS_EMPTY 4/5` and `D1-01 luckread = BLOCKED_NOT_EMPTY`.
- D1-01's catalog names align with the committed W01 Payload baseline's 11 relations (10 business tables plus `payload_migrations`), their generated sequences and the three Redirects enum types. This is only a catalog-name match; it is not proof that all columns, indexes, constraints or rows are correct.
- The separate read-only workflow `.github/workflows/neon-d1-01-w01-payload-baseline-reconciliation.yml` completed successfully in [run 42453402142](https://github.com/wanghuinet/luckread/actions/runs/42453402142). It verified the W01 schema snapshot, all ten business tables empty, and exactly one `payload_migrations` row naming the committed baseline migration, inside `BEGIN READ ONLY` followed by `ROLLBACK`.
- This successful reconciliation is evidence that the existing W01 baseline is already present and must be preserved. The shared runner records it in the common ledger but never replays the W01 Payload DDL.
- The successful read-only reconciliation does not authorize deleting/recreating W01 objects, changing production D1, importing business data or cutting traffic over.
- Any future mismatch or non-zero business-table count remains a hard stop for manual review. No automatic cleanup is permitted.



## 14. D1-01 shared remote runner — code review and release-gate evidence

- The shared runner implementation and main-target verifier correction are merged at `62e2a8264cc0c6c128a2290e281dba16a8257d6e` (PR #1629) and `c57fe841bb861c9310c361266396f9ffe6a00de1` (PR #1630).
- The integrated disposable PostgreSQL 18 rehearsal passed all fourteen manifest entries and the four owner verifiers in [run 42458291648](https://github.com/wanghuinet/luckread/actions/runs/42458291648). W02 Better Auth and its ten custom migration checks passed in [run 42458291621](https://github.com/wanghuinet/luckread/actions/runs/42458291621).
- Remote-target allowlist and guard validation passed without Neon credentials in [run 42458291629](https://github.com/wanghuinet/luckread/actions/runs/42458291629). The actual remote apply job was **skipped**, as required for pull-request validation. Contract Admission and Mapping 0 Structural Gate passed in [run 42458291617](https://github.com/wanghuinet/luckread/actions/runs/42458291617) and [run 42458291520](https://github.com/wanghuinet/luckread/actions/runs/42458291520).
- A GPT-6 code review record is committed at `contracts/database/neon-d1-01-remote-runner-review.v1.json`. It pins the reviewed runner source, runner tests and ledger DDL by Git blob SHA, and records the exact successful CI run IDs. The review found no blocking issues in the reviewed paths.
- Review limitation: PR #1629 and PR #1630 contain no submitted GitHub review records. The review record explicitly identifies this as GPT-6 code review, **not** a human approval or GitHub `APPROVE` review.
- This release-gate change makes the shared runner eligible for a later manually dispatched D1-01 schema-only apply after the release PR is merged. It does not dispatch that workflow, contact Neon, or apply DDL automatically.
- The only eligible remote path remains `.github/workflows/neon-d1-01-reviewed-remote-schema-apply.yml` on `main`, with `NEON_DATABASE_URL_LUCKREAD`, TLS `verify-full`, `channel_binding=require`, PostgreSQL 18 and the exact confirmation `APPLY_REVIEWED_SCHEMA_D1_01_LUCKREAD`.
- The release does not authorize business data import, Cloudflare D1 changes, Worker runtime/binding changes, dual writes or production cutover. Cloudflare D1 remains authoritative for production.


## 15. W01 Payload schema owner closeout — 2026-11-08

**W01 owner state: `ACCEPTED_SCHEMA_BASELINE_NEON_RECONCILED`.** This closes only W01's D1-01 Payload schema-owner slice; it does not close the overall D1-01 shared remote initialization or production runtime migration.

- W01 standalone Payload schema and non-empty rollback protection passed on disposable PostgreSQL 18 in [run 42452902432](https://github.com/wanghuinet/luckread/actions/runs/42452902432).
- The integrated fourteen-entry D1-01 rehearsal passed on disposable PostgreSQL 18 in [run 42460599618](https://github.com/wanghuinet/luckread/actions/runs/42460599618), including W01's official Payload-native migration first, all owner verifiers, same-owner foreign-key checks, and zero business rows.
- The existing Neon W01 baseline was independently verified read-only in [run 42453402142](https://github.com/wanghuinet/luckread/actions/runs/42453402142): target `luckread`, PostgreSQL `18.6`, verified TLS chain/hostname, exact 11-table catalog/columns/indexes/foreign keys, ten business tables with zero rows, and exactly one expected `payload_migrations` baseline row. The verifier reports a verified read-only transaction followed by rollback and no failures.
- The existing W01 baseline is therefore preserved as-is. The old owner-specific W01 Neon apply workflow has been removed. W01 remote checks and any schema execution must go through the reviewed shared D1-01 workflow; the shared runner records W01's existing Payload baseline in the common append-only ledger and must never replay W01 DDL.
- The unified remote D1-01 workflow has not yet been manually dispatched. The common ledger provenance row for W01 is therefore still pending alongside the other D1-01 manifest entries. This is an overall D1-01 execution dependency, not a reason to reopen W01's accepted Payload schema.
- Production W01 continues to use Cloudflare D1 and R2. No business data import, runtime adapter switch, dual write or production cutover is included.

The W01 schema-owner slice is frozen. Reopen it only for a reproducible W01 schema mismatch/regression, source/contract drift, invalidated evidence, or explicit user authorization with a new scope.


## 16. D1-04 first remote schema-only apply — 2026-11-09

- Workflow [42553336881](https://github.com/wanghuinet/luckread/actions/runs/42553336881) passed the exact-main, target-confirmation, checkout-provenance, source-pinned release-gate, Neon endpoint and full-TLS checks.
- The W07 schema-only runner committed all six ordered migrations and their six append-only ledger rows in separate transactions. After the final ledger-prefix check, the 15-table state and empty business-row checks passed.
- The final catalog step failed because the runner compared the manifest's 31 explicitly declared indexes against every row in `pg_catalog.pg_indexes`. PostgreSQL also exposes 29 indexes that back primary-key and unique constraints; these are expected schema objects, not undeclared explicit indexes.
- The report artifact was not produced because the runner writes it only after final catalog verification succeeds. The run did not import business data, touch Cloudflare D1, change runtime bindings or authorize production cutover.
- Recovery is ledger-driven: the next run must validate the exact six-entry ordered ledger prefix, skip the already committed migrations, then rerun final catalog verification and write fresh postflight evidence. No table/index cleanup or migration replay is permitted.
- The correction records the exact constraint-backed index names separately from the 31 explicit index names, verifies both sets independently, and adds regression tests for unexpected/missing members in either set.


## 17. D1-04 remote runner recertification after index-catalog correction — 2026-11-09

- PR #1668 was squash-merged at `745e68501ad292eb7d51556006a85d026330dc45`. It adds a separate exact manifest set for the 29 primary-key/unique-constraint-backed indexes while preserving the 31 explicitly declared indexes.
- The merged implementation's eight reviewed source blobs match the source-equivalent validation head `1704b435374be1e5f773915092de145548b173c2` (validation run checkout merge SHA `4cba8141a2a34b287160c84a749d47218c54c503`).
- D1-04 validation workflow [42553780174](https://github.com/wanghuinet/luckread/actions/runs/42553780174) passed: 29/29 D1-04 unit/release-guard tests, disposable PostgreSQL 18 schema rehearsal, six migrations, 15 tables, 31 explicit indexes, 72 final triggers, six trigger functions, zero foreign keys and zero business rows. Sanitized artifact: [13646875712](https://github.com/wanghuinet/luckread/actions/runs/42553780174/artifacts/13646875712).
- The PR's independent D1-04 local ownership review [42553780134](https://github.com/wanghuinet/luckread/actions/runs/42553780134), shared D1-03/D1-04/D1-05 PostgreSQL 18 rehearsal [42553780162](https://github.com/wanghuinet/luckread/actions/runs/42553780162), and Contract Admission CI [42553780273](https://github.com/wanghuinet/luckread/actions/runs/42553780273) passed.
- The D1-04 release review is recertified against the merged main SHA with exact source pins and the successful local CI artifact. The review explicitly records that no human GitHub APPROVE review was submitted, and that remote apply remains a separate manual action.
- The existing Neon target already has all six W07 migrations and six matching ledger rows from run [42553336881](https://github.com/wanghuinet/luckread/actions/runs/42553336881). The next remote workflow must verify that exact ledger prefix, skip DDL replay and run the corrected final index/trigger/function/empty-business-data postflight. No cleanup, data import, Cloudflare D1 mutation or production cutover is authorized.

## 18. D1-04 remote schema-only Postflight accepted — 2026-11-09

- Manual main-only workflow [42555900393](https://github.com/wanghuinet/luckread/actions/runs/42555900393) completed successfully on commit `c18d294d3fc2acac6e9c66eb052dfed6e6c46758`. Exact-main, target confirmation, source-pinned release gate, Neon endpoint and full TLS verification all passed.
- The runner verified the existing ordered six-entry W07 migration ledger prefix created by run [42553336881](https://github.com/wanghuinet/luckread/actions/runs/42553336881). All six migration entries matched; no migration DDL was replayed. The corrected final catalog Postflight completed successfully.
- Remote PostgreSQL 18 catalog: 15 tables, 31 explicit indexes, 29 primary-key/unique-constraint-backed indexes, 72 triggers, 6 trigger functions, zero foreign keys, one scheduler control seed row, and zero business rows.
- Sanitized Postflight artifact: [13646957840](https://github.com/wanghuinet/luckread/actions/runs/42555900393/artifacts/13646957840), SHA-256 `b35461e7b49a0131eceee3782244fd0f10d44d2c0b6f7fac90932481f9cd8228`.
- D1-04 is now recorded as schema-only remote-applied in the five-domain bootstrap contract. This does not widen the canonical shared executor: `neon-schema-migration-ledger.v1.json` still limits the general remote executor to D1-01 and D1-02, while D1-04's local shared-runner readiness remains false for remote execution. The W07 dedicated schema-only release path is a separate domain-scoped exception.
- Safety boundary remains unchanged: Cloudflare D1 untouched, no business data imported, no Worker runtime bindings changed, and production cutover not authorized. Runtime cutover remains a separate future gate.

## 19. D1-01 full four-owner PostgreSQL 18 rehearsal accepted — 2026-11-09

- Full ordered W01/W02/W07/W08 rehearsal [42460599618](https://github.com/wanghuinet/luckread/actions/runs/42460599618) passed on disposable PostgreSQL 18. The job validates all 14 manifest entries, regenerates the Better Auth core and W02 custom artifacts, regenerates W07/W08 SQL, applies the W01 Payload native baseline first, then uses the reviewed shared runner.
- Postflight confirms 35 tables, 17 foreign keys with zero cross-owner foreign keys, 14 shared migration ledger rows, one Payload migration bookkeeping row, and zero business rows across all business tables.
- Artifact [13609582055](https://github.com/wanghuinet/luckread/actions/runs/42460599618/artifacts/13609582055) SHA-256: `73d32e6572aa9dbc79ec31f61e65a7709aa4d4174bf56956af4fb902cfa747ff`.
- The D1-01 remote review's 14 pinned source files match the current `main` tree exactly (14/14), so the existing source-pinned review remains current. D1-01 is now recorded as full local rehearsal passed with all four schema owners complete.
- This is not a remote apply: `remoteSchemaApplied=false` remains unchanged. The separate manual-only D1-01 workflow dispatch is still required. No Neon connection was attempted in the local rehearsal, no production D1 was touched, no business data was imported, and production cutover is not authorized.

