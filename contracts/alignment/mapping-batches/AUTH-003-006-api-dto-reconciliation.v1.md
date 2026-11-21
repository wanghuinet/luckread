# AUTH-003–AUTH-006 API/DTO Reconciliation v1.0

## Status

`API_CANONICAL_PARTIAL / AUTH-003 DTO CANONICAL_BOUND / NOT_GREEN`

## Authority rule

The canonical API operation authority is the feature-specific API contract when present and must ultimately reconcile with `contracts/openapi/v1/openapi.yaml`. The canonical DTO registry may only bind operations evidenced by the canonical API/OpenAPI authority. Existing persistence mapping rows are not API authority.

## AUTH-003

Canonical API contract identified:
`contracts/api/AUTH-003-credential-management-contract.v1.json`

Canonical operations evidenced:
- `authCredentialList` — `GET /auth/credentials`
- `authCredentialAdd` — `POST /auth/credentials`
- `authCredentialReplace` — `PUT /auth/credentials/{credentialId}`
- `authCredentialRemove` — `DELETE /auth/credentials/{credentialId}`

Existing persistence mapping operations such as `authUsernameCreate`, `authUsernameChange`, `authEmailAdd`, `authEmailChange`, `authPhoneAdd`, and `authPhoneChange` are therefore treated as `STALE_OR_UNRECONCILED` until an authoritative API source explicitly binds them.

Canonical AUTH-003 DTO binding is present in `contracts/dto/auth-dto-contract.v1.json` and `contracts/dto/auth-dto-records.v1.json`. The records resolve directly to the current OpenAPI request/response schemas; `authCredentialRemove` is explicitly represented as no-body/204.

## AUTH-004

Canonical API contract identified:
`contracts/api/AUTH-004-password-recovery-contract.v1.json`

Canonical operations evidenced:
- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

DTO binding remains blocked until the canonical DTO registry contains authoritative records for these operations.

## AUTH-005

Canonical API contract identified:
`contracts/api/AUTH-005-identity-verification-contract.v1.json`

Canonical operations evidenced include:
- `authVerificationRequest` — `POST /auth/verification/request`
- `authVerificationConfirm` — `POST /auth/verification/confirm`

The complete operation set must be read from the contract before any DTO promotion; no DTO is inferred from operation names.

## AUTH-006

Canonical API contract identified:
`contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`

Canonical operations evidenced include:
- `authPasskeyRegistrationOptions` — `POST /auth/passkeys/registration/options`
- `authPasskeyRegistrationVerify` — `POST /auth/passkeys/registration/verify`
- `authPasskeyAssertionOptions` — `POST /auth/passkeys/assertion/options`

Remaining operations must be taken from the same canonical contract and not inferred from persistence mapping.

## Canonical DTO registry finding

`contracts/dto/auth-dto-contract.v1.json` contains canonical AUTH-003 bindings. AUTH-004～AUTH-006 remain separate unresolved promotion work.

Therefore the following are prohibited until DTO reconciliation:

- changing persistence mappings solely to match DTO names;
- creating DTO IDs only because a persistence mapping references them;
- marking AUTH-003–AUTH-006 DTO mapping as GREEN;
- implementing runtime handlers against non-canonical DTO identifiers as though they were public contract identifiers.

## Required next closure

1. Keep AUTH-003 canonical operation/DTO bindings stable; do not reopen wire authority.
2. Reconcile AUTH-003 persistence mapping against the canonical DTO refs and admitted physical D1 mapping.
3. Execute the smallest remaining runtime slice: credential list, then Replace/Remove.
4. Keep entity catalog promotion and Mapping-0 GREEN separate from runtime evidence.

## Promotion

This reconciliation does not promote any feature. Current feature states remain `NOT_GREEN` until canonical API + DTO + entity/field + persistence + runtime + security evidence + Evidence Registry + same-SHA Mapping-0 are complete.
