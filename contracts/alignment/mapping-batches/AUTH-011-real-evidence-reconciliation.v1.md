# AUTH-011 Real Evidence Reconciliation v1.0

- Feature: `AUTH-011`
- Name: token lifecycle and rotation
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- API authority: `contracts/api/api-inventory.v1.json`, `contracts/api/auth-operation-policy.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Account-state authority: `contracts/state-machines/account.json`, `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- Security/cache authority: `docs/302-AUTHORIZATION-CACHE-SECURITY-CONTRACT-v1.0.md`, `contracts/authz/authz-cache-invariant.json`, `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`

## 1. Canonical feature scope

AUTH-011 is frozen as:

`Identity / Auth / Account` → `Token security` → `Token lifecycle` → `Issue/rotate/revoke` → `Maintain a valid authenticated session` → `Issue, rotate, revoke and reject invalid or reused session credentials`.

The canonical requirement is that rotation/revocation dominate stale credentials and that replay/reuse be detectable.

## 2. Confirmed API contract evidence

The auth operation policy defines:

- `authRefresh`: `POST /auth/refresh`, capability `token_refresh`.
- Authentication mode: `refresh_credential`, subject `session`.
- Authorization: required, permission `user.session.refresh`, scope `self`.
- Resource budget: one authoritative D1 read and one authoritative D1 write; no RPC/outbound call.
- Cache: `NO_STORE`.
- Retry: one attempt; client retry is not considered safe.
- Anti-abuse: required at session/account/device/endpoint scope.
- Security requirements: refresh-token rotation, reuse detection, revoked-session denial, and invalidation of the old refresh credential.

The operation remains `CONTRACTED_PARTIAL` and its policy evidence marks OpenAPI, permission, state, anti-abuse, integration, and security-E2E evidence as missing.

The API inventory includes `POST /v1/auth/refresh` as a required authentication endpoint group. The canonical OpenAPI document contains a `/auth/refresh` shell with `operationId: authRefresh`, but it is explicitly `DISCOVERY_DRAFT`, has a discovery-only summary, and does not define the concrete request/success/error Wire Schema. The `/v1` prefix versus `/auth/refresh` operation-relative representation is already reconciled by `M0-B01-API-PATH-NORMALIZATION-AUDIT-2026-09-20`; it is not an active E6 blocker.

## 3. Confirmed session/token security evidence

The identity/session instance registry defines:

- `device-session-issue-01`: authenticated actor receives a scoped session with expiry.
- `refresh-credential-issue-01`: refresh credential is tied to a session, has expiry, and its secret is not logged.
- `refresh-credential-rotate-01`: old credential is rejected, new credential is valid, and replay is blocked.
- `session-expire-01`: expired sessions are rejected and refresh follows policy.
- `session-revoke-01`: revoked sessions are rejected and the action is audited.

The authorization cache contract establishes `session_id` and `token_version` as security-principal dimensions and states that logout/password change/token revocation/session invalidation increments `token_version`. Revoked credentials/session validity must never be treated as a cache authorization truth.

The threat model requires short-lived tokens, refresh-token rotation, device binding, and invalidation through `token_version`; it also prohibits tokens from URLs, logs, and Referer values.

## 4. Entity and persistence evidence

The canonical entity catalog currently marks:

- `ENT-SESSION`: `PROPOSED`.
- `ENT-CREDENTIAL`: `PROPOSED`.
- `ENT-DEVICE-RECORD`: `PROPOSED`.

The entity-field contract has no canonical field definitions for these entities. The entity implementation-evidence registry records them as `CONTRACT_ONLY` / `BLOCKED`, with no implementation or schema evidence. The database persistence inventory likewise provides no verified persistence mapping for these entities.

Therefore the following must **not** be inferred as canonical:

- refresh-token field ID;
- access-token field ID;
- token hash/digest field ID;
- token family / rotation lineage field ID;
- refresh-token issued/expiry/revoked/reused timestamps or flags;
- session-to-user and session-to-device relation field IDs;
- token version field ID at Session versus User level;
- concrete D1 table/column names;
- Payload-generated authentication/session tables.

## 5. Runtime/code evidence

Repository searches for `authRefresh`, refresh-token handlers, refresh-token storage, rotation logic, token-version enforcement, reuse detection, and session refresh runtime did not identify a concrete executable implementation that can be promoted to canonical AUTH-011 evidence.

