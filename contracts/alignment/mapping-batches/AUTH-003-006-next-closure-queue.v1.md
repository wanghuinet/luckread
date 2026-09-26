# AUTH-003–AUTH-006 Next Closure Queue v1

Status: `EXECUTION_QUEUE_FROZEN / AUTH-003 WIRE CLOSED; DOWNSTREAM EVIDENCE PENDING`

## Purpose

Batch the next Mapping-0 closure work for AUTH-003 through AUTH-006 without manufacturing API/DTO semantics. This artifact records the exact closure inputs that must be decided or evidenced before canonical OpenAPI/DTO promotion.

## Authority rule

`DEFINED != MAPPED != IMPLEMENTED != VERIFIED != GREEN`.

Existing feature contracts establish operation identities and security obligations, but unresolved wire schemas must not be inferred from entity fields, persistence mappings, implementation types, generated types, examples, or archived contracts.

## AUTH-003 — Credential Management

### Already established

- Operations: `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove`.
- Routes: `/auth/credentials` and `/auth/credentials/{credentialId}`.
- DTO identifiers are contractually named.
- Self scope and `user.credential.manage` authorization are established.
- Mutating operations require `Idempotency-Key`.
- Credential secret material and normalized values are non-public.

### Closure queue

1. Explicitly approve public projection for `kind`, `active`, `createdAt`, `updatedAt`, and any other allowed metadata.
2. Freeze exact add/replace request fields, types, formats, requiredness, and validation rules.
3. Freeze `credentialId` parameter schema.
4. Freeze list envelope, item projection, ordering, cursor/limit semantics.
5. Freeze success status/body semantics, including remove body vs `204 No Content`.
6. Freeze generic conflict/error semantics without credential enumeration.
7. Only then write OpenAPI schemas and promote DTO registry entries.

## AUTH-004 — Password Change / Recovery

### Already established

- Operations: `authPasswordChange`, `authPasswordResetRequest`, `authPasswordResetConfirm`.
- Change/reset lifecycle is a distinct contract surface.
- Recovery-token lifecycle and session invalidation are downstream closure requirements.

### Closure queue

1. Freeze exact request/response schemas for all three operations.
2. Freeze recovery-token representation and ownership/purpose binding.
3. Freeze expiry, single-use, replay and invalidation semantics.
4. Freeze status/error mapping with enumeration resistance.
5. Bind session invalidation behavior to the approved lifecycle contract.
6. Only then promote OpenAPI/DTO mappings.

## AUTH-005 — Identity Verification

### Already established

- Operations: `authVerificationRequest`, `authVerificationConfirm`, `authVerificationRevoke`.
- Verification challenge lifecycle is a distinct contract surface.

### Closure queue

1. Freeze challenge request/response schemas.
2. Freeze challenge/token representation without exposing secret material.
3. Freeze purpose, account binding, expiry and single-use semantics.
4. Freeze revoke semantics and post-revoke behavior.
5. Freeze wrong-purpose, expired, replay and concurrency error semantics.
6. Only then promote OpenAPI/DTO mappings.

## AUTH-006 — Passkey / WebAuthn

### Already established

- Current contract terminology is `passkey` + `assertion`; do not regress to the earlier draft `authentication` naming.
- Operations: registration options/verify, assertion options/verify, remove.
- RP-ID/origin/challenge and verification are downstream security/persistence concerns.

### Closure queue

1. Freeze exact WebAuthn registration-options schema.
2. Freeze registration verification request/response schema.
3. Freeze assertion-options schema.
4. Freeze assertion-verification request/response schema.
5. Freeze passkey removal parameter/body/status semantics.
6. Freeze RP-ID/origin/challenge representation and secret handling rules.
7. Freeze failure semantics for invalid origin/RP-ID, expired/replayed challenge, and failed assertion.
8. Only then promote OpenAPI/DTO mappings.

## Batch execution order

`AUTH-003 wire projection → AUTH-003 OpenAPI/DTO → AUTH-004 wire contract → AUTH-004 OpenAPI/DTO → AUTH-005 wire contract → AUTH-005 OpenAPI/DTO → AUTH-006 WebAuthn wire contract → AUTH-006 OpenAPI/DTO → Mapping-0 reconciliation`.

The work may be prepared in parallel, but promotion remains per-feature and fail-closed.

## Prohibited shortcuts

- No DTO schema synthesis from entity fields.
- No OpenAPI schema synthesis from DTO identifier names.
- No migration/persistence mapping promotion from physical-name guesses.
- No Evidence Registry IDs created merely to satisfy mapping rows.
- No GREEN status until executable evidence is bound to the tested commit SHA.

## Current batch disposition

`AUTH-003: WIRE_SCHEMA_CLOSED / RUNTIME_PERSISTENCE_BLOCKED`

`AUTH-004: BLOCKED_ON_EXPLICIT_WIRE_CONTRACT`

`AUTH-005: BLOCKED_ON_EXPLICIT_WIRE_CONTRACT`

`AUTH-006: BLOCKED_ON_EXPLICIT_WEBAUTHN_WIRE_CONTRACT`

`Mapping-0: BLOCKED_UNTIL_CANONICAL_DTO_AND_OPENAPI_INPUTS_EXIST`

## Next concrete action

Resolve the smallest authoritative decision set for AUTH-003 first. Do not modify canonical OpenAPI until the exact public wire projection and status/error semantics are explicitly contracted.

## 2026-09-26 AUTH-003 wire closure

The explicit public wire-schema authority has been accepted and encoded in the canonical API contract, OpenAPI, API Inventory source and DTO registry. The remaining AUTH-003 blockers are D1 persistence, runtime implementation, normalization/uniqueness execution evidence, security-E2E evidence, durable Evidence Registry binding and final Mapping-0 reconciliation.
