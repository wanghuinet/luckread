# AUTH-002 — Session Authentication Real-Evidence Reconciliation v1.5

## Status

`BLOCKED_NOT_GREEN`

## Scope

Canonical feature: `AUTH-002` — login / logout.

## Evidence-supported facts

1. `contracts/openapi/v1/openapi.yaml` defines `authLogin` and `authLogout`.
2. The canonical Session field contract freezes nine fields and their security/lifecycle semantics.
3. Payload 3.87.1 native sessions are stored as `user.sessions[]` with `id`, `createdAt`, and `expiresAt`; login creates `sid`, JWT validation checks `sid`, logout removes the session, and refresh extends `expiresAt`.
4. Payload 3.87.1 native Session therefore cannot directly satisfy the canonical Session contract because `deviceId`, `tokenVersion`, `refreshCredentialHash`, `revokedAt`, and `lastSeenAt` are absent or semantically incompatible.
5. The earlier persistence mapping that assumed an independent canonical `sessions` table is superseded by the native-session architecture and must not be implemented.
6. Repository inspection confirms `src/collections/Users.ts` enables Payload auth and `src/payload.config.ts` uses `sqliteD1Adapter`, `push: false`, and `src/migrations`; however, the current `main` tree contains no executable migration artifact that can establish actual D1 schema evidence.
7. `.github/workflows/auth-session-schema-evidence.yml` now provides an explicit `workflow_dispatch` path for a controlled remote D1 target. It captures D1 metadata, remote migration status, SQLite catalog, `users` table structure, indexes, foreign keys, and a reproducible manifest bound to the tested commit and locked Payload/D1-adapter versions.
8. The evidence workflow is capture-only: it does not apply migrations or mutate the target D1.

## Minimum integration contract

`contracts/persistence/AUTH-002-minimum-session-integration-contract.v1.json` remains the implementation behavior contract.

`contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json` is the authoritative physical persistence contract for the extension state. It stores only the five unsupported canonical dimensions and keys them by the native Payload `sid`.

## Schema evidence gate

`contracts/persistence/AUTH-002-schema-evidence-capture-contract.v1.0.md` defines the required reproducible procedure for obtaining actual Payload/D1 schema evidence.

`contracts/persistence/AUTH-002-schema-evidence-manifest.v1.json` defines the machine-readable evidence package and promotion rules.

The workflow implementation is now present, but its execution against a controlled D1 target is still not evidenced in the repository. Procedural capability is therefore not equivalent to schema verification.

## Architecture decision

**Direct native promotion is rejected. Full parallel Session persistence is rejected.**

The admitted architecture is:

`Payload native auth/session identity -> minimal D1 extension state -> single authorization decision`

The native Payload session remains the only source of native session identity. The extension state MUST NOT mint or substitute an independent session identifier.

## Physical persistence decision

The extension state is proposed as:

`auth_session_state`

with:

- `session_id` — native Payload `sid`, primary key;
- `user_id` — authoritative User identity;
- `device_id` — canonical device binding;
- `token_version` — server-controlled invalidation version;
- `refresh_credential_hash` — one-way derived refresh verifier;
- `revoked_at` — durable canonical revocation timestamp;
- `last_seen_at` — bounded activity timestamp.

This table remains **contract-only** until actual schema and migration evidence exists. It is explicitly not a mirror of `users.sessions[]` and must not duplicate `createdAt` or `expiresAt`.

## Current mapping state

| Dimension | State |
|---|---|
| `id` / native `sid` | Native Payload identity; physical/runtime proof required |
| `userId` | Native User identity + extension binding; physical/runtime proof required |
| `createdAt` | Native Payload session field; physical proof required |
| `expiresAt` | Native Payload session field; physical/runtime proof required |
| `deviceId` | `auth_session_state.device_id` proposed |
| `tokenVersion` | `auth_session_state.token_version` proposed |
| `refreshCredentialHash` | `auth_session_state.refresh_credential_hash` proposed |
| `revokedAt` | `auth_session_state.revoked_at` proposed |
| `lastSeenAt` | `auth_session_state.last_seen_at` proposed |

## Migration admission

No migration is admitted as applied until all of the following exist:

1. actual generated Payload/D1 schema evidence for the authentication-enabled `users` collection and native `sessions` representation;
2. exact extension-table schema evidence;
3. versioned migration artifact;
4. successful execution result;
5. migration status evidence;
6. relationship/integrity evidence for `session_id -> users.sessions[].id` and `user_id -> ENT-USER`;
7. secret non-persistence evidence;
8. rollback/compensation analysis.

A physical foreign key from `auth_session_state.session_id` to a native embedded session element is not permitted; the native relationship is logical because `users.sessions[]` is embedded in the user record.

## Runtime admission

The implementation must ensure:

- login creates the Payload native session first and then exactly one extension row for the same `sid`;
- a failure to establish required extension state prevents successful authorization/session issuance according to the transaction/compensation contract;
- validation checks native sid existence and expiry plus extension device/tokenVersion/revocation state;
- logout remains idempotent while preserving required durable revocation evidence;
- refresh rotation uses compare-and-update or a transactionally equivalent mechanism on the extension state;
- refresh replay fails and concurrent refresh allows at most one valid successor;
- `lastSeenAt` updates are bounded and are never the sole authorization predicate.

## Current gate

```text
Contract layer                  = CLOSED
Payload 3.87.1 source analysis  = COMPLETE
Native direct equivalence       = REJECTED
Minimum integration contract    = CLOSED
Extension persistence contract  = CLOSED_FOR_IMPLEMENTATION_INPUT
Schema evidence procedure       = CLOSED
Remote evidence workflow        = IMPLEMENTED
Remote schema evidence          = NOT_EXECUTED
Actual D1 schema                = NOT VERIFIED
Migration artifact              = NOT VERIFIED
Migration applied               = NOT VERIFIED
Runtime implementation          = NOT VERIFIED
Security/E2E                    = NOT VERIFIED
Concurrency/E2E                 = NOT VERIFIED
Evidence Registry               = NOT BOUND
ENT-SESSION                     = PROPOSED
AUTH-002                        = BLOCKED_NOT_GREEN
```

## Next closure action

Run the `AUTH-002 Session Schema Evidence` workflow manually against a controlled remote D1 target using the actual database name and repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Review the generated artifact package before admitting any migration or runtime implementation. No second full Session table may be introduced.
