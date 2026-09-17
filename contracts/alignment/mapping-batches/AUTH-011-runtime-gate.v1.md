# AUTH-011 Refresh Runtime Gate v1.0

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Frozen operation

- feature: `AUTH-011`
- operation: `authRefresh`
- method/path: `POST /auth/refresh`
- authentication mode: refresh credential
- subject: session
- permission: `user.session.refresh`

## Required contract chain

`OpenAPI -> Request DTO -> Response DTO -> ENT-SESSION/credential fields -> persistence authority -> refresh rotation handler -> reuse detection -> token-version/session enforcement -> security E2E -> Evidence Registry`

## Current evidence

Repository reconciliation records that `authRefresh` exists in the canonical API inventory and is associated with `user.session.refresh`, but no executable refresh handler/storage/rotation chain has been accepted as canonical evidence. AUTH-011 therefore remains PARTIAL.

## Security invariants

1. Refresh credentials are never returned or persisted in raw form.
2. Refresh rotation must be atomic with respect to the authoritative session state.
3. Reuse of an invalidated refresh credential must not silently mint another valid session.
4. Token/session version invalidation must dominate stale credentials.
5. Refresh must remain bound to the authenticated session/device model where the canonical credential contract requires it.
6. Cross-account/session confusion must fail closed.

## Dependency on AUTH-010

AUTH-011 consumes the canonical `ENT-SESSION` model and must not redefine session identity, native `createdAt`, native `expiresAt`, or extension ownership. Session revocation semantics must be compatible with AUTH-010 and AUTH-002.

## Implementation gate

Before runtime implementation is promoted:

- canonical OpenAPI path and DTO refs must resolve;
- credential/session field authority must be explicit;
- migration/schema evidence must exist;
- rotation/reuse detection tests must execute;
- security E2E evidence must be recorded;
- Evidence Registry must contain non-empty execution-backed evidence.

No PASS/green state is permitted from static contract presence alone.
