# CC-MAPPING-0-AUTH-004-WIRE-SCHEMA-DECISION-REQUIRED-2026-09-26

- Feature: `AUTH-004`
- Scope: password change / password reset request / password reset confirm
- Status: `DECISION_REQUIRED`
- Implementation authorization: `false`
- OpenAPI promotion: `false`
- DTO registry promotion: `false`
- Runtime admission: `false`
- Evidence admission: `false`
- Mapping-0 GREEN: `false`

## 1. Purpose

Record the current AUTH-004 wire-schema decision boundary without inventing request/response fields from persistence names, historical routes, neighboring APIs, or generic conventions.

This is decision material only. It does not freeze a public wire schema and does not authorize implementation.

## 2. Established authority

The following inputs are already resolved and remain authoritative:

- Canonical operations:
  - `authPasswordChange` — `POST /auth/password/change`
  - `authPasswordResetRequest` — `POST /auth/password/reset/request`
  - `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`
- Canonical DTO vocabulary:
  - `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
  - `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
  - `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
  - `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
  - `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`
- Authorization:
  - password change: authenticated self + `user.credential.manage`
  - reset request: anonymous
  - reset confirm: anonymous + `recovery_token` + token-bound
- Security lifecycle:
  - single-use, time-bound, purpose-bound recovery token
  - raw recovery token never persisted or logged
  - password material never returned or logged
  - successful change/reset revokes affected sessions
  - account enumeration resistance
  - cross-account change denied
  - replay denied
- Platform error envelope and common mutation/idempotency rules remain inherited cross-cutting constraints.

## 3. Decision outcome

The inspected current repository contains no authoritative current API source that freezes the exact public field names, formats, requiredness/nullability, success bodies/statuses, or feature-specific error mappings for the three AUTH-004 operations.

Repository search did not establish an authoritative current definition for:

- a `currentPassword` request field;
- a `newPassword` request field;
- an account/recovery identifier field name;
- a `recoveryToken` public input field;
- success status/body semantics;
- feature-specific idempotency semantics.

The existing AUTH-004 field contract defines persistence/security fields such as `recoveryId`, `identityId`, `tokenHash`, `issuedAt`, `expiresAt`, `consumedAt`, `invalidatedAt`, and `passwordHash`. These remain persistence authority and are not public wire authority.

Historical foundation routes `/v1/auth/password/forgot` and `/v1/auth/password/reset` do not supply an admitted current DTO schema.

Existing `/account/password/change` and `/account/recovery` OpenAPI discovery shells are explicitly non-canonical discovery inputs and do not supply an admitted AUTH-004 wire schema.

## 4. Explicit non-inferences

The following MUST NOT be inferred or promoted:

1. `currentPassword` from the operation name.
2. `newPassword` from the operation name.
3. An identifier field name from historical route naming.
4. `recoveryToken` from persistence `tokenHash`.
5. HTTP success status from neighboring AUTH operations.
6. A response body from persistence-side effects such as session invalidation.
7. A feature-specific idempotency rule unless an authoritative decision establishes it.

## 5. Required authority decision

A future authoritative API decision must freeze, for each operation:

### `authPasswordChange`

- exact request field names;
- field types / accepted formats;
- requiredness / nullability;
- current-password semantics;
- new-password semantics and password-policy reference;
- success HTTP status;
- success body or no-body;
- exact generic error/status mapping;
- idempotency interaction.

### `authPasswordResetRequest`

- exact account/recovery identifier field;
- accepted identifier formats;
- requiredness / nullability;
- enumeration-resistant success semantics;
- success HTTP status;
- success body or no-body;
- public/private recovery-delivery metadata boundary;
- rate-limit / retry reference;
- exact generic error/status mapping.

### `authPasswordResetConfirm`

- exact recovery-token input field and representation;
- exact new-password field and policy reference;
- requiredness / nullability;
- success HTTP status;
- success body or no-body;
- expired/replayed/wrong-purpose generic failure mapping;
- public representation of session invalidation, if any;
- wire-level idempotency/replay semantics.

## 6. Gate effect

Until the above decision is explicitly approved:

- do not modify canonical OpenAPI for AUTH-004;
- do not add AUTH-004 DTO registry records;
- do not change persistence mappings to make stale aliases canonical;
- do not authorize runtime implementation;
- do not register Runtime/Evidence PASS claims for AUTH-004;
- do not mark AUTH-004 or Mapping-0 GREEN.

