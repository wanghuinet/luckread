# AUTH-003～AUTH-006 OpenAPI Operation Reconciliation v1

Status: `BLOCKED_NOT_GREEN`

## Purpose

Freeze the exact authority gap between the feature-specific AUTH-003～AUTH-006 API contracts and `contracts/openapi/v1/openapi.yaml` before any DTO registry or persistence Mapping promotion.

## Authority rule

The feature contracts define proposed/canonical feature operations, but the current canonical DTO registry is sourced from OpenAPI. Therefore a feature operation is not admitted to the canonical DTO chain until an exact OpenAPI route exists with the same `operationId`, HTTP method, path, request schema, response schema, and relevant status-code semantics.

No operation, DTO, request schema, response schema, or status code may be inferred from another contract merely to remove a Mapping blocker.

## Current verified gap

The inspected OpenAPI document currently contains the Auth routes for registration, login, and logout, including `authRegister`, `authLogin`, and `authLogout`. It does not currently expose the AUTH-003～AUTH-006 feature operations identified below.

### AUTH-003

Feature contract operations:

- `authCredentialList` — `GET /auth/credentials`
- `authCredentialAdd` — `POST /auth/credentials`
- `authCredentialReplace` — `PUT /auth/credentials/{credentialId}`
- `authCredentialRemove` — `DELETE /auth/credentials/{credentialId}`

Feature DTO IDs:

- `DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-ADD-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REMOVE-RESPONSE`

Result: `OPENAPI_ROUTE_MISSING`.

### AUTH-004

Feature contract operations:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

Feature DTO IDs:

- `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
- `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
- `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
- `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`

Result: `OPENAPI_ROUTE_MISSING`.

### AUTH-005

Feature contract operations:

- `authVerificationRequest` — `POST /auth/verification/request`
- `authVerificationConfirm` — `POST /auth/verification/confirm`
- `authVerificationRevoke` — `POST /auth/verification/revoke`

Feature DTO IDs:

- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE`

Result: `OPENAPI_ROUTE_MISSING`.

### AUTH-006

Feature contract operations:

- `authPasskeyRegistrationOptions` — `POST /auth/passkey/registration/options`
- `authPasskeyRegistrationVerify` — `POST /auth/passkey/registration/verify`
- `authPasskeyAuthenticationOptions` — `POST /auth/passkey/authentication/options`
- `authPasskeyAuthenticationVerify` — `POST /auth/passkey/authentication/verify`
- `authPasskeyRemove` — `DELETE /auth/passkey/{credentialId}`

Result: `OPENAPI_ROUTE_MISSING` for the inspected OpenAPI authority.

## Admission matrix

| Feature | API contract | OpenAPI route | Canonical DTO admission | Mapping promotion |
|---|---|---|---|---|
| AUTH-003 | present | missing | blocked | blocked |
| AUTH-004 | present | missing | blocked | blocked |
| AUTH-005 | present | missing | blocked | blocked |
| AUTH-006 | present | missing | blocked | blocked |

## Required next gate

Before DTO registry mutation:

1. Decide whether the feature contracts are to be promoted into the canonical OpenAPI authority.
2. If promoted, add exact routes and schemas to OpenAPI; do not invent schemas beyond existing feature-contract evidence.
3. Run OpenAPI structural/schema validation.
4. Update the canonical DTO registry from the resulting OpenAPI authority.
5. Reconcile persistence Mapping IDs only after canonical DTO IDs are established.
6. Run Mapping-0 and keep all rows fail-closed until runtime/persistence evidence exists.

## Explicit prohibitions

- Do not mark AUTH-003～006 DTOs GREEN because feature contracts exist.
- Do not copy feature DTO IDs into the canonical registry without OpenAPI authority resolution.
- Do not rename stale Mapping DTO IDs merely to make string equality pass.
- Do not infer request/response schemas, status codes, or error projections.
- Do not treat this document as runtime or persistence evidence.

## Evidence status

This is contract/audit evidence only. No runtime, D1, migration, security-E2E, concurrency-E2E, or Mapping-0 GREEN promotion is claimed by this document.
