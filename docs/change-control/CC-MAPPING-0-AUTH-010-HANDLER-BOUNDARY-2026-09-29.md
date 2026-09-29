# Change Control — AUTH-010 Handler Boundary
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-HANDLER-BOUNDARY-2026-09-29`
- Scope: freeze the minimal public HTTP → W02 session-management handler boundary for AUTH-010.
- Status: `HANDLER_BOUNDARY_FROZEN / RUNTIME_IMPLEMENTATION_NOT_YET_ADMITTED`
- Source head: `f1247b5fa3564bfdca40610dd52a308fe34ad052`
- Backup: `backup/pre-auth010-handler-boundary-20260929`
- Working branch: `reconcile/auth010-handler-boundary-20260929`

## Frozen boundary

### Public W01 boundary

1. `GET /auth/sessions`
   - Authenticate with the existing Payload-native `payload.auth()` boundary.
   - Require the existing verified Payload token-version claim.
   - Derive the current authenticated user from Payload auth context only; client input must not supply the owner/user identity.
   - Call W02 through the existing `W02_AUTH` Service Binding.
   - Return only the canonical AUTH-010 session DTO projection.

2. `DELETE /auth/sessions/{sessionId}`
   - Authenticate with the same existing Payload-native boundary.
   - Require the existing verified Payload token-version claim.
   - Bind `sessionId` from the route path.
   - Do not accept a request body.
   - Call W02 through the existing `W02_AUTH` Service Binding.
   - Preserve the canonical 204 success / idempotent-revoke response semantics.

### W02 authoritative session boundary

W02 remains the identity/session authority and owns the D1-01 session extension state.

The implementation boundary is:

`W01 HTTP -> Payload authentication/session validation -> W02 Service Binding -> W02 authorization/ownership check -> D1-01 session read or authoritative revoke -> W01 DTO/status projection`

W02 must enforce self/own ownership from the authenticated subject supplied by the trusted W01 boundary and the addressed session identifier. It must not trust client-supplied owner identifiers.

### Existing persistence authority

- Payload-native `users_sessions[].id`, `createdAt`, and `expiresAt` remain authoritative.
- `auth_session_state` remains the extension authority for `deviceId`, `tokenVersion`, `refreshCredentialHash`, `revokedAt`, and `lastSeenAt`.
- No duplicate session entity and no duplicate native timestamps are introduced.

## Implementation slice admitted by this boundary

The next runtime slice may add only the missing AUTH-010 session-list/revoke plumbing required to satisfy the frozen boundary:

- W01 public route handlers for list and revoke;
- W01 W02-client methods for those two operations;
- W02 internal session list/revoke handlers backed by existing D1-01 state;
- focused unit/integration tests for validation, self-ownership, bounded list, idempotent revoke, and privacy-safe projection.

No new Worker, D1 database, Queue, Service Binding, public endpoint outside the frozen OpenAPI surface, cache product, or alternate auth system is authorized.

## Runtime evidence remains separate

This boundary does not promote runtime status to GREEN. Controlled execution, cache/revocation convergence, cross-account negative tests, and Evidence Registry admission remain separate gates.

## Non-goals

- No rerun of already PASS_VERIFIED AUTH-002/AUTH-003 evidence.
- No Payload Core modification.
- No D1 migration execution or hand-authored DDL.
- No Mapping 0 GREEN promotion.
