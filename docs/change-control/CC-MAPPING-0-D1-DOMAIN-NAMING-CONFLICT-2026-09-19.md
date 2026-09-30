# CC-MAPPING-0-D1-DOMAIN-NAMING-CONFLICT-2026-09-19

## Status

CLOSED — RECONCILIATION VERIFIED

## Scope

AUTH-006, AUTH-013, AUTH-015

## Verified common conflict

Multiple AUTH reconciliation artifacts contain a persistence-domain naming discrepancy:

- legacy/current contract references use `D1-01`;
- frozen baseline language requires `D01 Core`.

Observed examples:

- AUTH-006 B01 reconciliation: `d1Domain = CONFLICT: legacy state contract names D1-01; frozen baseline requires D01 Core`.
- AUTH-013 reconciliation: same explicit conflict.
- AUTH-015 reconciliation: same explicit conflict and `reconciliationState: CONFLICT`.

The shared AUTH-002..006 persistence mapping also currently carries `persistenceDomainId: D1-01`.

## Important boundary

This is a logical domain/authority naming conflict. It is NOT evidence of a physical D1 database, table, schema, migration, or deployment.

No physical D1 identifier may be inferred from either label.

## Required authority decision

A single authoritative naming decision should be made under Change Control and then reconciled consistently across:

- B01 identity/auth/account reconciliation;
- AUTH-002..006 persistence/API/entity/field mapping where applicable;
- AUTH-006 passkey contract;
- AUTH-013 account-state reconciliation;
- AUTH-015 deletion/restoration reconciliation;
- related mapping and change-impact artifacts.

The decision must preserve existing domain ownership and must not introduce a new D1 domain merely to remove the conflict.

## Gate impact

- AUTH-006 remains fail-closed.
- AUTH-013 remains CONFLICT in its source-specific reconciliation and PARTIAL in the Canonical Mapping.
- AUTH-015 remains CONFLICT in its source-specific reconciliation and PARTIAL in the Canonical Mapping.
- No persistence status is promoted.
- No migration execution is claimed.

## Evidence

- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/alignment/mapping-batches/AUTH-013-real-evidence-reconciliation.v1.md`
- `contracts/alignment/mapping-batches/AUTH-015-real-evidence-reconciliation.v1.md`
- `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`

## Acceptance

Future conversations must treat this as one already-registered cross-feature naming conflict, not rediscover it separately for each AUTH feature.

## Decision accepted — 2026-09-20

Decision 6 accepted: D01 Core is the canonical logical domain label for AUTH-006/AUTH-013/AUTH-015 reconciliation; no physical D1 schema is inferred.

## Reconciliation verified — 2026-09-20

Applied to the affected source reconciliation surfaces:
- B01 cross-cutting conflict `B01-CONFLICT-001` marked `RESOLVED`.
- AUTH-013 D1 naming narrative reconciled; remaining Worker/API/DTO/persistence/runtime/evidence blockers retained.
- AUTH-015 D1 naming narrative reconciled; remaining deletion/API/persistence/runtime/evidence blockers retained.

No physical D1 identifier, table, migration, Worker assignment, or runtime status was changed.
