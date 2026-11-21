# CC-MAPPING-0-AUTH-004-DTO-REGISTRY-RECONCILIATION-2026-09-28

## Status

`CONTRACT_RECONCILED / RUNTIME_NOT_AUTHORIZED`

## Scope

Reconcile the AUTH-004 DTO registry with the already-existing canonical OpenAPI operations. Remove only the obsolete `operationId: null` AUTH-004 placeholder; do not alter the five canonical DTO identifiers, OpenAPI paths, runtime behavior, persistence, or Mapping 0 status.

## Authority

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `contracts/openapi/v1/openapi.yaml`
- `contracts/dto/auth-dto-contract.v1.json`
- `docs/change-control/CC-MAPPING-0-AUTH-004-005-DTO-VOCABULARY-AUTHORITY-2026-09-26.md`

## Reconciliation

The canonical OpenAPI surface already contains:

- `authPasswordChange` → `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST` → HTTP 204 / no body DTO
- `authPasswordResetRequest` → `DTO-AUTH-004-PASSWORD-RESET-REQUEST` → HTTP 202 / no body DTO
- `authPasswordResetConfirm` → `DTO-AUTH-004-PASSWORD-RESET-CONFIRM` → HTTP 204 / no body DTO

The DTO contract therefore removes the obsolete AUTH-004 `operationId: null` reservation. AUTH-005's separate unresolved reservation is untouched.

## Non-actions

- no API path change;
- no DTO vocabulary change;
- no runtime implementation;
- no Payload core change;
- no migration or D1 change;
- no entity promotion;
- no Evidence Registry promotion;
- no Mapping 0 GREEN.

## Result

AUTH-004 contract-layer operation → DTO traceability is internally consistent. Runtime, persistence, security-E2E and global Mapping 0 admission remain blocked independently.
