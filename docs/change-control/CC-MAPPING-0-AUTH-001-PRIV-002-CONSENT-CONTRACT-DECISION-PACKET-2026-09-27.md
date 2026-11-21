# CC-MAPPING-0-AUTH-001-PRIV-002-CONSENT-CONTRACT-DECISION-PACKET-2026-09-27

## Status

`CONTRACT_ADMITTED / AUTH-001_RUNTIME_PRECONDITIONS_RECONCILED`

## Purpose

This packet freezes the repository search boundary for the remaining AUTH-001 / PRIV-002 consent gate and prevents repeated re-audit of already-exhausted sources.

The packet does **not** choose missing consent schema values.

## Current admitted semantic authority

The repository already admits these minimum consent invariants:

1. A consent record carries a policy version; the attached version is immutable for that record.
2. Actor/resource scope is authoritative.
3. Duplicate submission is deterministic.
4. Invalid policy versions are rejected.
5. Withdrawal persists; applicable downstream privacy-policy propagation is required; history is retained.
6. Consent-history reads are authorization-scoped, deterministic, and immutable.
7. Unauthorized consent mutation is denied without state mutation.
8. Consent processing must distinguish granted/revoked/restricted-processing handling where applicable.
9. Retention is server-governed by the lifecycle contract; client input cannot select retention.

## Exhausted concrete-schema search

Current `main` inspection found no canonical admitted value for:

- consent Entity ID;
- physical table/collection;
- consent record field IDs/names;
- consent state enum;
- consent purpose/type vocabulary;
- legal-basis vocabulary;
- policy-version field/type representation;
- consent-specific retentionClass;
- consent-specific retention duration / retentionUntil rule;
- withdrawal event payload/schema;
- AUTH-001 registration-envelope consent field binding.

The following sources were checked and are authoritative for their respective semantics, but do not freeze the missing concrete values:

- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- `docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md`
- `docs/21-D21-ADVERTISING-PLATFORM-CONTRACT-v1.0.md`
- `contracts/alignment/mapping-batches/PRIV-001-008-real-evidence-reconciliation.v1.md`
- `contracts/capability/reconciliation-batches/AO-privacy-compliance.v1.json`
- `docs/change-control/CC-MAPPING-0-AUTH-001-PRIV-002-CONSENT-AUTHORITY-RECONCILIATION-2026-09-27.md`
- `docs/change-control/CC-MAPPING-0-AUTH-001-PRIV-002-CONCRETE-SCHEMA-ADMISSION-GAP-2026-09-27.md`

Historical/archive capability matrices are explicitly non-authoritative for concrete schema admission.

## Decision required before AUTH-001 runtime

A single canonical PRIV-002 contract/change-control decision must admit the missing concrete consent schema and its retention/withdrawal bindings.

Until that decision is merged:

- AUTH-001 registration runtime remains unauthorized;
- no consent migration is authorized;
- no consent collection/table is invented;
- no new Worker/D1/Queue is introduced;
- no Evidence Registry or Mapping 0 GREEN promotion occurs.

## AUTH-001 status after replay gate closure

The AUTH-001 registration envelope idempotency subset and replayable committed response projection are already reconciled.

Therefore the only remaining Contract blocker before the smallest registration runtime slice is the concrete PRIV-002 consent contract.

## Non-authorizations

This packet does not create an Entity ID, Field ID, enum, retention duration, migration, API, runtime handler, or infrastructure resource.


## Decision outcome

A minimal concrete contract has now been admitted from the reconciled semantic authorities. The admission intentionally stops at the logical contract boundary:

- `ENT-CONSENT` is the canonical entity ID;
- registration consent is `ACCOUNT_REGISTRATION`;
- legal basis is `CONSENT`;
- initial state is `GRANTED`;
- policy version is immutable;
- retention class is `LEGAL_AUDIT`;
- retentionUntil is server-calculated by the global lifecycle retention policy;
- withdrawal uses `REVOKED` + `withdrawnAt` + `privacy.consent_withdrawn` v1.0;
- AUTH-001 envelope stores `consent_record_id`.

No physical table, column, migration or runtime implementation is implied by this decision packet.
