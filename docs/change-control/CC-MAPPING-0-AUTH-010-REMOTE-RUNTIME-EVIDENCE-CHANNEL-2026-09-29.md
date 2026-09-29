# Change Control — AUTH-010 Remote Runtime Evidence Channel
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-REMOTE-RUNTIME-EVIDENCE-CHANNEL-2026-09-29`
- Scope: establish a controlled remote HTTP evidence path for AUTH-010.
- Status: `EVIDENCE_CHANNEL_READY / NOT_EXECUTED`
- Source baseline: `8a42fbcb0bb1da4a84d687fd603a14c5fb75a605`
- Backup: `backup/pre-auth010-remote-evidence-channel-20260929`
- Working branch: `evidence/auth010-remote-session-20260929`

## Evidence channel

Workflow:

`.github/workflows/auth-010-remote-e2e.yml`

Probe:

`scripts/auth-010-session-runtime-e2e.mjs`

The workflow is deployment-bound to the existing `W01 W02 Auth Binding Deploy` workflow. On a successful deployment on `main`, it automatically resolves the exact deployed application source SHA from the deployment artifact and checks out that exact SHA before execution. A manual workflow-dispatch path is retained as a backstop.

## Required controlled assertions

1. Unauthenticated `GET /auth/sessions` is denied.
2. Authenticated current user can list owned sessions.
3. Returned list is bounded to 50 items even when the client asks for 100.
4. Session projection contains only the canonical public fields.
5. The response is `no-store` and therefore not a shared-cache authority.
6. Invalid opaque cursor is rejected.
7. An authenticated session can revoke another owned session.
8. Revocation returns 204 with no body.
9. Revocation is persisted in `auth_session_state` and the corresponding Payload-native session is removed.
10. Repeating the same revoke succeeds as an idempotent no-op.
11. A different account cannot revoke the target session.
12. A stale token-version is denied by the current-session validation boundary.
13. All synthetic users, role assignments, native sessions and extension rows are removed after the test.
14. Evidence artifacts contain no secrets and include tested source SHA plus SHA-256 file hashes.

## Non-goals

- No new Worker, D1, Queue, Service Binding, cache service or public API path.
- No production business data.
- No promotion of AUTH-010 or Mapping 0 to GREEN.
- No rerun of already-admitted AUTH-002/AUTH-003 evidence.
- No manual migration execution by this workflow.

## Execution rule

A successful workflow run is executable evidence for the tested deployed source only. Evidence Registry admission and AUTH-010 promotion remain separate reconciliation steps and require the complete contract/evidence chain to pass.
