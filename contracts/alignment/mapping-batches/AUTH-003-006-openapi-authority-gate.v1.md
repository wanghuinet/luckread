# AUTH-003–AUTH-006 OpenAPI Authority Gate v1.0

## Status

`BLOCKED_NOT_GREEN`

## Purpose

Establish a fail-closed gate between feature-specific API contracts, the canonical OpenAPI surface, canonical DTO registry, and persistence Mapping-0. This gate records only verified source relationships; it does not invent public routes or DTO schemas.

## Authority chain

`Feature API Contract -> OpenAPI -> Canonical DTO Registry -> Entity/Field -> Persistence Mapping -> Mapping-0`

The current canonical DTO contract declares `contracts/openapi/v1/openapi.yaml` as its source of truth and permits DTO bindings only for operations actually evidenced there. Therefore an AUTH-003–AUTH-006 feature contract alone is insufficient to create a canonical DTO binding.

## Route reconciliation matrix

| Feature | Feature-contract operations | Current OpenAPI evidence | Canonical DTO state | Gate |
|---|---|---|---|---|
| AUTH-003 | `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove` | All four routes are present in `contracts/openapi/v1/openapi.yaml` with matching operationIds, request/response schema refs, credentialId parameter, and canonical error responses | Contract-bound | `PASS_VERIFIED` |
| AUTH-004 | `authPasswordChange`, `authPasswordResetRequest`, `authPasswordResetConfirm` | No corresponding password-change/reset routes verified in the inspected OpenAPI surface | Blocked | `RED` |
| AUTH-005 | `authVerificationRequest`, `authVerificationConfirm`, `authVerificationRevoke` | No corresponding verification routes verified in the inspected OpenAPI surface | Blocked | `RED` |
| AUTH-006 | `authPasskeyRegistrationOptions`, `authPasskeyRegistrationVerify`, `authPasskeyAssertionOptions`, `authPasskeyAssertionVerify`, `authPasskeyRemove` | No corresponding passkey routes verified in the inspected OpenAPI surface | Blocked | `RED` |

The inspected OpenAPI document now also contains the complete AUTH-003 credential-management surface. API Contract CI has validated the current OpenAPI surface. AUTH-004～AUTH-006 remain under the separate blocked rows above.

## DTO authority rule

The feature-specific API contracts already declare DTO IDs, but these IDs remain `CONTRACTUAL_NOT_CANONICAL` until each operation is represented in the authoritative OpenAPI surface with a request/response schema reference.

### AUTH-003

Feature contract DTO set:
- `DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-ADD-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REMOVE-RESPONSE`

Canonical DTO binding is present: `contracts/dto/auth-dto-contract.v1.json` contains the AUTH-003 list/add/replace/remove bindings, and `contracts/dto/auth-dto-records.v1.json` resolves the corresponding OpenAPI schemaRefs. Remove is explicit no-body/204.

### AUTH-004

Feature contract DTO set:
- `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
- `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
- `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
- `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`

No canonical registry binding is admitted yet. Existing persistence mapping references `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST` and `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`, which are not the same identifiers and therefore remain unreconciled.

### AUTH-005

Feature contract DTO set:
- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE`

No canonical registry binding is admitted yet. Persistence mapping contains additional request/response DTO identifiers that do not match this feature contract set.

### AUTH-006

Feature contract DTO set:
- `DTO-AUTH-006-REGISTRATION-OPTIONS`
- `DTO-AUTH-006-REGISTRATION-VERIFY`
- `DTO-AUTH-006-ASSERTION-OPTIONS`
- `DTO-AUTH-006-ASSERTION-VERIFY`
- `DTO-AUTH-006-REMOVE`

No canonical registry binding is admitted yet. Persistence mapping currently uses `DTO-AUTH-006-PASSKEY-*` identifiers, which remain unreconciled aliases rather than canonical IDs.

## Mapping protection

The persistence mapping MUST NOT be rewritten to any DTO or operation identifier until the OpenAPI authority decision is resolved. In particular:

- no status-only promotion;
- no alias acceptance without an explicit canonical mapping rule;
- no DTO registry insertion based solely on feature-contract DTO IDs;
- no replacement of stale Mapping rows merely to make CI syntactically consistent;
- no Mapping-0 GREEN while canonical operation and DTO sets remain unresolved.

## Closure conditions

The gate can move from `BLOCKED_NOT_GREEN` only after all applicable conditions are met:

1. Public API exposure decision is recorded for AUTH-003–AUTH-006.
2. Intended operations are present in the canonical OpenAPI document.
3. Every operation has authoritative request/response schema references, including explicit no-body responses where applicable.
4. Canonical DTO IDs are registered exactly once and linked to those schema references.
5. Persistence Mapping operationIds/dtoRefs are reconciled to those canonical IDs.
6. Mapping-0 reports no stale/unresolved operation or DTO references.
7. Runtime, persistence, security, Evidence Registry, and same-SHA verification remain separate downstream gates.

## Current conclusion

AUTH-003 has closed the OpenAPI/DTO encoding gate for its current wire contract. The combined AUTH-003～AUTH-006 gate remains `BLOCKED_NOT_GREEN` because AUTH-004～AUTH-006 are still unresolved. AUTH-003 downstream blockers are runtime/persistence evidence, entity catalog promotion, and final Mapping-0 closure.
