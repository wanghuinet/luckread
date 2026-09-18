# AUTH-002 — Session Authentication Real-Evidence Reconciliation v1.6

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
6. Repository inspection confirms the active W01 source `workers/W01-payload/src/collections/Users.ts` enables Payload auth and `workers/W01-payload/src/payload.config.ts` uses `sqliteD1Adapter`, `push: false`, and `workers/W01-payload/src/migrations`; the W01 tree contains migration source, but that source is not itself proof of applied remote D1 schema or runtime equivalence.
7. `.github/workflows/auth-session-schema-evidence.yml` now provides an explicit controlled-remote D1 evidence path and captures D1 metadata, remote migration status, SQLite catalog, `users` table structure, indexes, foreign keys, and a reproducible manifest bound to the tested commit and locked dependency versions.
8. The schema-catalog workflow is capture-only and does not apply migrations or intentionally mutate the target D1.
9. `contracts/persistence/AUTH-002-schema-catalog-evidence-contract.v1.json` explicitly defines this as a Phase-1 schema/catalog gate; it does not satisfy the separate native-session runtime correlation gate.

## Minimum integration contract

`contracts/persistence/AUTH-002-minimum-session-integration-contract.v1.json` remains the implementation behavior contract.

`contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json` is the authoritative physical persistence contract for the extension state. It stores only the unsupported canonical dimensions and keys them by the native Payload `sid`.

## Evidence gates

### Gate 1 — Remote schema/catalog evidence

`contracts/persistence/AUTH-002-schema-catalog-evidence-contract.v1.json` defines the current executable CI evidence package.

Acceptance proves only that the selected controlled remote D1 target was queried and that the physical `users` table/schema metadata was captured without prohibited data.

### Gate 2 — Native session runtime evidence

`contracts/persistence/AUTH-002-schema-evidence-capture-contract.v1.0.md` and `contracts/persistence/AUTH-002-schema-evidence-manifest.v1.json` remain the full evidence contract for dependency identity, actual schema, runtime session representation, lifecycle correlation, and final evidence promotion.

The two gates are intentionally separate. Passing Gate 1 MUST NOT be interpreted as proving native `sessions[]` runtime behavior.

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

## Migration admission

No migration is admitted as applied until all of the following exist:

1. accepted Gate-1 actual D1 schema evidence;
2. runtime-correlated native Payload session representation;
3. exact extension-table schema evidence;
4. versioned migration artifact;
5. successful execution result;
6. migration status evidence;
7. relationship/integrity evidence for `session_id -> users.sessions[].id` and `user_id -> ENT-USER`;
8. secret non-persistence evidence;
9. rollback/compensation analysis.

A physical foreign key from `auth_session_state.session_id` to a native embedded session element is not permitted; the native relationship is logical because `users.sessions[]` is embedded in the user record.

## Current gate

```text
Contract layer                  = CLOSED
Payload 3.87.1 source analysis  = COMPLETE
Native direct equivalence       = REJECTED
Minimum integration contract    = CLOSED
Extension persistence contract  = CLOSED_FOR_IMPLEMENTATION_INPUT
Gate 1 contract                 = CLOSED
Gate 1 workflow                 = IMPLEMENTED
Gate 1 execution                = NOT_EXECUTED
Actual D1 schema                = NOT VERIFIED
Gate 2 runtime evidence         = NOT_EXECUTED
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

Run Gate 1 manually against a controlled remote D1 target using the actual database name and repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Review the generated evidence artifact package. Only after Gate 1 is accepted should the separate runtime correlation work begin. No second full Session table may be introduced.
