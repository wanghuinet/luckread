# W08 D1-01 Creator PostgreSQL Schema

This is the schema-only PostgreSQL 18 translation of the canonical W08 creator authorization migration.

## Authority boundaries

- W08 owns creator applications, creator identity facts and creator authorization audit in D1-01 / luckread.
- W02 remains authoritative for user identity, account state, credentials, sessions, RoleAssignment facts and L0-L8 resolution.
- The three W08 tables contain opaque user/actor/subject/resource IDs only. No user or RoleAssignment table is copied into this package.
- The audit value role_assignment is a resource-type label and opaque audit reference only; it is not a RoleAssignment store.
- No cross-domain foreign keys are introduced. The source D1 migration declares no foreign keys or table triggers.
- W07 membership/subscription tables, W01 Payload tables and D1-04 financial tables are not included.
- No existing application, creator, identity or audit business rows are imported or seeded.
- Cloudflare D1 remains production authority. This change does not modify W08 runtime routes, D1 bindings, W02 Service Binding, CASL code, Workers, Queues, Payload Core or public APIs.

## Source mapping

The generator reads workers/W08-creator/migrations/0001_creator_authorization.sql and verifies the W08 owner entry in contracts/database/neon-d1-01-schema-sources.v1.json, the D1-01 owner map in contracts/database/neon-five-domain-schema-bootstrap.v1.json, and the W02/W08 authority boundary change control.

The three source tables and their columns, enum checks, defaults, unique constraints and five explicit source indexes are preserved. D1 TEXT UTC timestamp fields are mapped to PostgreSQL TIMESTAMPTZ. details_json remains TEXT with the source {} default; no JSONB validation or new JSON semantics are imposed.

## Verification and remote apply gate

The dedicated GitHub Actions workflow applies the generated schema only to a disposable PostgreSQL 18.6 CI service. Its verifier asserts the exact 14/8/13-column table shapes, timestamp mapping, indexes, uniqueness and lifecycle checks, confirms zero foreign keys/triggers and excludes W02/W07/D1-04 tables. Synthetic positive/negative tests run in one transaction and all writes are rolled back; the artifact records zero remaining business rows.

This PR does not apply schema to remote Neon. D1-01 remote application remains blocked until every D1-01 owner schema is reviewed, the shared deterministic migration ledger/checksum runner and migration ordering are ready, and the target is revalidated read-only immediately before schema apply. No remote Neon secret is read and this workflow has no manual-dispatch or remote-DDL path.

Runtime adaptation and any production authority change are separate work requiring their own change control and evidence.
