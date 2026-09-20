# CC-MAPPING-0-AUTH-002-REMOTE-EVIDENCE-AUTOMATION-2026-09-20

Status: `GREEN — EXECUTION ADMITTED` for **read-only AUTH-002 evidence capture only**.

This control does **not** authorize, execute, or imply any D1 migration, DDL, INSERT, UPDATE, DELETE, promotion, or schema mutation.

## Scope

Execute one controlled remote evidence capture against the already verified W01-bound D1 database:

- database name: `luckread`
- database UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`
- environment class: `CONTROLLED_REMOTE_D1`
- W01 config: `workers/W01-payload/wrangler.jsonc`
- workflow: `.github/workflows/auth-session-schema-evidence.yml`

## Authority basis

1. The current Cloudflare resource inventory records `luckread` as the W01-PAYLOAD-D1-BINDING resource.
2. The existing AUTH-002 evidence workflow already defines read-only migration-status, catalog, users schema/index/FK, and `auth_session_state` schema/index/FK capture.
3. The existing migration safety guard remains independently fail-closed and requires an explicit migration execution admission before any remote migration.
4. This control is limited to evidence capture so AUTH-002 baseline authority can be decided from actual remote D1 state.

## One-shot trigger

The workflow's temporary push path is admitted only for a commit whose exact message is:

`evidence(auth-002): capture controlled remote schema`

The trigger is intended for one controlled evidence capture and will be removed after evidence review.

## Required evidence

The workflow must produce and validate:

- `d1-info.json`
- `migration-status.json`
- `catalog.json`
- `users-schema.json`
- `users-indexes.json`
- `users-foreign-keys.json`
- `auth-session-state-schema.json`
- `auth-session-state-indexes.json`
- `auth-session-state-foreign-keys.json`
- `provenance.json`
- `manifest.json`

The manifest must bind the evidence to the exact tested GitHub SHA and locked Payload/D1-adapter versions.

## Fail-closed decision

A successful evidence capture does not itself authorize migration promotion. The evidence must be reviewed against the AUTH-002 baseline contract before any migration decision.


## Repository evidence persistence

For the one-shot push-triggered run only, the workflow may use `contents: write` to persist the validated read-only evidence package under `artifacts/evidence/auth-002/` and remove the trigger marker. This repository write is evidence persistence only; it does not grant D1 mutation authority.
