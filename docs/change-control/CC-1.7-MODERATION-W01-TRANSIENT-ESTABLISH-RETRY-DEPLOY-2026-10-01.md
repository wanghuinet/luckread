# CC-1.7 — W01 transient session-establishment retry deployment — 2026-10-01

- Authority: GitHub `main`
- Scope: W01 login only
- Runtime change: when the existing W02 `establishSession` call returns HTTP 503, retry the same native `sid` once after 250ms.
- No Contract semantics changed.
- No new Worker.
- No new D1 domain.
- No database migration.
- No W02/W03/W06 implementation change.
- Backup: `backup/pre-w01-auth-retry-one-time-deploy-20261001`

## Evidence basis

Controlled Moderation L6 Security E2E repeatedly observed:
- Payload native `users_sessions` count = 1 after W01 login returned 503.
- Active canonical role assignments = 2.
- `auth_session_state` count = 0.
- Direct W01→W02 Service Binding `resolve-layer` returned 200/L6.
- Direct W01→W02 Service Binding `session/establish` subsequently returned 200 and created `auth_session_state`.

This supports a bounded retry of the same session-establishment operation as the minimum runtime resilience change. The exact underlying transient D1 error code was not exposed by the existing W02 error mapping, so this Change Control does not claim a more specific root cause.

## Deployment gate

The one-time deployment workflow is intentionally isolated from the normal W01 W02 binding deployment workflow and performs no migration.

Marker:
`DEPLOY_W01_AUTH_RETRY=AUTHORIZED_BY_MAIN_MERGE`

Acceptance requires:
1. W01 typecheck PASS.
2. W01 build PASS.
3. W01 deployment success.
4. Existing moderation L6 Security E2E rerun from the exact deployed W01 source boundary.
