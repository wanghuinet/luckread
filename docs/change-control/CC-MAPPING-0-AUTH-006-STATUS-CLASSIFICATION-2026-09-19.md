# Change Control — Mapping Status Classification Ambiguity for AUTH-006

- ID: CC-MAPPING-0-AUTH-006-STATUS-CLASSIFICATION-2026-09-19
- Date: 2026-09-19
- Scope: Canonical Mapping status semantics
- Status: OPEN / NO STATUS CHANGE

## Finding

Current `contracts/alignment/cross-system-mapping.v1.json` records AUTH-006 as `MISSING`, while the same record now contains five API operation IDs and three Entity IDs from explicit contract reconciliation.

The repository clearly treats `MISSING` and `PARTIAL` as blocking statuses, but no authoritative machine-readable rule was found that defines the exact boundary between them for a record that contains some explicit edges but remains incomplete.

Existing evidence also contains historical documentation describing AUTH-006 as `MISSING`, while newer feature-specific contracts establish API and Entity contract surfaces. This creates a classification ambiguity, not proof that the feature is complete.

## Disposition

Do not change AUTH-006 from `MISSING` to `PARTIAL` in this control.

Do not use the presence of API/Entity edges to infer DTO, persistence, runtime, security or Evidence closure.

A future status-classification decision must explicitly define the canonical predicate for `MISSING` versus `PARTIAL`, then reconcile affected records deterministically.

## Non-goals

- No Feature promotion.
- No API/DTO/Entity creation.
- No D1 changes.
- No runtime execution.
- No evidence freshness manipulation.
