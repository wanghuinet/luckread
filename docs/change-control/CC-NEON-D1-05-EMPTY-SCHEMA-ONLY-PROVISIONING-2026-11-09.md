# CC-NEON-D1-05-EMPTY-SCHEMA-ONLY-PROVISIONING-2026-11-09

## Decision scope

This change permits a narrowly isolated, manually dispatched schema-only initialization of the existing empty Neon database allluck (D1-05).

It does **not** admit Analytics runtime ingestion, event storage, business-data import, Worker binding changes, deployment, or production cutover.

The decision is limited to provisioning the PostgreSQL 18 structure that already has:
- four pinned W11 D1 source migrations (0001 through 0004);
- a deterministic PostgreSQL-native baseline;
- a passing disposable PostgreSQL 18.6 rehearsal;
- a passing independent read-only source/ownership review;
- one W11-owned D1-05 manifest entry;
- an exact six-table/eight-explicit-index catalog contract.

## Why schema-only provisioning is separate

The D1-05 schema contract continues to record three runtime admission gaps:
1. Retention rules for raw analytics events, aggregates and bounded late-event replay.
2. Deletion/privacy-request propagation for creator-linked and other analytics projections.
3. Consent, lawful purpose and collection eligibility for anonymous and authenticated telemetry.

Those requirements remain blocking for runtime use. No retention duration or legal basis is invented by this change.

The remote schema workflow creates only:
- the shared append-only neon_schema_migration_ledger;
- the six admitted W11 analytics tables;
- the eight explicit indexes;
- the single ledger provenance row for the one admitted D1-05 migration.

Every analytics table must contain zero rows after execution. The ledger row is schema provenance, not user/business data.

## Execution controls

The only remote path is .github/workflows/neon-d1-05-reviewed-schema-only-apply.yml:
- workflow_dispatch only, on main;
- exact confirmation APPLY_REVIEWED_SCHEMA_D1_05_ALLLUCK_SCHEMA_ONLY;
- source-pinned release review must pass before the Neon secret is read;
- exact database name allluck, Neon endpoint hostname, PostgreSQL 18;
- sslmode=verify-full, channel_binding=require, verified TLS chain and hostname;
- advisory lock and append-only shared migration ledger;
- exact-prefix ledger reconciliation before any DDL;
- exact table/index/trigger/function/foreign-key catalog postflight;
- zero business rows and no automatic cleanup.

PR validation has no Neon credentials and rehearses only against disposable PostgreSQL 18.6.

## Explicit non-authorizations

- No W11 runtime data ingestion or analytics API enablement.
- No W11 Wrangler/D1 binding changes.
- No new Worker, D1 database, Queue or Service Binding.
- No change to W01 Payload Core or W02 identity ownership.
- No Cloudflare D1 mutation.
- No event, account, content, social, finance or other business-data import.
- No dual-authoritative writes.
- No production cutover.
- No waiver of the D1-05 retention/deletion/consent admission blockers.

## D1-03 relationship

The separate D1-03 remote apply completed only its three admitted W06/W09/W10 manifest entries (15 tables). W06 Appeal and W11 Campaign/GrowthOperation remain excluded until their source/persistence contracts and owning implementation exist. This D1-05 provisioning does not copy W11 analytics tables into D1-03 and does not change the D1-03 owner boundary.

## Stop and recovery rules

- Any unexpected public-schema object, custom type, routine, extension, global object or non-empty business table is a hard stop.
- A mismatched ledger row, checksum or non-prefix history is a hard stop.
- The runner never drops, truncates, repairs or recreates existing objects.
- Previously committed migrations are reconciled through the append-only ledger and are never replayed.
- A failed postflight does not authorize cleanup; inspect the exact catalog/ledger evidence and make a new scoped change only when needed.

## Acceptance

The D1-05 schema-only provisioning slice is complete only after the manual workflow reports success and its sanitized artifact proves:
- exactly one admitted migration and one matching ledger row;
- PostgreSQL 18;
- six analytics tables and eight explicit indexes;
- zero triggers, trigger functions and foreign keys;
- zero rows in all six analytics tables;
- no Cloudflare D1 mutation, business-data import, runtime binding change or production cutover.

Runtime Analytics admission remains a separate future gate.
