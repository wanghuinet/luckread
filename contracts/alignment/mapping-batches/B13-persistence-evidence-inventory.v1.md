# B13 — Persistence Evidence Inventory v1.0

## Status
BLOCKED / NOT GREEN

## Objective
Create the canonical evidence inventory for persistence reconciliation without inventing D1 schema facts.

## Current verified scope

The current entity-field contract marks `ENT-USER` as VERIFIED and defines six canonical fields: username, displayName, bio, avatar, locale, timezone. Each currently has `migrationVersion: PENDING_EVIDENCE`. fileciteturn41file0L2-L2

Repository search does not currently expose an authoritative field-level migration/schema record for `ENT-USER-F-USERNAME`; the only matching canonical record is the entity-field contract itself. fileciteturn45file0L2-L12

## Evidence inventory rules

For every VERIFIED entity, persistence evidence MUST be collected in this exact order:

1. Entity ID
2. Field ID
3. Payload collection/config source
4. Migration file path
5. Migration version/id
6. D1 table
7. D1 column
8. Storage/SQL type
9. Nullability
10. Default
11. Unique constraint
12. Index
13. Relation/FK, when applicable
14. Migration execution/status evidence
15. Validator result
16. Evidence commit SHA

## Prohibited inference

The following MUST NOT be converted into schema evidence:

- Payload collection field declaration alone
- `migrationDir` configuration alone
- dependency version alone
- documentation examples
- historical memory
- expected Payload internals without repository evidence
- a guessed table or column name

## Native Payload boundary

If Payload's D1 adapter creates or owns native authentication columns/tables, the evidence inventory MUST distinguish:

- Payload-native authoritative persistence
- project contract-owned extension fields
- derived/indexed data

The same semantic field MUST NOT have two authoritative persistence owners.

## Gate result

B13 remains BLOCKED until at least one complete real persistence chain exists and can be independently verified. A document describing the expected chain is not itself proof that the chain exists.

## Exit criteria

B13 GREEN requires:

`Entity → Field → Payload → Migration → D1 Table → D1 Column → Constraint → Execution → Validator → Commit Evidence`

for every admitted VERIFIED entity/field in the current Mapping 0 scope.

Until then Mapping 0 remains NOT GREEN and implementation remains blocked.

## Next batch

B14 — API/DTO reconciliation may proceed as contract analysis, but it MUST NOT be used to bypass the unresolved persistence gate.