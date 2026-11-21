# AUTH-003～AUTH-006 OpenAPI Promotion Input v1

Status: `BLOCKED_NOT_GREEN`

## Purpose

Freeze the exact feature-contract inputs required to promote AUTH-003～AUTH-006 into the canonical OpenAPI authority. This document is an input specification, not permission to silently invent schemas.

## Authority

The current OpenAPI authority contains `authRegister`, `authLogin`, and `authLogout`, while the feature contracts define additional AUTH-003～006 operations. The feature contracts themselves remain `CONTRACTED_NOT_VERIFIED`; their API/DTO status is not runtime evidence.

## AUTH-003

| operationId | method | path | DTO references |
|---|---|---|---|
| authCredentialList | GET | /auth/credentials | DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE |
| authCredentialAdd | POST | /auth/credentials | DTO-AUTH-003-CREDENTIAL-ADD-REQUEST / DTO-AUTH-003-CREDENTIAL-ADD-RESPONSE |
| authCredentialReplace | PUT | /auth/credentials/{credentialId} | DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST / DTO-AUTH-003-CREDENTIAL-REPLACE-RESPONSE |
| authCredentialRemove | DELETE | /auth/credentials/{credentialId} | DTO-AUTH-003-CREDENTIAL-REMOVE-RESPONSE |

Source: `contracts/api/AUTH-003-credential-management-contract.v1.json`.

## AUTH-004

| operationId | method | path | DTO references |
|---|---|---|---|
| authPasswordChange | POST | /auth/password/change | DTO-AUTH-004-PASSWORD-CHANGE-REQUEST / DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE |
| authPasswordResetRequest | POST | /auth/password/reset/request | DTO-AUTH-004-PASSWORD-RESET-REQUEST |
| authPasswordResetConfirm | POST | /auth/password/reset/confirm | DTO-AUTH-004-PASSWORD-RESET-CONFIRM / DTO-AUTH-004-PASSWORD-RESET-RESPONSE |

Source: `contracts/api/AUTH-004-password-recovery-contract.v1.json`.

## AUTH-005

| operationId | method | path | DTO references |
|---|---|---|---|
| authVerificationRequest | POST | /auth/verification/request | DTO-AUTH-005-VERIFICATION-REQUEST / DTO-AUTH-005-VERIFICATION-RESPONSE |
| authVerificationConfirm | POST | /auth/verification/confirm | DTO-AUTH-005-VERIFICATION-CONFIRM / DTO-AUTH-005-VERIFICATION-RESPONSE |
| authVerificationRevoke | POST | /auth/verification/revoke | DTO-AUTH-005-VERIFICATION-REVOKE / DTO-AUTH-005-VERIFICATION-RESPONSE |

Source: `contracts/api/AUTH-005-identity-verification-contract.v1.json`.

## AUTH-006

The current feature contract uses **passkey assertion** terminology and paths, not the earlier draft `authentication` terminology.

| operationId | method | path | DTO |
|---|---|---|---|
| authPasskeyRegistrationOptions | POST | /auth/passkeys/registration/options | DTO-AUTH-006-REGISTRATION-OPTIONS |
| authPasskeyRegistrationVerify | POST | /auth/passkeys/registration/verify | DTO-AUTH-006-REGISTRATION-VERIFY |
| authPasskeyAssertionOptions | POST | /auth/passkeys/assertion/options | DTO-AUTH-006-ASSERTION-OPTIONS |
| authPasskeyAssertionVerify | POST | /auth/passkeys/assertion/verify | DTO-AUTH-006-ASSERTION-VERIFY |
| authPasskeyRemove | DELETE | /auth/passkeys/{credentialId} | DTO-AUTH-006-REMOVE |

Source: `contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`.

## Schema admission audit

The four feature API contracts identify operation IDs, methods, paths, DTO IDs, authorization rules, and selected security invariants, but they do **not** provide complete OpenAPI request/response schemas for every referenced DTO.

The current canonical OpenAPI document contains concrete inline schemas for the already-admitted Auth operations (`authRegister`, `authLogin`, `authLogout`) but no admitted operation/schema definition for AUTH-003～006.

Therefore the following data is still **UNRESOLVED** and must not be inferred from entity fields, persistence mappings, implementation types, or DTO names alone:

| Feature | Missing canonical inputs |
|---|---|
| AUTH-003 | list/add/replace/remove request and response schemas; `credentialId` parameter schema; exact status/error semantics |
| AUTH-004 | change/reset-request/reset-confirm request and response schemas; exact recovery-token input shape; exact status/error semantics |
| AUTH-005 | verification request/confirm/revoke request and response schemas; exact challenge/token representation; exact status/error semantics |
| AUTH-006 | registration/assertion option and verification schemas; WebAuthn transport/credential representation; exact status/error semantics |

### Non-inference rule

The following are explicitly **not** sufficient to construct a canonical DTO/OpenAPI schema:

- entity field contracts alone;
- persistence mapping rows;
- TypeScript types inferred from implementation;
- Payload-generated types;
- DTO identifier names;
- historical/archived OpenAPI documents;
- example payloads without an approved schema contract;
- implementation behavior not yet bound to a canonical API contract.

## Promotion gate

AUTH-003～006 may enter the canonical OpenAPI/DTO authority chain only after the missing request/response/status/error schemas are explicitly contracted and then represented in OpenAPI.

Required sequence:

1. Freeze each operation's exact request/response contract.
2. Add the exact route, parameters, security, request schema, success response, and canonical error responses to `contracts/openapi/v1/openapi.yaml`.
3. Run OpenAPI structural validation.
4. Update the canonical DTO registry from the validated OpenAPI document.
5. Reconcile AUTH-003～006 persistence Mapping rows to the resulting canonical operation/DTO IDs.
6. Run Mapping-0 and bind the result to the tested commit SHA.

No step may be skipped by copying IDs between contracts.

## Promotion decision for this batch

`NO_OPENAPI_WRITE_YET`

Reason: the authoritative feature contracts currently do not contain enough exact DTO schema material to safely write the missing OpenAPI paths without invention. The next contract-first batch must close DTO schema definitions before modifying the canonical OpenAPI document.

## Promotion blockers

1. The current OpenAPI file has no exact route for these AUTH-003～006 operations.
2. The feature contracts provide DTO IDs but do not provide complete OpenAPI request/response JSON Schemas for every DTO.
3. Therefore the canonical DTO registry cannot yet be populated from OpenAPI without schema invention.
4. Existing persistence Mapping rows containing alternate/legacy DTO IDs remain blocked and must not be renamed solely for equality.
5. AUTH-006 operation naming/path must use the current feature contract's `assertion` terminology unless a separately approved contract change supersedes it.

## Required next evidence

For each operation, before promotion:

- exact request schema or explicit no-body declaration;
- exact success response schema;
- exact response status codes;
- canonical error responses;
- parameter schemas;
- security/authorization metadata;
- idempotency requirements where contracted;
- canonical DTO identity;
- OpenAPI structural validation result;
- Mapping-0 validation after registry integration.

No runtime, D1, migration, security-E2E, concurrency-E2E, or GREEN status is claimed here.
