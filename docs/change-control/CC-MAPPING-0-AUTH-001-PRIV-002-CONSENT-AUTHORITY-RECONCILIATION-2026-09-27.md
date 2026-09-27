# CC-MAPPING-0-AUTH-001-PRIV-002-CONSENT-AUTHORITY-RECONCILIATION-2026-09-27

## Status

`PRIV-002_SEMANTIC_AUTHORITY_RECONCILED / CONCRETE_SCHEMA_BLOCKED`

## Scope

Reconcile the existing repository authority for the minimum consent semantics required by AUTH-001 registration. This control does not invent a consent entity, field names, enum vocabulary, retention duration, API, or runtime implementation.

## Authoritative inputs

- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- `docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md`
- `docs/21-D21-ADVERTISING-PLATFORM-CONTRACT-v1.0.md`
- `contracts/alignment/mapping-batches/PRIV-001-008-real-evidence-reconciliation.v1.md`
- `contracts/capability/reconciliation-batches/AO-privacy-compliance.v1.json`

## Reconciled semantic authority

The existing sources establish the following minimum semantics for a future canonical consent persistence contract:

1. A consent record carries a policy version; the attached policy version is immutable for that record.
2. Consent creation is scoped to the actor/resource context and duplicate submission must be deterministic.
3. An invalid policy version is rejected and the current applicable policy version must remain retrievable.
4. Withdrawal is durable; applicable downstream privacy-policy propagation is required; consent history is retained.
5. Consent-history reads are authorization-scoped, deterministically ordered, and preserve immutable history.
6. Unauthorized consent mutation is denied with no state mutation.
7. Where consent state is applicable, the system must distinguish granted/revoked/restricted-processing handling rather than treating consent as an unbounded boolean.
8. Lifecycle-controlled records are subject to the existing retention contract: retention class is server-governed, not client-selected; lifecycle records must be traceable to resource, owner, timestamps, policy version, source authority and applicable retention/legal-hold metadata.

## Important boundary

The above sources are **semantic authority**, not a concrete PRIV-002 persistence schema.

They do not authoritatively freeze:

- consent table/entity name;
- exact field IDs/names;
- exact consent-state enum;
- legal-basis vocabulary;
- exact retention class for registration consent;
- retention duration / retentionUntil rule specific to consent;
- withdrawal event schema;
- public consent API/DTO;
- registration-envelope embedding shape.

Those values remain blocked and must be admitted from a dedicated contract/change-control decision before code or migration work.

## AUTH-001 impact

AUTH-001 may now rely on the following already-authoritative semantic invariants when its concrete consent persistence contract is admitted:

- consent is durable, not request-only;
- the policy version attached to a consent record is immutable;
- duplicate submissions are deterministic;
- withdrawal preserves history;
- unauthorized mutation fails closed;
- lifecycle retention follows the platform retention authority rather than client input.

The AUTH-001 registration request's `consent` field remains **persistence-blocked** until a concrete PRIV-002 schema and registration binding are admitted.

## Non-authorizations

This control does not authorize:

- a new consent collection/table;
- new D1/Worker/Queue resources;
- consent migration;
- consent runtime code;
- registration runtime code;
- a guessed policy-version or legal-basis field;
- a guessed retention period;
- Evidence Registry or Mapping 0 GREEN promotion.

## Result

PRIV-002 is no longer an unqualified "no authority" gap. Its minimum semantic invariants are reconciled from existing canonical sources.

The remaining blocker is the **concrete executable contract**: schema/fields, retention binding, and AUTH-001 registration-envelope mapping.
