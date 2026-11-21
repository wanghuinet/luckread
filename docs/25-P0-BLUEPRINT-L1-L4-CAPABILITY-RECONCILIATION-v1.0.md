# P0 Blueprint L1-L4 Capability Reconciliation v1.0

## Status

`NOT_GREEN`

This document defines the reconciliation gate between the functional master blueprint and the engineering Capability Contract Graph.

## Source of truth

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` is the functional source of truth. Older capability matrices are historical/reference material and cannot override the blueprint.

## Required chain

```text
Blueprint L1
  -> L2
  -> L3
  -> L4 / Feature ID
  -> Capability Owner
  -> API / Domain / Persistence
```

The repository must never infer a missing L2/L3 classification from an API, Payload collection, database table, or implementation file.

## Reconciliation states

- `MATCH` — explicitly mapped and consistent.
- `MISSING` — Blueprint capability has no Registry record.
- `UNKNOWN` — Registry record exists but its hierarchy/owner is unresolved.
- `CONFLICT` — multiple or incompatible mappings exist.
- `ORPHAN` — Registry/API/Domain/Persistence references a capability absent from the Blueprint.
- `DEPRECATED` — explicitly retired capability with replacement/deprecation evidence.

## Fail-closed rules

1. Every Blueprint Feature ID must occur exactly once in the Capability Registry.
2. Every Feature ID must have explicit L1/L2/L3/L4 values; `UNMAPPED` is not a valid final value.
3. Every Feature ID must have exactly one canonical owner.
4. API, Domain, and Persistence references must point to declared contract IDs.
5. A capability may be `INTERNAL` or `INFRASTRUCTURE`; it must not be forced into a public API merely because it exists in the Blueprint.
6. Registry entries absent from the Blueprint are failures unless explicitly marked as migration/deprecation evidence.
7. No database field, API operation, event, queue, permission, or Payload collection may silently create a new capability.
8. No capability may enter field-level API/database freeze while this reconciliation gate is `NOT_GREEN`.

## Current transition

The first machine gate is intentionally expected to fail because the Capability Registry was created before the complete L1-L4 mapping was populated. This is a safety state, not an implementation failure.

The next work item is to populate the Registry from the Blueprint and reconcile each capability against historical L4 material without allowing historical material to become a competing source of truth.

## Evidence

Validator:
`scripts/capability-l1-l4-reconciliation.mjs`

Registry:
`contracts/capability/capability-contract-graph.v1.json`

Schema:
`contracts/capability/capability-contract-graph.v1.schema.json`
