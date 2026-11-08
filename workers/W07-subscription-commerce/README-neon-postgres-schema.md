# W07 D1-01 Membership PostgreSQL Schema

This directory contains the schema-only PostgreSQL 18 translation for W07's D1-01 subscription and membership persistence.

## Authority and boundaries

- D1-01 / luckread remains the logical authority for MembershipPlan, Subscription lifecycle and entitlement references.
- W07 owns the subscription workflow; W02 remains authoritative for account identity and access.
- D1-04 orders, payments, refunds, mandates and financial facts are not included. The order_id in paid plan-change attempt metadata is an opaque reference only.
- Subscriber and creator IDs remain opaque identifiers. Only the two source-defined plan-version foreign keys are created.
- No active-subscription uniqueness constraint is invented; the applicable policy remains DECISION_REQUIRED.
- No existing business rows are imported or seeded.
- Cloudflare D1 remains production authority. This migration does not change W07 runtime SQL, D1 bindings, Workers, Queues, Service Bindings, Payload Core or public APIs.

## Source and conversion

The generator reads the eight canonical D1-01 migration files (0001 through 0008), the Subscription entity/persistence contracts and the five-domain bootstrap/source-inventory contracts. It validates their authority and key invariants before copying the reviewed PostgreSQL template into src/neon-postgres-migrations/0001_w07_d1_01_membership_schema.sql.

SQLite ISO-8601 timestamp TEXT fields are mapped to PostgreSQL TIMESTAMPTZ. benefits_json remains TEXT; PostgreSQL JSONB is used only to check that its contents form a JSON array. SQLite typeof, GLOB, RAISE(ABORT) and trigger syntax are replaced with PostgreSQL types, regular-expression checks and PL/pgSQL trigger functions.

The generated schema preserves:
- all 17 Subscription columns, including version and the three trial timestamps;
- immutable MembershipPlan versions and forward-only current-version changes;
- immutable RevenueCat product identity with only a one-way retirement transition;
- idempotent plan-change attempt and scheduled-change keys;
- single pending upgrade/scheduled-change rows per subscription;
- one lifetime trial per non-null subscriber/creator pair and write-once trial-window/conversion timestamps.

## Verification and apply gate

The GitHub Actions workflow .github/workflows/neon-d1-01-w07-membership-schema.yml generates this DDL and applies it only to a disposable PostgreSQL 18 CI service. The SQL verifier runs synthetic inserts and negative probes inside one transaction, rolls everything back, then records zero rows across the six W07 tables.

This PR does not apply any schema to the remote Neon database. D1-01 remote application remains blocked until the complete D1-01 owner schema package, the shared deterministic migration ledger/checksum execution gate, reviewed migration ordering and read-only target revalidation are complete. No manually dispatched workflow or remote DDL is part of this workflow.

The eventual W07 PostgreSQL runtime adapter is a separate implementation and test slice. It must explicitly handle TIMESTAMPTZ values and preserve the current D1 runtime contract before any production authority change can be considered.
