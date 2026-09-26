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
