# Change Control — AUTH-002 / AUTH-011 E6 Wire Authority Decision v1

- ID: CC-MAPPING-0-AUTH-002-E6-WIRE-AUTHORITY-DECISION-2026-09-21
- Status: GREEN — RECONCILIATION ADMITTED
- Scope: Contract-First wire/input authority only
- Parent: CC-MAPPING-0-AUTH-002-E6-WIRE-INPUT-GAPS-2026-09-21

## Decision basis

This decision closes only the previously identified E6 contract-input gaps. It does not authorize runtime implementation, migration changes, new D1 domains, new entities, or new Workers.

The decision reuses the already-established Auth response token vocabulary, common ErrorResponse/ErrorCode contract, AUTH-011 rotation/reuse invariants, and the existing ENT-SESSION single-authority model.

## Decision 1 — authRefresh public Wire Authority

Canonical operation:
- operationId: authRefresh
- method/path: POST /auth/refresh
- contract status: CONTRACTED_PARTIAL

Request DTO:
- DTO-AUTH-REFRESH-REQUEST
- media type: application/json
- required body field: refreshToken: string
- additionalProperties: false

Response DTO:
- DTO-AUTH-REFRESH-RESPONSE
- HTTP 200
- media type: application/json
- fields: accessToken: string, refreshToken: string, expiresIn: integer, layer: string matching ^L[0-8]$

Error authority:
- HTTP 401 uses the existing ErrorResponse schema with error.code = UNAUTHENTICATED for expired, revoked, invalid, or reused refresh credentials.
- HTTP 429 uses the existing RateLimited response/ErrorResponse.
- No refresh-specific error enum is introduced.
- Public error responses MUST NOT reveal whether a session existed, whether a predecessor was previously valid, or which internal validation failed.

Credential carrier:
- The refresh credential is carried only in the JSON request body field refreshToken.
- No Authorization bearer token, cookie, custom refresh header, or alternate carrier is canonical for authRefresh.
- Successful rotation returns the successor refreshToken in the 200 response; the predecessor becomes invalid according to the existing AUTH-011 rotation rules.
- Raw refresh credentials MUST NOT be logged or persisted.

Route authority:
- The existing /auth/refresh Discovery Draft is promoted to the canonical contract by this Change Control.
- No alternate refresh route is introduced.

## Decision 2 — AUTH-002 device binding input authority

Canonical login/refresh input:
- authLogin request adds required deviceId: string.
- authRefresh request requires deviceId: string.
- deviceId is an opaque client-generated identifier and is treated only as a privacy-safe device reference.
- The server binds the supplied deviceId to the native Payload sid in auth_session_state.device_id.
- deviceId is not an authentication secret, authorization role, entitlement, or account identifier.
- The server MUST NOT derive deviceId from IP, User-Agent, fingerprinting, cookies, geolocation, advertising identifiers, hardware serials, or other uncontracted request/device signals.
- The same bound deviceId is required for refresh validation of that session.
- The deviceId value is not required to be returned in authLogin/authRefresh token responses.
- No ENT-DEVICE-RECORD is introduced.

## Non-goals and prohibitions

- No new Worker.
- No new D1 database/domain.
- No parallel Session entity/table.
- No duplicate session identity.
- No raw credential persistence.
- No runtime handler implementation is admitted by this decision alone.
- E6 runtime admission remains subject to the existing implementation Change Control and executable evidence gates.

## Reconciliation obligations

After this decision is committed:
1. Reconcile the canonical OpenAPI authRefresh operation and authLogin request.
2. Bind DTO-AUTH-REFRESH-REQUEST and DTO-AUTH-REFRESH-RESPONSE in the canonical DTO registry.
3. Update the E6 wire-gap control to PASS_VERIFIED.
4. Re-run Contract CI and AUTH-011 wire consistency audit.
5. Only if those gates pass, re-evaluate E6 runtime implementation admission.

## Decision record

Decision owner: LuckRead project review/acceptance process.
Decision type: Contract authority selection, not runtime authorization.
Effective source: this Change Control plus the reconciled canonical Contract files.
