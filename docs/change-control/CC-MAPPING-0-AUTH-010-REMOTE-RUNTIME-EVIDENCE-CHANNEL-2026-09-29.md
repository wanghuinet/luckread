# Change Control — AUTH-010 Remote Runtime Evidence Channel
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-REMOTE-RUNTIME-EVIDENCE-CHANNEL-2026-09-29`
- Scope: establish a controlled remote HTTP evidence path for AUTH-010.
- Status: `HARNESS_RESTORED_ON_CANDIDATE / NOT_EXECUTED`
- Source baseline: `8a42fbcb0bb1da4a84d687fd603a14c5fb75a605`
- Backup: `backup/pre-auth010-remote-evidence-channel-20260929`
- Working branch: `fix/api-closeout-session-route-v1`

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
2. Two distinct, pre-provisioned test accounts can log in and list their own sessions through the public W01 API.
3. Each `GET /api/v1/auth/sessions?limit=100` response is bounded to at most 50 items, and `currentSessionId` matches the authenticated session.
4. Session DTOs exclude token/user/refresh-secret fields and responses include `cache-control: no-store`.
5. A malformed opaque cursor is rejected with HTTP 400.
6. Sessions created by the two accounts are not exposed across account boundaries.
7. Account B attempting to revoke account A's second test-created session returns the public idempotent 204 shape but does not remove or hide that session from account A.
8. Account A can revoke its own second test-created session; the response is 204 with an empty body.
9. Repeating the same revoke with the same idempotency key is an idempotent no-op (204).
10. The revoked session disappears from a subsequent list while account A's primary test session remains current.
11. Cleanup attempts revoke only the three current-run login sessions (A1, A2 and B1); no accounts are created and no direct D1 writes occur.
12. The evidence JSON includes the exact tested source SHA, deployment run/artifact IDs, SHA-256 hashes for both the probe and workflow, assertion outcomes, and no secret values.

## Non-goals

- No new Worker, D1, Queue, Service Binding, cache service or public API path.
- No production business data.
- No direct remote D1 reads/writes, no synthetic-user creation, and no changes to roles or account state.
- No promotion of AUTH-010 or Mapping 0 to GREEN.
- No rerun of already-admitted AUTH-002/AUTH-003 evidence.
- No deployment action is performed by the probe workflow itself.
- The test requires two pre-provisioned distinct accounts that are already verified and active, held in GitHub Actions secrets named `AUTH010_REMOTE_TEST_USER_A_EMAIL`, `AUTH010_REMOTE_TEST_USER_A_PASSWORD`, `AUTH010_REMOTE_TEST_USER_B_EMAIL`, and `AUTH010_REMOTE_TEST_USER_B_PASSWORD`.

## Execution rule

A remote run is allowed only after the exact source SHA has been deployed by the controlled W01/W02 workflow. The new workflow requires both matching successful deployment provenance and a manual `RUN_AUTH010_REMOTE_E2E` confirmation before the HTTP probe begins. This is a candidate harness only until merged and manually executed; remote runtime remains unverified until a successful run exists. Evidence Registry admission and AUTH-010 promotion remain separate reconciliation steps and require the complete contract/evidence chain to pass.
