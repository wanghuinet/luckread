# Mapping 0 Authority Decisions — 2026-09-20

## Decision basis

The user explicitly delegated the outstanding Mapping 0 authority decisions to the project review/acceptance process. Decisions below are derived from existing LuckRead Blueprint, Contract, Mapping, W01 runtime authority, and recorded Change Controls.

These decisions are governance decisions only. They authorize reconciliation; they do not by themselves constitute runtime implementation or GREEN evidence.

## Final decisions

### 1. AUTH-006 status classification
Control: `CC-MAPPING-0-AUTH-006-STATUS-CLASSIFICATION-2026-09-19`

Decision:
- `MISSING` = the Mapping record has no valid canonical mapping-bearing edge in any of: API operation IDs, Entity IDs, Payload collection references, or Code Evidence references.
- `PARTIAL` = at least one valid mapping-bearing edge exists, but the required downstream closure chain is incomplete or blocked.
- The `evidence`/Blueprint citation array alone does not count as a mapping-bearing edge.
- A status may not become GREEN merely because one or more edge groups are populated.

This is a classification rule only; it does not promote any feature.

### 2. Entitlements operationId collision
Control: `CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19`

Decision:
- `GET /v1/entitlements` canonical operationId = `listEntitlements`.
- `GET /v1/entitlements/{subjectId}` canonical operationId = `getEntitlements`.
- The generated collision suffix `getEntitlementsOp` is not an independently authoritative operation.
- Reconcile API Inventory, OpenAPI, operation-policy and affected generated artifacts together.
- Do not delete either route merely to satisfy uniqueness.

Rationale: the two routes have distinct collection-vs-subject semantics, existing operation naming conventions use `listX` for collection reads, and `getEntitlements` is already the established subject-specific operation.

### 3. DTO representation
Control: `CC-MAPPING-0-DTO-REPRESENTATION-GAP-2026-09-19`

Decision: **B**.
- DTO authority remains the dedicated canonical DTO contract/registry.
- Canonical Mapping is not extended with a new `dtoIds` field at Mapping 0 closure.
- DTO-to-feature/API relationships are proved through the existing DTO contract and deterministic reconciliation artifacts.

### 4. AUTH-003 operationId source
Control: `CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19`

Decision:
- Canonical AUTH-003 operation set:
  - `authCredentialList`
  - `authCredentialAdd`
  - `authCredentialReplace`
  - `authCredentialRemove`
- The feature contract and its OpenAPI-promotion input are the canonical target vocabulary.
- The persistence-side identifiers `authUsernameCreate`, `authUsernameChange`, `authEmailAdd`, `authEmailChange`, `authPhoneAdd`, `authPhoneChange` are treated as stale/unreconciled downstream identifiers until mapped to the canonical API operations.
- No operationId is renamed by inference; reconciliation must update dependent references as one controlled set.

### 5. AUTH-006 DTO aliases and domain coupling
Control: `CC-MAPPING-0-AUTH-006-ALIAS-AND-DOMAIN-CONFLICT-2026-09-19`

Decision:
- Canonical AUTH-006 DTO vocabulary is:
  - `DTO-AUTH-006-REGISTRATION-OPTIONS`
  - `DTO-AUTH-006-REGISTRATION-VERIFY`
  - `DTO-AUTH-006-ASSERTION-OPTIONS`
  - `DTO-AUTH-006-ASSERTION-VERIFY`
  - `DTO-AUTH-006-REMOVE`
- The `DTO-AUTH-006-PASSKEY-*` names are treated as aliases requiring reconciliation to the canonical vocabulary.
- Domain naming follows Decision 6 below; no separate AUTH-006 domain name is invented.

### 6. Cross-feature logical D1 domain naming
Control: `CC-MAPPING-0-D1-DOMAIN-NAMING-CONFLICT-2026-09-19`

Decision: **D01 Core** is the canonical logical domain label for the affected AUTH-006/AUTH-013/AUTH-015 reconciliation surfaces.
- Existing `D1-01` references are legacy/stale references to be reconciled.
- This is a logical domain identifier only.
- It is not evidence of a physical D1 database, table, schema, migration or deployment.
- No new D1 domain is created.

### 7. W01 ENT-USER field source
Control: `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18`

Decision: **A**.
The six already-canonical ENT-USER fields remain authoritative and are the target W01 Users contract:
- `username`
- `displayName`
- `bio`
- `avatar`
- `locale`
- `timezone`

Reconciliation must bind these fields to active W01 `Users.ts` and later produce migration/persistence evidence. The actual field implementation remains gated by the project GREEN→implement rule and is not performed as part of this decision record.

### 8. W01 Media collection authority
Control: `CC-MAPPING-0-W01-MEDIA-COLLECTION-ENTITY-AUTHORITY-GAP-2026-09-19`

