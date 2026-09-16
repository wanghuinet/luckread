# AUTH-002 — Session Authentication Real-Evidence Reconciliation v1.0

## Status

`BLOCKED_NOT_GREEN`

## Scope

Canonical feature: `AUTH-002` — login / logout.

Canonical operations currently evidenced by repository contracts:
- `authLogin` — `POST /auth/login`
- `authLogout` — `POST /auth/logout`

## Evidence-supported facts

1. `contracts/openapi/v1/openapi.yaml` defines `authLogin` with request fields `identity` and `credential`, and a 200 response containing `accessToken`, `refreshToken`, `expiresIn`, and `layer`.
2. `contracts/openapi/v1/openapi.yaml` defines `authLogout` as a 204 no-body operation.
3. `contracts/api/auth-operation-policy.v1.json` defines anti-abuse, account-state evaluation, refresh rotation requirements for login, and current-user/self-scope plus idempotent revocation requirements for logout.
4. `contracts/dto/auth-dto-contract.v1.json` canonically binds `authLogin` to `DTO-AUTH-LOGIN-REQUEST` and `DTO-AUTH-LOGIN-RESPONSE`.
5. `contracts/dto/auth-dto-records.v1.json` records those login DTO schema references. `authLogout` is explicitly recorded as a no-body operation.
6. `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md` provides L5/L6 validation claims for session creation, refresh rotation, session revocation, concurrent-session policy, session listing, device binding, expiry, login events, and compromised-session revocation.
7. `contracts/entity/entity-catalog.v1.json` currently marks `ENT-SESSION` as `PROPOSED`; no verified field set or implementation reference exists for it.
8. `contracts/entity/entity-field-contract.v1.json` contains no canonical field set for `ENT-SESSION`.
9. `contracts/alignment/database-entity-persistence-inventory.v1.json` contains no verified session persistence record.
10. Repository search does not establish executable handlers bound to `authLogin` / `authLogout`, nor verified session persistence or migration evidence.

## Mapping decision

Evidence-backed links may be retained:

- `AUTH-002 -> authLogin`
- `AUTH-002 -> authLogout`
- `AUTH-002 -> DTO-AUTH-LOGIN-REQUEST`
- `AUTH-002 -> DTO-AUTH-LOGIN-RESPONSE`
- `AUTH-002 -> L5/L6 session validation claims in docs/184-*`

The following remain unresolved and blocking:

- canonical `ENT-SESSION` promotion from PROPOSED to VERIFIED;
- canonical session field IDs and field semantics;
- login response/token-to-session persistence mapping;
- logout revocation persistence mapping;
- authoritative D1 table/column/migration evidence;
- executable `authLogin` handler binding;
- executable `authLogout` handler binding;
- account-state enforcement evidence at runtime;
- token invalidation / refresh rotation evidence;
- anti-abuse executable evidence;
- integration, concurrency and security-E2E evidence;
- Evidence Registry records bound to executed verification results.

## Security boundary

Credentials and session secrets must not become public DTO fields, logs, analytics payloads, feed/search data, or client-controlled authorization state. Session revocation must remain authoritative over stale cache or stale credentials.

## Fail-closed rule

This reconciliation does not promote `AUTH-002` to GREEN. Contract existence, L5/L6 claims, or login DTO bindings do not substitute for verified session entity, persistence, runtime, security, lifecycle, test, and Evidence Registry evidence.

Required chain:

`Feature -> API -> DTO -> Session Entity -> Field -> Persistence -> Code -> Security -> Lifecycle -> Test -> Evidence`

## Next closure action

Establish the canonical session entity/field contract from authoritative existing sources without inventing fields; then bind persistence and runtime evidence. Mapping 0 must remain fail-closed until the complete chain is evidenced.
