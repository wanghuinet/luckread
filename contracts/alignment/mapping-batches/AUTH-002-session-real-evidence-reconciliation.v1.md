# AUTH-002 — Session Authentication Real-Evidence Reconciliation v1.2

## Status

`BLOCKED_NOT_GREEN`

## Scope

Canonical feature: `AUTH-002` — login / logout.

## Evidence-supported facts

1. `contracts/openapi/v1/openapi.yaml` defines `authLogin` and `authLogout`.
2. The canonical Session field contract freezes nine fields and their security/lifecycle semantics.
3. The persistence/runtime contract freezes D1 mapping, migration invariants and runtime boundaries.
4. Payload 3.87.1 native sessions are stored as `user.sessions[]` with `id`, `createdAt`, and `expiresAt`; login creates `sid`, JWT validation checks `sid`, logout removes the session, and refresh extends `expiresAt`.
5. Payload 3.87.1 native Session therefore cannot directly satisfy the canonical Session contract because `deviceId`, `tokenVersion`, `refreshCredentialHash`, `revokedAt`, and `lastSeenAt` are absent or semantically incompatible.

## Minimum integration contract

`contracts/persistence/AUTH-002-minimum-session-integration-contract.v1.json` is now the implementation input for the missing dimensions.

It defines a minimum extension around the native Payload session identity rather than a duplicate session system. Native `sid`, user association, `createdAt`, and `expiresAt` remain reuse candidates subject to physical/runtime evidence. The five unsupported dimensions receive explicit application-owned state and verification requirements.

## Architecture decision

**Direct native promotion is rejected. Full parallel Session persistence is also rejected.**

The admitted path is:

`Payload native auth/session identity -> minimal canonical integration state -> single authorization decision`

The integration MUST reference the native `sid`; it MUST NOT mint an independent session identifier.

## Current mapping state

| Dimension | State |
|---|---|
| `id` / native `sid` | Candidate reuse; physical/runtime proof required |
| `userId` | Candidate reuse; physical/runtime proof required |
| `createdAt` | Candidate reuse; physical/runtime proof required |
| `expiresAt` | Candidate reuse; physical/runtime proof required |
| `deviceId` | Explicit integration state required |
| `tokenVersion` | Explicit integration state required |
| `refreshCredentialHash` | Explicit secret-derived integration state required |
| `revokedAt` | Explicit durable revocation state required |
| `lastSeenAt` | Explicit runtime activity state required |

## Implementation admission

No migration or runtime code is admitted until:

1. the actual Payload-generated D1 schema for `users.sessions` is captured;
2. the minimal extension storage is selected and mapped without duplicating native session identity;
3. migration semantics are versioned;
4. runtime ordering and compensation behavior are bound;
5. security/concurrency test cases are bound;
6. Evidence Registry execution records are defined.

## Required failure invariants

- Native `sid` removed or invalid -> request fails closed.
- Canonical revocation present -> request fails closed even if a stale JWT exists.
- Token version invalidated -> affected session authorization fails closed.
- Refresh predecessor already consumed -> replay fails.
- Concurrent refresh -> at most one successful successor.
- Raw access token, raw refresh token or password persisted -> immediate gate failure.
- Device binding missing or inconsistent -> request fails closed where the contract requires binding.
- Failure to persist required canonical state -> operation cannot report successful completion.

## Current gate

```text
Contract layer                 = CLOSED
Payload 3.87.1 source analysis = COMPLETE
Native direct equivalence      = REJECTED
Minimum integration contract   = CLOSED_FOR_IMPLEMENTATION_INPUT
Actual D1 schema               = NOT VERIFIED
Migration                      = NOT VERIFIED
Runtime implementation         = NOT VERIFIED
Security/E2E                   = NOT VERIFIED
Concurrency/E2E                = NOT VERIFIED
Evidence Registry              = NOT BOUND
ENT-SESSION                    = PROPOSED
AUTH-002                       = BLOCKED_NOT_GREEN
```

## Next closure action

Capture the actual `users`/`sessions` physical D1 schema and generate the smallest migration for the five explicitly contracted integration dimensions. Do not create a full duplicate `sessions` table.