Decision: **B**.
The current W01 `media` collection is treated as a Payload support collection for upload/asset handling at Mapping 0; it is not promoted to a canonical domain Entity.
- No `ENT-MEDIA` is created.
- No unrelated Entity is assigned.
- The reconciliation validator receives an explicit support-collection exemption keyed to the active W01 collection source.
- Domain-level MEDIA features remain separately governed by the Blueprint and their future API/Entity/DTO mapping contracts.

## Decision-to-reconciliation dependency

The eight authority controls have been processed through deterministic reconciliation. Current state is:

| Control | Current reconciliation state |
|---|---|
| `CC-MAPPING-0-AUTH-006-STATUS-CLASSIFICATION-2026-09-19` | `PASS_VERIFIED` |
| `CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19` | `PASS_VERIFIED` |
| `CC-MAPPING-0-DTO-REPRESENTATION-GAP-2026-09-19` | `PASS_VERIFIED` |
| `CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19` | `TODO_FIX` — wire-schema authority still blocked |
| `CC-MAPPING-0-AUTH-006-ALIAS-AND-DOMAIN-CONFLICT-2026-09-19` | `PASS_VERIFIED` |
| `CC-MAPPING-0-D1-DOMAIN-NAMING-CONFLICT-2026-09-19` | `PASS_VERIFIED` |
| `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18` | `PASS_VERIFIED` |
| `CC-MAPPING-0-W01-MEDIA-COLLECTION-ENTITY-AUTHORITY-GAP-2026-09-19` | `PASS_VERIFIED` |

No feature/runtime status is promoted by this decision record.

## Reconciliation completed for the closed controls

1. Entitlements API Inventory/OpenAPI/policy/generated artifacts — reconciled.
2. AUTH-006 DTO aliases and logical domain references — reconciled.
3. AUTH-013/AUTH-015 logical domain references — reconciled.
4. ENT-USER field target-source references — reconciled at contract/source level; migration/runtime evidence remains separate.
5. W01 Media support-collection exemption — reconciled.
6. Mapping status classifier rule — accepted and applied; AUTH-006 is `PARTIAL`.
7. B01 API path representation was additionally reconciled in `M0-B01-API-PATH-NORMALIZATION-AUDIT-2026-09-20`.
8. Full Contract CI / Mapping-0 re-validation remains a downstream gate and is not claimed GREEN by this record.

## Remaining explicit blocker

Only `CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19` remains technically pending from this eight-control decision batch, because the exact public AUTH-003 Wire Schema has not been explicitly contracted.

This does not authorize OpenAPI/DTO/Mapping promotion.


### 9. AUTH-002 E5 execution authorization incident
Control: `CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21`

Decision:
- Run 35552919573 was **not authorized at execution time** because the authoritative E5 Status field was `OPEN — EXECUTION DECISION REQUIRED`.
- The technical postconditions and independent read-only schema evidence are retained as factual evidence of the observed remote state.
- The run is not retroactively classified as GREEN-authorized execution evidence.
- No second E5 execution and no compensating D1 mutation are authorized solely to repair the governance incident.
- The parent E5 execution Change Control is closed as an authority-reconciliation incident with the technical result retained.
- This decision does not promote AUTH-002 or Mapping 0.

Rationale:
The recorded execution was technically successful, but the governing authority condition was false at the moment of execution. Correct reconciliation is to preserve provenance, classify authorization accurately, harden the admission control, and prevent duplicate mutation rather than rewrite the historical authorization state.

Reconciliation state:
- Control-defect remediation: `PASS_VERIFIED`.
- Authority incident reconciliation: `PASS_VERIFIED`.
- E5 technical evidence: retained, not retroactively authorized.
- Next gate: E6 runtime integration under its existing implementation/evidence Change Controls.


### 10. AUTH-002 E6 implementation admission / wire-input gaps

Review result for `CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21`:

Decision:
- E6 runtime implementation is **not admitted yet**.
- `authRefresh` exists in the Auth API policy and has a canonical OpenAPI discovery shell, but its admitted Wire Schema is missing; no request/response/error contract may be inferred from the policy, Discovery Draft, or Payload-native refresh behavior.
- `ENT-SESSION-F-DEVICE-ID` is a required canonical field, but the current AUTH-002 public login wire contract does not define an authoritative transport/source for the device binding.
- Therefore E6 implementation must remain blocked until these two inputs are resolved through normal Contract-First Change Control.
- No new device entity, header, API field, refresh endpoint, DTO, Worker or D1 domain is introduced by this decision.

Reconciliation state:
- Parent E5 authority incident: `PASS_VERIFIED`.
- E5 technical result: retained without retroactive authorization.
- E6 implementation admission: `BLOCKED — REQUIRED CONTRACT INPUTS MISSING`.
- Mapping 0 remains `NOT_GREEN`.
