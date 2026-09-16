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
7. `contracts/entity/AUTH-002-session-field-contract.v1.json` now freezes the canonical AUTH-002 Session field contract with explicit field IDs, types, nullability, lifecycle, classification, exposure boundaries, security invariants and verification requirements.
8. `contracts/entity/entity-field-contract.v1.json` now binds `ENT-SESSION` to the AUTH-002 Session field contract. The fields remain `CONTRACTED_NOT_VERIFIED` until executable schema/persistence/runtime evidence exists.
9. `contracts/entity/entity-catalog.v1.json` still marks `ENT-SESSION` as `PROPOSED`; contract existence does not promote entity implementation status.
10. `contracts/alignment/database-entity-persistence-inventory.v1.json` still contains no verified session persistence record.
11. Repository search does not establish executable handlers bound to `authLogin` / `authLogout`, nor verified session persistence or migration evidence.

## Mapping decision

Evidence-backed links may be retained:

- `AUTH-002 -> authLogin`
- `AUTH-002 -> authLogout`
- `AUTH-002 -> DTO-AUTH-LOGIN-REQUEST`
- `AUTH-002 -> DTO-AUTH-LOGIN-RESPONSE`
- `AUTH-002 -> L5/L6 session validation claims in docs/184-*`
- `AUTH-002 -> ENT-SESSION -> contracts/entity/AUTH-002-session-field-contract.v1.json`

### Resolved at contract layer

The following contract-layer blocker is now closed:

- canonical session field IDs and field semantics;
- explicit secret/non-secret classification and exposure boundary;
- field-level invariants for device binding, token version, rotation, expiry and revocation.

### Remaining blocking evidence

The following remain unresolved and blocking:

- canonical `ENT-SESSION` promotion from PROPOSED to VERIFIED;
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

The canonical field contract specifically forbids raw credential persistence and public/admin/event exposure of `refreshCredentialHash`.

## Fail-closed rule

This reconciliation does not promote `AUTH-002` to GREEN. Contract existence, L5/L6 claims, or login DTO bindings do not substitute for verified session entity, persistence, runtime, security, lifecycle, test, and Evidence Registry evidence.

Required chain:

`Feature -> API -> DTO -> Session Entity -> Field -> Persistence -> Code -> Security -> Lifecycle -> Test -> Evidence`

## Next closure action

Proceed to the **AUTH-002 persistence + migration/runtime contract** using the frozen Session field contract as the only schema input. Migration/runtime work must prove the field contract without adding undocumented fields or silently changing semantics. Mapping 0 must remain fail-closed until the complete chain is evidenced.
