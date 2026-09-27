# AUTH-003～AUTH-006 OpenAPI Operation Reconciliation v1

Status: `BLOCKED_NOT_GREEN`

## Purpose

Freeze the exact authority gap between the feature-specific AUTH-003～AUTH-006 API contracts and `contracts/openapi/v1/openapi.yaml` before any DTO registry or persistence Mapping promotion.

## Authority rule

The feature contracts define the currently authoritative feature-operation proposals. The canonical DTO registry is sourced from the canonical OpenAPI surface. Therefore a feature operation is not admitted to the canonical DTO chain until an exact OpenAPI route exists with the same `operationId`, HTTP method, path, request schema, response schema, and relevant status-code semantics.

No operation, DTO, request schema, response schema, or status code may be inferred from another contract merely to remove a Mapping blocker.

## Current verified disposition

The current OpenAPI document contains all four AUTH-003 operations with matching method/path/operationId and concrete request/response/parameter schemas. AUTH-004～AUTH-006 remain outside the admitted OpenAPI surface.

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

Result: `OPENAPI_ROUTE_AND_SCHEMA_VERIFIED` for AUTH-003.

### AUTH-004

Feature contract operations:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

Feature DTO IDs:

- `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
- `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
- `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`

Result: `OPENAPI_ROUTE_MISSING`.

### AUTH-005

Feature contract operations:

- `authVerificationRequest` — `POST /auth/verification/request`
- `authVerificationConfirm` — `POST /auth/verification/confirm`
- `authVerificationRevoke` — `POST /auth/verification/revoke`

Feature DTO IDs:

- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE-REQUEST`
- `DTO-AUTH-005-VERIFICATION-REVOKE-RESPONSE`

Result: `OPENAPI_ROUTE_MISSING`.

### AUTH-006

The current authoritative feature contract uses **passkey assertion** terminology and plural `/auth/passkeys` routes.

Feature contract operations:

- `authPasskeyRegistrationOptions` — `POST /auth/passkeys/registration/options`
- `authPasskeyRegistrationVerify` — `POST /auth/passkeys/registration/verify`
- `authPasskeyAssertionOptions` — `POST /auth/passkeys/assertion/options`
- `authPasskeyAssertionVerify` — `POST /auth/passkeys/assertion/verify`
- `authPasskeyRemove` — `DELETE /auth/passkeys/{credentialId}`

Feature DTO IDs:

- `DTO-AUTH-006-REGISTRATION-OPTIONS`
- `DTO-AUTH-006-REGISTRATION-VERIFY`
- `DTO-AUTH-006-ASSERTION-OPTIONS`
- `DTO-AUTH-006-ASSERTION-VERIFY`
- `DTO-AUTH-006-REMOVE`

Result: `OPENAPI_ROUTE_MISSING` for the inspected OpenAPI authority.

### Stale terminology explicitly retired

Earlier draft reconciliation text used:

- singular `/auth/passkey/... ` paths;
- `authPasskeyAuthenticationOptions`;
- `authPasskeyAuthenticationVerify`.

Those identifiers are **not** the current AUTH-006 feature-contract authority and must not be copied into OpenAPI, DTO, persistence, or Mapping-0 records. The current contract uses `assertion` operation names and plural `/auth/passkeys` paths.

## Admission matrix

| Feature | API contract | OpenAPI route | Canonical DTO admission | Mapping promotion |
|---|---|---|---|---|
| AUTH-003 | present | verified | bound | downstream blocked |
| AUTH-004 | present | missing | blocked | blocked |
| AUTH-005 | present | missing | blocked | blocked |
| AUTH-006 | present | missing | blocked | blocked |

## Required next gate

After AUTH-003 wire closure:

1. Keep the existing AUTH-003 OpenAPI routes/schemaRefs stable.
2. Reconcile persistence Mapping DTO refs against the canonical AUTH-003 DTO registry.
3. Execute the credential-list runtime/evidence slice.
4. Keep Replace/Remove and entity/Mapping-0 promotion separate.

## Explicit prohibitions

- Do not mark AUTH-003～006 DTOs GREEN because feature contracts exist.
- Do not copy feature DTO IDs into the canonical registry without OpenAPI authority resolution.
- Do not rename stale Mapping DTO IDs merely to make string equality pass.
- Do not infer request/response schemas, status codes, or error projections.
- Do not treat this document as runtime or persistence evidence.

## Evidence status

This is contract/audit evidence only. AUTH-003 OpenAPI/DTO encoding is PASS_VERIFIED; no runtime, entity VERIFIED, Evidence Registry GREEN, or Mapping-0 GREEN promotion is claimed.
