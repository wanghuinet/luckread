# CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19

## Status

OPEN — AUTHORITY RECONCILIATION REQUIRED / NO AUTO-RENAME

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
