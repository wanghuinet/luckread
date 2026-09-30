# CC-MAPPING-0-CODE-EVIDENCE-ENTITY-DRIFT-2026-09-29

## Status

`IMPLEMENTED / VALIDATION_PENDING`

## Finding

The committed Code Evidence Inventory contained stale Entity implementation snapshots that disagreed with the current canonical `contracts/entity/entity-implementation-evidence.v1.json`.

Affected entities:

- `ENT-CREDENTIAL`
- `ENT-IDENTITY`
- `ENT-ROLE-ASSIGNMENT`
- `ENT-SESSION`
- `ENT-USER`

The authoritative Entity Evidence already records their implementation status and implementation references. This change only reconciles the derived Inventory to those existing authoritative inputs.

## Non-changes

- No Entity Catalog promotion.
- No Contract semantics change.
- No business runtime change.
- No D1 or Worker topology change.
- No Evidence Registry promotion.
- No Mapping 0 / Five-Way GREEN claim.

## Acceptance

Existing Contract Admission / Alignment CI must regenerate the derived inventory and confirm no generated drift.

Backup: `backup/pre-code-evidence-entity-drift-fix-20260929`.
