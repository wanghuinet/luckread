# AUTH-003～AUTH-006 DTO Schema Closure Gate v1

## Status

`BLOCKED_NOT_GREEN`

## Purpose

Freeze the exact schema material required before AUTH-003～AUTH-006 can enter the canonical OpenAPI and DTO registry chain. This gate prevents DTO identifiers, entity fields, implementation types, or persistence rows from being promoted as public API schemas without explicit contract evidence.

## Authority chain

`Blueprint / Feature Contract`
→ `Canonical API Operation`
→ `Exact Request / Response Schema`
→ `OpenAPI`
→ `Canonical DTO Registry`
→ `Persistence Mapping`
→ `Runtime`
→ `Evidence Registry`
→ `Mapping-0`

`DEFINED`, `CONTRACTED`, `MAPPED`, `IMPLEMENTED`, `VERIFIED`, and `GREEN` remain distinct states.

## Current evidence finding

The AUTH-003 feature contract plus the PASS_VERIFIED wire-projection authority now have corresponding concrete request/response/parameter schemas in `contracts/openapi/v1/openapi.yaml`. API Contract CI has validated the current surface. AUTH-004～AUTH-006 remain blocked under the same combined gate.

The persistence mapping already contains references to several AUTH-003～AUTH-006 DTO identifiers, but persistence mappings are not public API authority and must not be used to synthesize schemas.

## Required schema closure matrix

| Feature | Operation set | Required schema closure | Current state |
|---|---|---|---|
| AUTH-003 | `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove` | list response; add request/response; replace request/response; remove 204 no-body; `credentialId` parameter; exact status/error semantics; security/idempotency representation | `PASS_VERIFIED` |
| AUTH-004 | `authPasswordChange`, `authPasswordResetRequest`, `authPasswordResetConfirm` | change request/response; reset request shape; reset-confirm request/response; recovery-token representation; exact status/error semantics | `BLOCKED` |
| AUTH-005 | `authVerificationRequest`, `authVerificationConfirm`, `authVerificationRevoke` | request/response schema for each operation; challenge/token representation; exact status/error semantics; lifecycle result representation | `BLOCKED` |
| AUTH-006 | `authPasskeyRegistrationOptions`, `authPasskeyRegistrationVerify`, `authPasskeyAssertionOptions`, `authPasskeyAssertionVerify`, `authPasskeyRemove` | registration/assertion option schemas; verification request/response schemas; WebAuthn credential/challenge representation; `credentialId` path parameter; exact status/error semantics | `BLOCKED` |

## Operation-level rules

### AUTH-003

Canonical feature operations are defined in `contracts/api/AUTH-003-credential-management-contract.v1.json`. The contract establishes the credential management operation set, self-scoped authorization, required idempotency for mutating operations, normalization rules, uniqueness rules, and projection/security invariants.

The exact AUTH-003 wire schema is now encoded and validated. It includes the canonical cursor envelope, public credential projection `credentialId/kind/active`, add request `kind/value`, replace request `value`, immutable credential kind, `credentialId` path parameter, explicit 201/200/204 success semantics, canonical 401/403/404/409/422/429 errors, and required idempotency metadata. Credential secret values, normalized values, and credential hashes remain non-public.

### AUTH-004

Canonical feature operations are defined in `contracts/api/AUTH-004-password-recovery-contract.v1.json`. The contract establishes authenticated password change versus anonymous recovery request versus token-bound recovery confirmation, along with single-use/time-bound/purpose-bound rules and session invalidation obligations.

Before OpenAPI promotion, the exact wire contract must explicitly define:

- password-change request/response;
- reset-request request/response;
- reset-confirm request/response;
- recovery token field name, format, and requiredness;
- exact client-error statuses and canonical error envelope references;
- explicit no-secret-return invariant in response schemas.

The raw password and raw recovery token must not appear in response schemas.

### AUTH-005

Canonical feature operations are defined in `contracts/api/AUTH-005-identity-verification-contract.v1.json`. The contract establishes verification request, confirmation, and revoke operations, challenge/token lifecycle, and single-use concurrency semantics.

Before OpenAPI promotion, the exact wire contract must explicitly define:

- verification request input fields and response;
- verification confirmation input fields and response;
- revoke input fields and response;
- exact challenge identifier and token representation;
- exact status/error semantics;
- whether any operation has an explicit no-body response;
- response projection rules that prevent credential/account disclosure.

### AUTH-006

Canonical feature operations are defined in `contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`. The canonical terminology is `assertion`, not the earlier draft `authentication` wording.

Before OpenAPI promotion, the exact wire contract must explicitly define:

- registration options response;
- registration verification request/response;
- assertion options request/response;
- assertion verification request/response;
- passkey removal parameter and response;
- challenge representation;
- credential ID/public-key/transport/counter representation as actually exposed on the wire;
- exact status/error semantics;
- authority/configuration fields that are server-derived rather than client-controlled.

The private key must never be represented as an accepted request field or persisted response field.

## Canonical error contract gate

Every promoted operation must reference the repository's canonical error response contract rather than introduce feature-local error shapes without authority. The exact response status set must be explicitly contracted per operation; `4XX` catch-all descriptions do not substitute for operation-specific status semantics where the feature contract requires security-sensitive distinctions.

## No-inference rules

The following sources cannot, by themselves, create or complete a canonical DTO schema:

1. DTO identifier names;
2. entity field contracts;
3. persistence mapping rows;
4. generated TypeScript types;
5. Payload-generated types;
6. implementation behavior;
7. examples without an approved schema contract;
8. archived contracts or historical OpenAPI;
9. assumptions about common WebAuthn or password-reset payload shapes.

## Promotion gate

A DTO may be admitted to `contracts/dto/auth-dto-contract.v1.json` only when:

1. its operation has an authoritative API definition;
2. the request/response schema is explicit;
3. parameter and no-body semantics are explicit;
4. success status is explicit;
5. canonical error responses are explicit;
6. security/idempotency metadata is represented;
7. the exact route is represented in `contracts/openapi/v1/openapi.yaml`;
8. OpenAPI validation succeeds;
9. Mapping-0 subsequently resolves the operation and DTO references without inference.

## Decision

`AUTH-003 DTO_SCHEMA_CLOSED / OPENAPI_ENCODED / PASS_VERIFIED`

AUTH-004～AUTH-006 remain `NO_DTO_PROMOTION_YET`. No runtime or GREEN claim follows from this schema closure.

## Next executable contract batch

Next executable batch after this AUTH-003 closure is downstream reconciliation: confirm canonical DTO refs in persistence Mapping, then implement/evidence credential-list. Replace/Remove remain later lifecycle slices.

## Evidence boundary

This document is contractual/audit evidence only. It does not claim runtime, D1, migration, security-E2E, concurrency-E2E, OpenAPI validation success, Evidence Registry binding, or GREEN status.
