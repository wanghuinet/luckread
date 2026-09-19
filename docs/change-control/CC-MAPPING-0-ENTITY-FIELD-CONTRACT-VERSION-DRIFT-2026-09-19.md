# CC-MAPPING-0-ENTITY-FIELD-CONTRACT-VERSION-DRIFT-2026-09-19

## Status
CLOSED — SCHEMA COMPATIBILITY REPAIR EXECUTED

## Finding

`contracts/entity/entity-field-contract.v1.json` currently declares version `1.2`, while the companion JSON Schema previously required `version = 1.0`. The executable contract-field validators already accept any `1.x` version. This creates an internal schema/contract-version contradiction.

## Decision

The schema version constraint is changed from an exact `1.0` constant to a `^1\.\d+$` pattern. This preserves the v1 schema family while admitting the existing 1.2 contract revision and future compatible 1.x revisions.

No Entity, Field, Payload, API, DTO, persistence, runtime, Evidence or Feature status is changed by this control.

## Verification invariant

- Contract content remains unchanged.
- Existing executable validators remain unchanged.
- Only the schema's version admission rule changes.
- No business implementation is authorized.
- Mapping 0 status remains fail-closed.

## Evidence

- `contracts/entity/entity-field-contract.v1.json`
- `contracts/entity/entity-field-contract.v1.schema.json`
- `scripts/entity-field-contract-check.mjs`
- `scripts/entity-field-schema-contract-check.mjs`
