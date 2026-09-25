# AUTH-013 Session Invalidation Runtime Evidence Admission — 2026-09-25

- Feature: AUTH-013
- Status: ADMITTED / CONTROLLED_REMOTE_D1_CODEPATH
- Authority: W02 / D1-01
- Scope: token/session invalidation only

## Already authoritative

The lifecycle Contract already declares `SUSPENDED`, `BANNED`, `DELETION_PENDING`, and `DELETED` as token-invalidating states. The Session Contract requires revoked sessions to fail authentication even when stale credentials or cache are presented.

No new state, Worker, D1 domain, entity, or authoritative Contract is introduced by this evidence slice.

## Implementation under evidence

Current W02 transition code performs Account State update, durable AUTH-013 publication journal insert, and — for the four token-invalidating states — `auth_session_state.revoked_at` invalidation in the same D1 batch.

The evidence must prove on real D1-01:

1. `ACTIVE → SUSPENDED` succeeds and advances `account_state_version`.
2. The target session's `revoked_at` becomes non-null.
3. The previously issued refresh credential is rejected with `UNAUTHENTICATED`.
4. Synthetic User/session/journal records are removed after the probe.
5. No topology or authority boundary changes.

## Forbidden

- No production Worker/D1 topology changes.
- No W06 AuditEvent writes from W02.
- No ad-hoc cache store.
- No bypass of the canonical account state machine.
- No marking the full AUTH-013 feature GREEN from this slice.

## Workflow

`.github/workflows/auth-013-session-invalidation-runtime-evidence.yml`

Manual dispatch requires `confirm=RUN`.

Full workflow URL:

https://github.com/wanghuinet/luckread/actions/workflows/auth-013-session-invalidation-runtime-evidence.yml
