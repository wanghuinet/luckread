# Change Control — AUTH-010 Remote Runtime Evidence Channel
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-REMOTE-RUNTIME-EVIDENCE-CHANNEL-2026-09-29`
- Scope: establish a controlled remote HTTP evidence path for AUTH-010.
- Status: `EVIDENCE_CHANNEL_MISSING_ON_ACTIVE_BRANCH / NOT_EXECUTED`
- Source baseline: `8a42fbcb0bb1da4a84d687fd603a14c5fb75a605`
- Backup: `backup/pre-auth010-remote-evidence-channel-20260929`
- Working branch: `evidence/auth010-remote-session-20260929`

## Evidence channel status — blocked on the active candidate

The documented paths below are **not present** in current `main` or candidate branch `fix/api-closeout-session-route-v1`:

- Expected workflow: `.github/workflows/auth-010-remote-e2e.yml`
- Expected probe: `scripts/auth-010-session-runtime-e2e.mjs`

An older evidence branch contains a similarly named harness, but it targets obsolete `users_sessions` / `auth_session_state` fields and the legacy `/auth/sessions` route. Current candidate code uses the Better Auth native `session` table and the versioned W01 route `/api/v1/auth/sessions`. The older harness is therefore not valid evidence for this candidate and must not be run unchanged.

The current candidate has only controlled local-D1 evidence. Remote/deployed exact-SHA verification is **NOT EXECUTED**. The remote channel must be restored against the current native-session implementation, bound to a successful deployment artifact for the exact tested SHA, and explicitly authorized before it performs any remote-D1 fixture writes.

## Required controlled assertions

1. Unauthenticated `GET /api/v1/auth/sessions` is denied with HTTP 401.
2. Authenticated current user can list owned sessions.
3. Returned list is bounded to 50 items even when the client asks for 100.
4. Session DTOs expose only the current canonical public fields; `currentSessionId` is stable in the response envelope.
5. The response is `no-store` and therefore not a shared-cache authority.
6. Invalid opaque cursor is rejected.
7. An authenticated session can revoke another owned session.
8. Revocation returns 204 with no body.
9. Revocation removes the native Better Auth session, and the revoked session disappears from subsequent listing.
10. Repeating the same revoke succeeds as an idempotent no-op.
11. A different account cannot revoke the target session.
13. All synthetic users, role assignments, native sessions and extension rows are removed after the test.
14. Evidence artifacts contain no secrets and include tested source SHA plus SHA-256 file hashes.

## Non-goals

- No new Worker, D1, Queue, Service Binding, cache service or public API path.
- No production business data.
- No promotion of AUTH-010 or Mapping 0 to GREEN.
- No rerun of already-admitted AUTH-002/AUTH-003 evidence.
- No manual migration execution by this workflow.
- A remote test run must be manually authorized; it will create and clean up synthetic test accounts/session fixtures in the controlled `luckread` D1 database.

## Execution rule

After the channel is restored, a successful workflow run will be executable evidence for the exact tested deployed source only. Evidence Registry admission and AUTH-010 promotion remain separate reconciliation steps and require the complete contract/evidence chain to pass.