## 7. Provenance

- Source head reviewed: `8f63b12a130ba475f131a643436202b68fdb9773`
- Existing wire-input audit: `artifacts/mapping-0/auth-004-wire-schema-input-audit-2026-09-26.json`
- Existing wire gate: `contracts/alignment/mapping-batches/AUTH-004-wire-projection-decision-gate.v1.md`
- Backup branch: `backup/main-before-auth004-wire-schema-decision-required-20260926`

## 8. Result

`AUTH-004 = BLOCKED_DECISION_REQUIRED`

This record closes the provenance/decision boundary only. It does not close the wire schema.


## 9. Cross-cutting public-wire inheritance reconciliation — 2026-09-26

Two current platform contracts are authoritative cross-cutting inputs for AUTH-004, but neither supplies feature-specific field names or success/error HTTP mappings.

### 9.1 Unified error envelope

From `docs/166-UNIFIED-ERROR-AND-STATE-TAXONOMY-CONTRACT-v1.0.md`:

Every external error uses the stable envelope:

- `requestId`
- `code`
- `category`
- `severity`
- `message`
- `userSafeReason`
- `retryable`
- `retryAfter`
- `operationId` (nullable)
- `detailsRef` (nullable)

AUTH-004 therefore MUST use the platform error envelope and public error vocabulary. Password/reset secrets, private resource existence in enumeration-sensitive flows, and internal security/infrastructure information remain non-public.

This freezes the **envelope and cross-cutting semantics**, not the AUTH-004-specific mapping of individual failures to HTTP statuses/codes.

### 9.2 Idempotency-Key representation

From `contracts/schemas/common/idempotency-key.json`:

When an operation contract requires an Idempotency-Key, the public header value is:

- header: `Idempotency-Key`
- type: string
- minimum length: 16
- maximum length: 255
- pattern: `^[A-Za-z0-9_-]+$`

The common semantic is:

- same key + same payload MUST return the first response;
- same key + different payload MUST produce `IDEMPOTENCY_KEY_REUSE_CONFLICT`.

Retention is 24 hours under the common schema.

The common contract does **not** establish that every AUTH-004 operation requires the header. Whether the header is mandatory for each of the three AUTH-004 operations remains a feature-specific authority decision.

### 9.4 Lifecycle/security inheritance

From `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`, AUTH-004 may inherit the following lifecycle/security constraints as authority inputs:

- current-credential verification is rate-limited;
- password-reset requests create a durable operation/token boundary and do not reveal account existence;
- password-reset requests are rate-limited;
- reset tokens expire and are stored safely without raw-token logging;
- expired or wrong-use reset tokens are rejected;
- reset-token consumption is single-use and concurrent double-consumption is denied;
- password replacement invalidates the old credential and keeps secret material out of telemetry.

These constraints do not determine public request field names, token wire format, HTTP status/body, per-error code mapping, delivery metadata, or per-operation Idempotency-Key requirements. They therefore reduce the unresolved authority set without closing the feature-specific wire schema.

### 9.3 Observability inheritance

The Unified Error/State contract requires external errors to remain correlatable through `requestId`, `correlationId`, `traceId`, and `operationId` where applicable. These are cross-cutting observability constraints and do not define additional AUTH-004 business fields.

## 10.1 Lifecycle reconciliation result

The L5/L6 registry is now an explicit supporting authority for lifecycle/security behavior. Its rate-limit and token-lifecycle claims are admitted as constraints; no numeric rate limit, anti-abuse scope/action, public response field, or HTTP mapping is inferred from them.

## 10. Remaining AUTH-004 wire decisions

After this source-only reconciliation, the unresolved feature-specific wire inputs are limited to:

- exact request field names/types/formats;
- requiredness/nullability;
- password-policy reference and validation semantics;
- recovery identifier and token public representations;
- success status/body for each operation;
- per-error HTTP/code mapping;
- whether each operation requires `Idempotency-Key`;
- if required, the exact operation-specific replay outcome beyond the common key semantic;
- public recovery-delivery metadata;
- public session-invalidation result, if any.

No feature-specific value is inferred by this reconciliation.

## 11. Result

`AUTH-004 COMMON WIRE INHERITANCE = PASS_VERIFIED_SOURCE_ONLY`

`AUTH-004 FEATURE-SPECIFIC WIRE SCHEMA = DECISION_REQUIRED`
