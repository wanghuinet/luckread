# W07 Membership Neon PostgreSQL Schema

This directory contains the generated PostgreSQL 18 schema translation for W07's membership database. Its eight D1-01 migration files are retained as historical schema-source provenance, not as a runtime D1 dependency.

## Authority and boundaries

- The membership database (`luckread`; historical source domain D1-01) is authoritative for MembershipPlan, Subscription lifecycle and entitlement references.
- W07 owns the subscription workflow; W02 remains authoritative for account identity and access.
- The finance database (`luckread_finance`; historical source domain D1-04) owns orders, payments, refunds, mandates and financial facts. The order_id in paid plan-change attempt metadata is an opaque reference only.
- Subscriber and creator IDs remain opaque identifiers. Only the two source-defined plan-version foreign keys are created.
- No active-subscription uniqueness constraint is invented; the applicable policy remains DECISION_REQUIRED.
- No existing business rows are imported or seeded.
- W07 runtime code/config now uses Neon through `HYPERDRIVE_MEMBERSHIP_DB` and native PostgreSQL Stores. The historical D1 source migrations remain inputs to deterministic schema generation; their names do not denote a live D1 binding. This README does not prove a production Worker deployment or remote schema-apply event.

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

The generated SQL and disposable PostgreSQL rehearsal verify the schema shape locally; they are not evidence of a remote Neon DDL operation. Read the bootstrap/ledger contracts and deployment evidence for actual remote schema and Worker rollout status. This source file does not authorize remote DDL or production cutover.

W07 now has native PostgreSQL runtime Stores and the Neon membership binding. Keep schema-generation inputs separate from runtime code; do not reintroduce D1 adapters or fallback paths. Any production deployment or authority change remains a separately evidenced release action.
