# Batch 01 — Foundation + Identity Implementation Plan v1.0

**Status:** ACTIVE
**Source of truth:** `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
**Scope:** Foundation, identity, account lifecycle, user profile and authorization primitives.

## 1. Feature set

### P0 Identity
- AUTH-001 registration
- AUTH-002 login/logout
- AUTH-003 username/email/phone credentials
- AUTH-004 password reset/change
- AUTH-005 email/phone verification
- AUTH-010 session/device management
- AUTH-011 token lifecycle and rotation
- AUTH-013 account freeze/suspension/ban
- AUTH-014 account recovery
- AUTH-015 account deletion/restoration policy

### P0 User
- USER-001 profile
- USER-002 avatar/banner/bio/display name
- USER-003 locale/language/timezone
- USER-004 interests/preferences
- USER-005 privacy settings
- USER-006 blocked/muted users
- USER-007 history/activity foundation
- USER-010 data export/deletion boundary

### P0 Authorization
- AUTHZ-001 roles
- AUTHZ-002 permissions
- AUTHZ-003 entitlement model
- AUTHZ-005 resource ownership
- AUTHZ-006 organization/team scope primitive
- AUTHZ-007 API/OAuth scopes
- AUTHZ-010 authorization audit

## 2. Canonical boundaries

Public clients use versioned DTOs and canonical `/v1/*` APIs. Payload document shape is an implementation detail and must not become the public application contract.

Foundation endpoints:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/password/forgot`
- `POST /v1/auth/password/reset`
- `POST /v1/auth/verification/request`
- `POST /v1/auth/verification/confirm`
- `GET /v1/me`
- `PATCH /v1/me`
- `GET /v1/me/sessions`
- `DELETE /v1/me/sessions/:sessionId`
- `POST /v1/me/export`
- `POST /v1/me/deletion`

## 3. Account invariants

1. User ID is immutable and authoritative across all domains.
2. Username is unique and race-safe.
3. Authentication secrets are never returned by profile APIs.
4. Verification state cannot be changed by generic profile updates.
5. Role/status changes require privileged authorization and audit records.
6. Suspended/banned accounts cannot perform protected mutations.
7. Password reset and verification tokens are single-purpose, time-bounded and non-reusable.
8. Session revocation is authoritative and must invalidate protected access according to the token/session strategy.
9. Account deletion is an explicit lifecycle transition; destructive data handling follows retention/privacy policy.
10. Authorization decisions are server-side and cannot depend on client-supplied role claims.

## 4. User profile contract

Editable in the normal self-service path:

- username, subject to uniqueness/policy
- display name
- bio
- avatar/banner references
- locale
- timezone
- interests/preferences
- privacy settings

Never directly editable through the generic profile endpoint:

- id
- role
- status
- verified state
- security credentials
- audit timestamps

## 5. Security requirements

- Rate-limit registration, login, verification and recovery flows.
- Prevent account enumeration where practical.
- Never log plaintext passwords, recovery secrets or verification codes.
- Apply secure cookie/token handling appropriate to the selected session strategy.
- Record security-sensitive account events in an audit trail.
- Enforce authorization on the server for every privileged operation.
- Keep downstream creator, MCN, monetization and social permissions out of the basic registration flow.

## 6. Client contract

Web/H5, Android, iOS and Mini Program clients consume the same canonical identity API. Client-specific UI may differ; identity semantics may not.

Registration logical journey:

`Register → Phone/Email → Verification → Password → Username → Age eligibility → Terms/Privacy → Optional interests → Complete → Home`

The exact screen composition may vary, but required security and consent checkpoints cannot be removed.

## 7. Implementation strategy

1. Reuse existing Payload User/auth implementation where it satisfies this contract.
2. Refactor partial or duplicated identity logic instead of adding parallel systems.
3. Add missing application-level DTO/API boundaries outside Payload Core.
4. Add tests for invariants before declaring the feature implemented.
5. Update blueprint status only after implementation evidence exists.
6. Do not begin Batch 02 until Batch 01's implementation evidence is recorded.

## 8. Definition of done

Batch 01 is complete only when:

- all listed P0 features have an implementation or an explicitly documented, accepted deferral;
- canonical APIs have stable request/response/error semantics;
- authorization and account lifecycle invariants are tested;
- security-sensitive flows have rate-limit and audit coverage;
- Web/H5 canonical behavior is established for the foundation;
- CI/build/typecheck/tests pass for the changed scope;
- implementation evidence is linked from the batch status record;
- no feature is silently added outside the v2.0 blueprint.
