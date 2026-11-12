# W08 D1-01 Creator PostgreSQL Schema

This is the PostgreSQL 18 translation and staged runtime adapter for the canonical W08 creator authorization migration.

## Authority boundaries

- W08 owns creator applications, creator identity facts and creator authorization audit in D1-01 / luckread.
- W02 remains authoritative for user identity, account state, credentials, sessions, RoleAssignment facts and L0-L8 resolution.
- The three W08 tables contain opaque user/actor/subject/resource IDs only. No user or RoleAssignment table is copied into this package.
- The audit value role_assignment is a resource-type label and opaque audit reference only; it is not a RoleAssignment store.
- No cross-domain foreign keys are introduced. The source D1 migration declares no foreign keys or table triggers.
- W07 membership/subscription tables, W01 Payload tables and D1-04 financial tables are not included.
- No existing application, creator, identity or audit business rows are imported or seeded.
- W08 now has a provider-selected store for these three tables. `W08_DATABASE_DRIVER=d1` remains the production default; explicit `neon` mode uses the existing D1-01 Hyperdrive binding. W02 identity and RoleAssignment writes remain behind the existing W02 Service Binding.
- The W08 Worker still retains its D1-01 binding for rollback. This change does not deploy the Worker, change its production default, import business rows, or switch traffic.

## Source mapping

The generator reads workers/W08-creator/migrations/0001_creator_authorization.sql and verifies the W08 owner entry in contracts/database/neon-d1-01-schema-sources.v1.json, the D1-01 owner map in contracts/database/neon-five-domain-schema-bootstrap.v1.json, and the W02/W08 authority boundary change control.

The three source tables and their columns, enum checks, defaults, unique constraints and five explicit source indexes are preserved. D1 TEXT UTC timestamp fields are mapped to PostgreSQL TIMESTAMPTZ. details_json remains TEXT with the source {} default; no JSONB validation or new JSON semantics are imposed.

## Verification and remote apply gate

The dedicated GitHub Actions workflow applies the generated schema only to a disposable PostgreSQL 18.6 CI service. Its verifier asserts the exact 14/8/13-column table shapes, timestamp mapping, indexes, uniqueness and lifecycle checks, confirms zero foreign keys/triggers and excludes W02/W07/D1-04 tables. A separate runtime rehearsal exercises application creation/replay, approval and rejection CAS, creator grant completion, and audit writes through the PostgreSQL store; it removes all synthetic rows and emits postflight evidence.

This PR does not apply schema to remote Neon. D1-01 remote application remains blocked until every D1-01 owner schema is reviewed, the shared deterministic migration ledger/checksum runner and migration ordering are ready, and the target is revalidated read-only immediately before schema apply. No remote Neon secret is read and this workflow has no manual-dispatch or remote-DDL path.

The runtime adapter is staged only. Remote Neon DDL, Worker deployment, production default changes, data import and traffic cutover remain separate operations requiring their own change control and evidence.
