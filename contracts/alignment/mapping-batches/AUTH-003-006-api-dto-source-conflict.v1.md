# AUTH-003–AUTH-006 API/DTO Source Conflict Gate v1.0

## Status

`PARTIALLY_RECONCILED_NOT_GREEN`

## Authority chain

`Blueprint -> feature API contract -> canonical OpenAPI -> DTO registry -> Entity/Field authority -> Mapping`

The feature API contract is authoritative for operation and DTO target vocabulary. Persistence mappings and historical reconciliation artifacts are downstream mapping inputs and may contain stale aliases, but they do not define public API vocabulary.

## AUTH-003

AUTH-003 operation and wire-schema authority was resolved separately:
- canonical operations: `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove`;
- wire projection is closed at source-contract level;
- runtime/persistence/evidence remain downstream blockers.

## AUTH-004

Feature API contract target DTO vocabulary:
- `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
- `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
- `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
- `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`

Stale downstream aliases:
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`

Identifier source authority is resolved; exact reset-confirm wire schema remains separately blocked.

## AUTH-005

Feature API contract target DTO vocabulary:
- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE`

Stale downstream aliases:
- `DTO-AUTH-005-VERIFICATION-CONFIRM-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE-REQUEST`
- `DTO-AUTH-005-VERIFICATION-REVOKE-RESPONSE`

Identifier source authority is resolved; exact request/response wire schemas remain separately blocked.

## AUTH-006

AUTH-006 vocabulary was previously resolved by explicit authority decision and is not reopened.

## Canonical DTO registry rule

`contracts/dto/auth-dto-contract.v1.json` remains sourced from canonical OpenAPI. No AUTH-004/005 DTO registry record is added until the corresponding operation exists in OpenAPI with an authoritative schema reference.

This reconciliation does not add OpenAPI routes, invent fields, promote persistence aliases, authorize runtime implementation, or create Evidence Registry claims.

## Closure state

AUTH-004/005 identifier-source conflicts are `PASS_VERIFIED_VOCABULARY_ONLY`; OpenAPI/wire-schema/DTO promotion and Mapping 0 GREEN remain blocked.
