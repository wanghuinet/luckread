# AUTH-003–AUTH-006 API/DTO Reconciliation v1.0

## Status

`API_CANONICAL_PARTIAL / DTO_CANONICAL_BLOCKED / NOT_GREEN`

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

Canonical DTO binding remains blocked because `contracts/dto/auth-dto-contract.v1.json` does not currently contain an AUTH-003 canonical operation record.

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

`contracts/dto/auth-dto-contract.v1.json` currently binds AUTH-001 and AUTH-002 only, while AUTH-003, AUTH-004 and AUTH-005 are explicitly unresolved. AUTH-006 is also not represented as a canonical DTO record in the inspected contract.

Therefore the following are prohibited until DTO reconciliation:

- changing persistence mappings solely to match DTO names;
- creating DTO IDs only because a persistence mapping references them;
- marking AUTH-003–AUTH-006 DTO mapping as GREEN;
- implementing runtime handlers against non-canonical DTO identifiers as though they were public contract identifiers.

## Required next closure

1. Reconcile each feature API contract with `openapi.yaml`.
2. Add or amend canonical OpenAPI operations where the feature contract is authoritative and the public API is intended to expose them.
3. Add canonical DTO registry records only after the operation IDs and schema refs are authoritative.
4. Reconcile persistence mapping to the resulting canonical operation/DTO IDs.
5. Run Mapping-0 and keep runtime/evidence states separate.

## Promotion

This reconciliation does not promote any feature. Current feature states remain `NOT_GREEN` until canonical API + DTO + entity/field + persistence + runtime + security evidence + Evidence Registry + same-SHA Mapping-0 are complete.