The repository contains contract and policy references, but those do not prove an executable handler → token validation → authoritative session lookup → state/version check → rotation transaction → old-token invalidation → response DTO chain.

Payload login behavior is not accepted as proof of the separately inventoried `authRefresh` contract unless a canonical mapping explicitly binds the runtime behavior to that operation and supplies the required evidence.

## 6. State/lifecycle reconciliation

The account state machine declares `SUSPENDED`, `BANNED`, `DELETION_PENDING`, and `DELETED` as token-invalidation states. The identity lifecycle contract also binds session behavior to account state and token versioning.

However, no canonical AUTH-011 state/transition IDs have been bound to the refresh operation. The following lifecycle cases therefore remain evidence gaps:

- refresh accepted for an active session;
- refresh denied for expired session;
- refresh denied for revoked session;
- refresh denied after account suspension/ban/deletion-pending;
- old refresh credential rejected after successful rotation;
- reused refresh credential detected and handled according to policy;
- token-version mismatch rejected;
- concurrent refresh requests cannot both create valid successors from the same old credential unless an explicit contract permits it.

## 7. DTO/OpenAPI evidence gaps

Missing or unresolved canonical mappings include:

- request DTO ID for `authRefresh`;
- response DTO ID containing new access/refresh credentials and expiry metadata;
- canonical error DTOs for expired/revoked/reused credentials;
- explicit OpenAPI `authRefresh` operation definition;
- exact request credential carrier semantics;
- exact response credential exposure rules;
- correlation between login-issued refresh credential and refresh endpoint.

The existing OpenAPI `authLogin` response contains `accessToken`, `refreshToken`, `expiresIn`, and `layer`, but this does not by itself establish the separate refresh operation contract.

## 8. Test and evidence gaps

Required production-green evidence remains missing for at least:

- valid refresh succeeds;
- expired refresh credential rejected;
- revoked session rejected;
- old refresh credential invalid after rotation;
- replay/reuse detection;
- concurrent refresh race protection;
- token-version mismatch;
- account suspension/ban invalidates refresh;
- logout/revoke dominates refresh;
- refresh credentials are absent from logs/telemetry/URLs;
- cross-account/session substitution rejected;
- device/session binding enforcement where required;
- integration/E2E execution against authoritative persistence;
- security-E2E execution;
- Evidence Registry IDs tied to executed results and commit SHA.

No current repository evidence establishes a passing test execution for these cases.

## 9. GREEN decision

`AUTH-011 = BLOCKED_NOT_GREEN`.

The feature remains implementation-blocked. No Worker/runtime implementation should be authorized from this reconciliation record alone.

Promotion to GREEN requires bidirectional completion of:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 10. Closure criteria

AUTH-011 may transition to GREEN only after all of the following are evidence-bound and validated without inventing identifiers:

1. `authRefresh` uses the already-reconciled API path/base-path representation (`/v1/...` inventory versus `/api/v1` OpenAPI server plus `/auth/...` operation path).
2. Request/response/error DTOs are canonical and mapped.
3. `ENT-SESSION` / `ENT-CREDENTIAL` / `ENT-DEVICE-RECORD` fields and persistence authority are explicitly established.
4. Refresh-token storage uses the canonical secret-protection contract and does not persist or log raw refresh secrets contrary to policy.
5. Rotation semantics define old-token invalidation, successor issuance, reuse detection, and concurrency behavior.
6. Session/account state and `token_version` invalidation are explicitly bound to the refresh decision.
7. Runtime code implements the frozen chain with authoritative reads/writes within the declared resource budget.
8. Positive, negative, replay, revocation, concurrency, state-transition, and security E2E tests execute successfully.
9. Non-empty canonical Evidence Registry entries are bound to actual execution artifacts and commit SHA.
10. Mapping 0 validator changes AUTH-011 from `PARTIAL` to `GREEN` only after every required gate passes.

## 6C. API path/base-path sub-gate — PASS_VERIFIED

`M0-B01-API-PATH-NORMALIZATION-AUDIT-2026-09-20` establishes the representation rule:

`API Inventory /v1/auth/refresh` = canonical public API inventory representation;
`OpenAPI server /api/v1 + path /auth/refresh` = transport representation;
`Auth operation policy /auth/refresh` = operation-relative representation.

Therefore API path normalization is no longer an AUTH-011 blocker. E6-WIRE-001 remains blocked only by the uncontracted exact Request/Response/Error Wire Schema, DTO binding, credential-carrier semantics, and route admission.