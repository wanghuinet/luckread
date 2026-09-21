# Change Control — AUTH-002 E5 Remote Execution

- ID: CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21
- Date: 2026-09-21
- Status: OPEN — EXECUTION DECISION REQUIRED
- Feature: AUTH-002
- Migration: MIG-AUTH-002-SESSION-V1

## Scope

This control covers remote execution of the already-contracted AUTH-002 extension migration only.

Target:
- Database: luckread
- Database UUID: 2f80471e-3756-49f9-8db1-7707a433ad64
- Environment: CONTROLLED_REMOTE_D1

Approved migration source:
- workers/W01-payload/src/migrations/20260921_003203_MIG_AUTH_002_SESSION_V1.ts
- Source blob SHA: 2b43a7b08fe7c5be98793da7eb07ddd2cf9e6921
- Current migration index blob SHA: 436c37e395145017d9135f938d69a741a936c60b

## Preconditions already verified

1. W01 baseline migration 20250929_111647 is already applied remotely.
2. Baseline execution evidence: W01 Baseline Migration Execution run 35508571153, artifact 10604388551.
3. Current remote catalog reconfirmation: execution preflight run 35551188747 observed exactly the eight Payload baseline application tables and blocked duplicate baseline execution.
4. E5 generation proof run 35547971500 = success.
5. W01 Migration Source Audit run 35548553203 = success.
6. Current source audit rejects recreation of baseline Payload tables, parallel Session tables, and raw credential columns.
7. The E5 schema-source Change Control admits only the contracted auth_session_state schema source.

## Exact intended remote effect

Create only:
- auth_session_state
- auth_session_state_user_id_idx
- auth_session_state_device_id_idx
- auth_session_state_token_version_idx
- auth_session_state_revoked_at_idx

No baseline Payload table may be recreated.
No second Session collection or alternate session identifier may be introduced.
No raw access/refresh token or password column may be persisted.
Payload native users.sessions[] remains the native session identity authority.

## Decision boundary

This control does not change any Contract or Blueprint.

Remote execution is NOT authorized until this control is explicitly changed to the status: GREEN — EXECUTION ADMITTED

After execution, mandatory evidence must prove:
- MIG-AUTH-002-SESSION-V1 is recorded in payload_migrations;
- auth_session_state exists with the exact contracted columns;
- all four required indexes exist;
- no forbidden secret columns exist;
- no physical foreign key is added from session_id to embedded native users.sessions[];
- native users/users_sessions schema remains unchanged;
- evidence provenance and hashes bind to the exact tested commit.

Until explicit GREEN admission:
- do not execute MIG-AUTH-002-SESSION-V1 remotely;
- do not modify D1 manually;
- do not promote AUTH-002 or Mapping 0;
- do not rerun the already-applied 20250929_111647 baseline migration.

## Execution incident reconciliation — 2026-09-21

Run 35552919573 completed successfully and applied MIG-AUTH-002-SESSION-V1 to the controlled D1 target.

Governance finding:
- At the tested source SHA fe1f2784d21f3f629bbad0baa971f1aa56520914, this Change Control still stated Status: OPEN — EXECUTION DECISION REQUIRED.
- The E5 admission guard incorrectly searched the whole document for the phrase Status: GREEN — EXECUTION ADMITTED, so it matched the explanatory sentence in the Decision boundary section rather than the actual status field.
- This was a guard implementation defect, not an explicit change of authority.

Disposition:
- The remote execution result is retained as technical execution evidence, but it is NOT promoted as governance-authorized execution evidence until the authority mismatch is reconciled.
- The admission guard has been corrected to require an exact status line anchored to - Status:.
- The implicit push execution path has been removed; future E5 execution requires explicit workflow dispatch.
- No rollback or compensating D1 mutation is performed from this incident record.
- AUTH-002 and Mapping 0 remain NOT_GREEN pending governance reconciliation and fresh evidence acceptance.

Technical result retained:
- Run: 35552919573
- Artifact: 10618729380
- Artifact digest: sha256:c9bfcadba7ade81c8002786e6f323a5849c13dfb6f2390aeef44ea27584c44a1
- Migration: 20260921_003203_MIG_AUTH_002_SESSION_V1
- Remote mutation: occurred
- Post-migration validation steps: success
