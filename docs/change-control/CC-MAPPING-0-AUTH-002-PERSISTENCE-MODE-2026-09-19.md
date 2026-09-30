# Change Control — AUTH-002 Persistence Mode Semantic Correction

- ID: CC-MAPPING-0-AUTH-002-PERSISTENCE-MODE-2026-09-19
- Date: 2026-09-19
- Scope: Feature → Entity → Persistence registry semantics
- Status: APPROVED_FOR_GOVERNANCE_CORRECTION

## Finding

The existing AUTH-002 record in
`contracts/capability/feature-entity-persistence-registry.v1.json`
uses:

`persistenceMode = LUCKREAD_EXTENSION`

The authoritative AUTH-002 persistence closure contract explicitly states that:

- Payload native `users.sessions[]` remains authoritative for `id`, `createdAt`, and `expiresAt`;
- Luckread extension persistence `auth_session_state` owns the additional session-state dimensions.

The registry's existing persistence-mode definition says `MIXED` is used when a capability explicitly combines the native and extension ownership boundaries.

## Correction

Change only AUTH-002 registry `persistenceMode` from `LUCKREAD_EXTENSION` to `MIXED`.

Preserve:

- feature ID;
- entity IDs;
- domain/owner `D1-01`;
- evidence references;
- `BLOCKED` status.

## Non-goals

This correction does not claim that either native or extension D1 persistence has been newly executed or verified. It does not create a new table, migration, API, DTO, runtime implementation, or evidence result.
