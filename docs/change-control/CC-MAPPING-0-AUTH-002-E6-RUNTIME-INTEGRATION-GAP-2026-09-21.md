# Change Control — AUTH-002 E6 Runtime Integration Gap

- ID: CC-MAPPING-0-AUTH-002-E6-RUNTIME-INTEGRATION-GAP-2026-09-21
- Date: 2026-09-21
- Status: OPEN — RUNTIME IMPLEMENTATION EVIDENCE REQUIRED
- Feature: AUTH-002
- Gate: E6 Native Session Runtime Evidence
- Depends on: CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21

## Observed current-state facts

The active W01 source contains:
- native Payload authentication in workers/W01-payload/src/collections/Users.ts;
- the auth_session_state Drizzle schema source;
- the E5 additive migration source;
- the Payload D1 adapter hook that installs the schema source.

Repository search did not establish an active W01 runtime read/write path that correlates native Payload sid lifecycle events with auth_session_state fields.

## Contract boundary

The existing E6 contracts already define the required behavior:
- native Payload sid remains the sole session identity;
- auth_session_state.session_id must equal native sid;
- extension state covers user_id, device_id, token_version, refresh_credential_hash, revoked_at, last_seen_at;
- mismatch, revocation, expiry and concurrency behavior must fail closed;
- runtime evidence must be captured against the exact installed W01 3.87.1 dependency set.

This Change Control does not add fields, APIs, Workers, D1 domains, or a second session authority.

## Gap classification

GAP-E6-RUNTIME-001:
- Type: implementation/runtime evidence gap
- Current state: NOT_PROVEN
- Required proof: executable W01 runtime integration plus controlled remote E6 evidence
- Prohibited shortcut: marking schema existence as runtime correlation

## Acceptance boundary

Do not:
- invent runtime integration semantics;
- write a second session table;
- infer deviceId/tokenVersion/refreshCredentialHash/revokedAt/lastSeenAt behavior from schema names;
- promote AUTH-002 or Mapping 0.

Resolution path:
GAP -> approved implementation/change control -> exact W01 runtime implementation -> controlled remote E6 evidence -> validator -> Evidence Registry -> Mapping-0 validation.

## Current disposition

This gap is recorded only. No runtime code was added in this Change Control.
