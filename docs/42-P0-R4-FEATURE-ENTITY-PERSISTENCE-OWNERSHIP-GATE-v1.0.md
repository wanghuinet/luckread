# Luckread P0 — R4 Feature → Domain → Entity / Persistence Ownership Gate v1.0

**Status:** IMPLEMENTED / FAIL-CLOSED / NOT GREEN

## Purpose

Establish a machine-verifiable boundary between Blueprint capabilities and persistence ownership before API implementation is allowed to expand.

## Required mapping

Every authoritative Blueprint Feature must eventually resolve to:

```text
Feature ID
→ Domain ID
→ Entity ID(s)
→ Persistence Mode
→ Data Owner
→ Evidence
```

## Persistence modes

- `NONE`: capability has no authoritative persistence requirement.
- `PAYLOAD_NATIVE`: behavior is owned by Payload's declared model/configuration.
- `LUCKREAD_EXTENSION`: explicit Luckread business persistence.
- `DERIVED`: projection/materialized/derived data, not a second business authority.
- `MIXED`: explicitly combines the above and must identify each ownership boundary.
- `UNKNOWN`: blocking; never infer.

## Hard invariants

1. Blueprint Feature IDs are authoritative.
2. Every Feature is represented exactly once in the registry.
3. Unknown Feature IDs are rejected.
4. Missing Feature mappings are rejected.
5. Every admitted record must be `VERIFIED` and contain evidence.
6. Every persistent Entity has exactly one authoritative owner.
7. Payload-native behavior must not be duplicated as a Luckread extension without explicit evidence and rationale.
8. Database table names, Payload collection names, API names, or feature-name similarity cannot create ownership mappings by inference.
9. Canonical IDs follow the cross-domain identity contract; IDs are not authorization credentials. See `docs/174-CANONICAL-ID-ENTITY-REFERENCE-UNIQUENESS-CONTRACT-v1.0.md`.
10. R4 remains blocked until the complete registry is explicitly populated and verified.

## CI gate

`scripts/feature-entity-persistence-registry-check.mjs` compares the registry against the active Blueprint Feature inventory and fails closed on missing, duplicate, unknown, unverified, or unsupported mappings.

## Next boundary

Only after R4 is green may the project promote mappings into:

```text
Entity → API → Permission → State → Worker → Event → NFR → Test
```
