# Change Control — AUTH-010 Remote Runtime Evidence Channel
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-REMOTE-RUNTIME-EVIDENCE-CHANNEL-2026-09-29`
- Scope: establish a controlled remote HTTP evidence path for AUTH-010.
- Status: `EVIDENCE_CHANNEL_MISSING_ON_ACTIVE_BRANCH / NOT_EXECUTED`
- Source baseline: `8a42fbcb0bb1da4a84d687fd603a14c5fb75a605`
- Backup: `backup/pre-auth010-remote-evidence-channel-20260929`
- Working branch: `evidence/auth010-remote-session-20260929`

## Evidence channel status — restored on the candidate; remote run not executed

The active candidate now includes the native-session-compatible paths:

- Workflow: `.github/workflows/auth-010-remote-e2e.yml`
- Probe: `scripts/auth-010-session-runtime-e2e.mjs`

The old backup-branch harness remains incompatible: it targets obsolete `users_sessions` / `auth_session_state` fields and the legacy `/auth/sessions` route. Do not run that older harness.

The restored probe uses only the public W01 HTTP API at `https://luckread.com`. It logs into two pre-provisioned, distinct, verified/active test accounts, obtains three session IDs created by those logins, verifies list privacy/self-scope/cross-account isolation/revoke/idempotency, and best-effort revokes only those run-created sessions. It does not create accounts, issue direct D1 writes, or touch unrelated sessions. Required Actions secrets are `AUTH010_REMOTE_TEST_USER_A_EMAIL`, `AUTH010_REMOTE_TEST_USER_A_PASSWORD`, `AUTH010_REMOTE_TEST_USER_B_EMAIL`, and `AUTH010_REMOTE_TEST_USER_B_PASSWORD`; secret values are never recorded.

The workflow refuses to run its probe unless manually dispatched with `confirm=RUN_AUTH010_REMOTE_E2E` and the supplied source SHA has a successful `w01-w02-binding-deploy.yml` run plus a matching `w01-w02-binding-deployment-<source_sha>` artifact whose provenance matches the exact SHA. This guards the test behind deployment evidence; it does not itself deploy code.

Remote/deployed exact-SHA verification remains **NOT EXECUTED**. The harness must first land in the merged source, that exact source must be deployed through the controlled W01/W02 workflow, the dedicated test-account secrets must exist, and the remote workflow must then be explicitly dispatched.

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
