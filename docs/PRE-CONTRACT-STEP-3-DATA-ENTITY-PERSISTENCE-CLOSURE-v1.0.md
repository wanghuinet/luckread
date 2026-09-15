# Pre-Contract Step 3 — Data / Entity / Persistence Closure v1.0

Status: IN PROGRESS / NOT GREEN

## Authority

The logical data model must remain database-provider neutral. D1 is an implementation target, not the business source of truth. The repository's database portability contract requires stable domain terminology, explicit nullability, relationships, constraints and migration semantics.

## Required mapping

Every authoritative persistence fact must resolve as:

`Feature/Capability -> Entity -> Field -> Relation/Constraint -> Persistence implementation -> Migration owner`

No field may exist only because an API or implementation happened to introduce it. No authoritative entity may exist without a capability owner.

## Canonical ownership rules

- User != Account != Credential
- Role != Permission != Entitlement
- Subscription != Payment != Order
- Product != Content
- Content != Media != Storage Object
- Feed/Search/Analytics/Recommendation are derived systems and are not content authorities
- Moderation state is independent from publication state
- Risk is not an enforcement decision

## Required field classes

1. Identity keys: stable application IDs, never provider-generated semantics as the public identity.
2. Lifecycle: status, created/updated timestamps and explicit transition rules.
3. Authorization: ownership/scope references and policy-relevant state.
4. Relations: explicit cardinality and deletion/update behavior.
5. Versioning: revision/published-version references where applicable.
6. Derived/high-volume state: counters/events must identify aggregation authority and consistency model.
7. Storage references: object keys/URLs are metadata; object bytes belong to object storage where appropriate.
8. Audit/governance: actor, correlation/request IDs and immutable governance records where required.

## Blocking classifications

- MISSING_ENTITY
- MISSING_FIELD
- ORPHAN_FIELD
- UNRESOLVED_RELATION
- CONFLICTING_TYPE
- CONFLICTING_NULLABILITY
- DUPLICATE_AUTHORITY
- UNDEFINED_LIFECYCLE
- NON_PORTABLE_PROVIDER_LEAK
- UNRESOLVED_MIGRATION_OWNER

These states cannot be normalized to GREEN by assumption.

## Current evidence

The repository already contains a D1/PostgreSQL portability contract and Capability Contract Graph. Existing reconciliation material indicates Entity/Field binding is not yet complete for at least some domains. Therefore Step 3 is explicitly NOT GREEN and must be reconciled before implementation admission.

## Exit criteria

Step 3 is GREEN only when every authoritative capability has a complete entity/field map, relations and lifecycle semantics; every persistence object has an owner; high-volume derived state has an explicit authority; and no provider-specific implementation detail leaks into the logical domain contract.
