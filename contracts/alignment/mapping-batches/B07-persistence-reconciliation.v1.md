# B07 Persistence Reconciliation v1.0

Status: BLOCKED / NOT_GREEN

## Purpose
Close the Entity → Field → Persistence → Migration → Authority portion of Mapping 0 without inference. This batch is a mapping/evidence closure batch only; it does not implement application code.

## Current verified facts

1. `ENT-USER` is the only currently verified entity in the persistence inventory.
2. `ENT-USER` implementation is `src/collections/Users.ts`.
3. Payload is configured with `@payloadcms/db-d1-sqlite` and `push: false`.
4. Payload configuration points `migrationDir` to `src/migrations`.
5. The current `main` source tree does not expose a `src/migrations` directory, so migration evidence cannot currently be promoted to GREEN.
6. The canonical persistence inventory therefore correctly keeps `ENT-USER.persistenceStatus = NOT_VERIFIED` and `migrationRefs = []`.

## Required closure chain

For every VERIFIED entity, all of the following must be evidenced before promotion:

`Entity ID → Field ID → Payload field → persisted table → persisted column → SQL type → nullability → uniqueness → index → relation/FK (if applicable) → migration ID/file → migration execution evidence → authority mapping`

No table/column/migration identifier may be invented from Payload conventions.

## B07 work items

- [ ] Reconcile the complete entity inventory against Blueprint v2.0.
- [ ] For `ENT-USER`, obtain authoritative generated/checked migration evidence.
- [ ] Bind every existing `ENT-USER-F-*` field to an authoritative persistence representation.
- [ ] Verify SQL type, nullability, unique/index semantics from actual migration/schema evidence.
- [ ] Verify the D1 database/domain authority reference.
- [ ] Reconcile migration files with the Payload adapter configuration.
- [ ] Add machine-checkable evidence references for each promoted mapping.
- [ ] Re-run Mapping 0 validator and require fail-closed behavior for unresolved records.

## Promotion rule

B07 cannot be marked GREEN merely because Payload is configured with a D1 adapter. Configuration proves adapter intent, not the concrete persisted schema or migration history. Until the complete evidence chain exists, the status remains NOT_GREEN.

## Development gate

Mapping 0 remains closed to base/worker implementation until all blocking mapping records are GREEN and the canonical validator/evidence registry independently verifies the result.
