# Change Control: AUTH-003 Current Main SHA Cursor Synchronization — 2026-09-27

- Change-control scope: reconcile Mapping 0 execution cursor and AUTH-003 runtime admission packet to the authoritative `main` after the credential-add implementation merge.
- Current authoritative main: `419bb7fd887af0c30412bead50f8196ec6446bb7`.
- Previous cursor/packet source head: `90ecdd956b4cf99ceeae4cd49ded4dfe6a24ddc0`.
- Backup branch: `backup/pre-auth003-current-sha-cursor-sync-20260927`.
- Change branch: `fix/auth003-current-sha-cursor-sync-20260927`.

## Evidence already closed

- Remote AUTH-003 migration execution: run `36296831559`, exact execution SHA `52c6868f99ae2ec9aeb8bdceb4a18396cde20435`.
- Read-only post-migration schema evidence: run `36298629648`, PASS_VERIFIED, no DDL/DML.
- Do not rerun either remote migration or unchanged schema postcheck.

## Current implementation gate

The smallest AUTH-003 credential-add persistence/security/runtime slice is present on `main` at exact SHA `419bb7fd887af0c30412bead50f8196ec6446bb7`. The prior unit failure was a fixture defect and was corrected in the merged test-only change. Runtime/security evidence has not yet been executed or admitted.

## Required next action

Run `.github/workflows/w02-auth-003-credential-add-runtime-evidence.yml` with:

- `source_sha=419bb7fd887af0c30412bead50f8196ec6446bb7`
- `database_name=luckread`
- `confirm=RUN`

The runtime harness is controlled evidence only and must not deploy the production Worker. Evidence Registry status and Mapping 0 status remain unchanged until the runtime artifact is produced and admitted.

## Prohibited

- No remote DDL/DML outside the controlled evidence harness.
- No migration re-execution.
- No unchanged postcheck rerun.
- No ENT-IDENTITY / ENT-CREDENTIAL promotion.
- No Mapping 0 GREEN promotion from documentation-only reconciliation.
