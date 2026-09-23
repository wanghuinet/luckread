# AUTH-002 E6 Runtime Source Progress — 2026-09-23

- Repository authority: GitHub `main`
- Tested source commit: `d9e587ec8669b7fa9c7fc338ae27fae3edc7ff10`
- Scope: AUTH-002 E6 source implementation progress only
- Evidence class: SOURCE_IMPLEMENTATION_AND_CI, not controlled remote runtime evidence

## Closed in this increment

1. `workers/W02-content/src/session/session-runtime.ts`
   - Native Payload session identity remains the only session identity.
   - Refresh session lookup correlates `auth_session_state.session_id` with native `users_sessions.id` and native user binding.
   - Refresh rejects device mismatch, revocation, missing native expiry, and expiry before mutation.
   - Authoritative layer/account-state resolution occurs before refresh credential rotation.
   - Refresh rotation remains compare-and-update against the predecessor hash.
   - A denied/unavailable authorization result does not rotate the predecessor credential and does not issue an access token.
2. `workers/W02-content/src/session/session-runtime.test.ts`
   - Added regression coverage proving denial precedes rotation/token issuance.
3. OpenAPI auth layer pattern repair was completed earlier on `bd8a9be942847ab6564f9f90f481c131130afa29`; current main retains the corrected `^L[0-8]$` pattern.

## CI evidence

GitHub Actions run: `35806329154`
Workflow: `W02 RoleAssignment Verification`
Result: SUCCESS

Verified steps:
- W02 Typecheck: PASS
- Generated RoleAssignment migration: PASS
- Committed migration drift check: PASS
- W02 authorization tests: PASS
- W02 session runtime tests: PASS

## Controlled remote execution gate update

- Evidence-collection workflow updated at commit `8996436496c509f04302e2c738c933a16102b523`.
- The current `main` adds an execution-time guard at `5bdc317eb4b80176a95ae7edc849b155a089ddf3` that requires the input database name to equal the configured `D1_01` target and the controlled D1-01 UUID.
- The workflow now performs the approved D1-01 remote RoleAssignment migration and then reads back `role_assignments`, its indexes/triggers, the D1 migration ledger, and the current row count.
- It uploads controlled provenance plus the remote readback outputs as a GitHub Actions artifact.
- This is execution infrastructure only; it is **not** remote execution evidence until the workflow is actually run successfully against D1-01.
- Required dispatch inputs for the current `main`: `source_sha=8996436496c509f04302e2c738c933a16102b523`, `database_name=luckread`, `confirm=APPLY`.

## Explicitly not closed

- W02 controlled Cloudflare deployment provenance
- D1-01 remote RoleAssignment migration execution/evidence
- W01 -> W02 `W02_AUTH` deployed binding evidence
- Public/edge `authLogin` runtime execution
- Public/edge `authRefresh` runtime execution
- Controlled E6 8-artifact runtime evidence package
- Evidence Registry promotion of AUTH-002
- AUTH-013 concrete `User.account_state` implementation/evidence

## Governance boundaries

- Do not add `User.layer`.
- Do not create a second session identity or parallel full sessions table.
- Do not synthesize `accountState` in W01/W02.
- Do not treat source code or unit tests as controlled remote runtime evidence.
- Do not repeat the already-passing W02 unit/type/migration-generation tests unless the source or contracts change.

## Next cursor

`E6 Runtime-002 / controlled execution gate`

Prerequisite before public auth runtime wiring:
1. resolve the existing AUTH-013 account-state authority/implementation gap under its own contract/change-control path;
2. execute the already-authorized W02 deployment and D1-01 migration workflows;
3. execute W01 `W02_AUTH` binding deployment;
4. then produce controlled authLogin/authRefresh runtime evidence against the exact deployed source commit.
