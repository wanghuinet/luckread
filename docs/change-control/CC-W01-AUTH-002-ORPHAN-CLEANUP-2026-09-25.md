# Change Control — AUTH-002 Failed Probe Orphan Cleanup — 2026-09-25

- ID: CC-W01-AUTH-002-ORPHAN-CLEANUP-2026-09-25
- Date: 2026-09-25
- Status: GREEN — EXECUTION ADMITTED
- Scope: Remove only the synthetic User row left by failed AUTH-002 remote runtime evidence Run `36127160884`.

## Authority and evidence basis

- Run `36127160884` executed the admitted AUTH-002 remote runtime probe against the real W01 Worker and failed at `POST /api/users` with HTTP 500 before the probe received a User ID.
- The admitted probe generates synthetic primary-user emails in the exact form `auth002-primary-<run-id>-<random>@example.com`.
- The probe's cleanup logic can only delete Users after a User ID has been returned; therefore a server-side 500 after persistence can leave an orphan test row.
- Subsequent controlled remote preflight Run `36130718874` observed exactly one row in W01 `users`, while the profile migration history remained only `20250929_111647` and `20260921_003203_MIG_AUTH_002_SESSION_V1`.

## Execution boundary

Cleanup is allowed only through:
`.github/workflows/auth-002-orphan-probe-user-cleanup.yml`

Required manual inputs:
- `target_run_id = 36127160884`
- `database_name = luckread`
- `confirm = CLEANUP_AUTH002_ORPHAN_USER`

The workflow must fail closed unless:
- the target Run ID is exactly `36127160884`;
- the remote `users` row count is exactly 1;
- exactly one row matches `auth002-primary-%@example.com`;
- the matching row was created within the exact Run `36127160884` execution window;
- migration history is exactly `20250929_111647` and `20260921_003203_MIG_AUTH_002_SESSION_V1`.

## Mutation boundary

Only the matching synthetic User ID may be deleted. Before deletion the workflow removes any linked `auth_session_state` and Payload native `users_sessions` rows for that exact User ID. No other User row may be touched.

## Acceptance

GREEN requires:
- post-cleanup `users` count = 0;
- post-cleanup AUTH-002 synthetic-candidate count = 0;
- cleanup evidence artifact retained with exact source SHA, target Run ID, and redacted candidate hashes.

## Non-actions

- No Blueprint or Contract semantics change.
- No User profile backfill is introduced.
- No W01 migration source is altered.
- No D1 topology or Worker ownership changes.
- This cleanup is remediation of test residue only and does not promote AUTH-002 runtime evidence.
