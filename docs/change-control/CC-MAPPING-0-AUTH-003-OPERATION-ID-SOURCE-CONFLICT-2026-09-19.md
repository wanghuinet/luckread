# CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19

## Status

PASS_VERIFIED — OPERATION SET RECONCILED; WIRE SCHEMA REMAINS BLOCKED

## Purpose

Record the verified operationId divergence for AUTH-003 between the Canonical Mapping and the shared AUTH-002..006 persistence/API/entity/field binding artifact.

## Verified facts

1. Canonical Mapping currently uses:
   - `authCredentialList`
   - `authCredentialAdd`
   - `authCredentialReplace`
   - `authCredentialRemove`
2. The AUTH-003 canonical feature contract also defines those four operations and their routes under `/auth/credentials`.
3. The shared persistence/API/entity/field mapping currently uses:
   - `authUsernameCreate`
   - `authUsernameChange`
   - `authEmailAdd`
   - `authEmailChange`
   - `authPhoneAdd`
   - `authPhoneChange`
4. None of either operation set is currently admitted in the canonical API Inventory/OpenAPI surface for AUTH-003.
5. Existing reconciliation documentation already describes the persistence-style IDs as `STALE_OR_UNRECONCILED` pending an authoritative API source.
6. The persistence mapping DTO reference is also not the canonical DTO registry binding because AUTH-003 canonical DTO admission remains blocked.

## Conflict

The same AUTH-003 feature is represented by two incompatible operationId vocabularies across authoritative-looking artifacts.

This creates a direct API → DTO → persistence reconciliation hazard.

## Required decision

The authoritative operation set must be selected through the existing AUTH-003 OpenAPI admission/change-control process. After selection, all dependent artifacts must be reconciled together:

- Canonical API Inventory
- Canonical OpenAPI
- AUTH-003 feature contract
- DTO registry
- shared persistence/API/entity/field mapping
- Canonical Mapping
- five-way reconciliation

No operationId is renamed, deleted, or promoted by this record.

## Gate impact

- AUTH-003 remains `PARTIAL` / fail-closed.
- No DTO admission is granted.
- No persistence ownership is promoted.
- No runtime implementation is authorized.

## Evidence

- `contracts/alignment/mapping-batches/AUTH-003-006-api-dto-source-conflict.v1.md`
- `contracts/alignment/mapping-batches/AUTH-003-006-api-dto-reconciliation.v1.md`
- `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`

## Acceptance

Future Mapping 0 conversations must classify this as an already-detected AUTH-003 operationId conflict and must not independently invent a preferred operation set.

## Decision accepted — 2026-09-20

Decision 4 accepted: AUTH-003 canonical operation set is authCredentialList/authCredentialAdd/authCredentialReplace/authCredentialRemove; persistence-side identifiers remain downstream stale aliases pending admission.


## Reconciliation closure — 2026-09-22

The operationId source-conflict portion of this Change Control is now closed at the authority/reconciliation layer.

- Canonical operation set remains exactly: `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove`.
- The accepted operation set is the authoritative vocabulary for the AUTH-003 feature surface.
- Persistence-side identifiers (`authUsernameCreate`, `authUsernameChange`, `authEmailAdd`, `authEmailChange`, `authPhoneAdd`, `authPhoneChange`) remain stale/downstream aliases and are not promoted.
- This closure does not define or infer any request/response field, status code, error body, list ordering, path-parameter schema, DTO schema, persistence schema, runtime behavior, or OpenAPI admission.
- The exact public Wire Schema remains governed by the existing AUTH-003 wire-schema closure gate.

Acceptance boundary:
- Operation vocabulary conflict: `PASS_VERIFIED`.
- Wire Schema / OpenAPI / DTO admission: unchanged and still blocked.
- No runtime, persistence, Worker, D1, or Mapping promotion is authorized by this reconciliation alone.

## 2026-09-26 Wire-schema admission reconciliation

The previously selected canonical operation set is now admitted through the explicit AUTH-003 wire-schema decision and encoded in OpenAPI/DTO/API Inventory/Operation Policy. The operationId conflict is fully closed; the remaining downstream gates are runtime, persistence and executable evidence.
