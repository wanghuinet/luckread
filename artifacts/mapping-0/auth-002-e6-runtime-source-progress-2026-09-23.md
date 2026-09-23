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
- Required dispatch inputs for the current `main`: `source_sha=77a996ac1932b7b9b53264b79e4352d6626c5cc0`, `database_name=luckread`, `confirm=APPLY`.

## Explicitly not closed

- W02 controlled Cloudflare deployment provenance
- W01 -> W02 `W02_AUTH` deployed binding evidence
- Public/edge `authLogin` runtime execution
- Public/edge `authRefresh` runtime execution
- Controlled E6 8-artifact runtime evidence package
- Evidence Registry registration/promotion of AUTH-002
- AUTH-013 concrete `User.account_state` implementation/evidence

## Newly closed in this increment

- D1-01 remote RoleAssignment migration + persistence readback is now execution-proven by GitHub Actions run `35815318484` against the controlled D1-01 UUID `2f80471e-3756-49f9-8db1-7707a433ad64`.
- Exact implementation commit checked out by that run: `77a996ac1932b7b9b53264b79e4352d6626c5cc0`.
- Controlled remote evidence artifact: `10731586089` (`w02-role-assignment-d1-01-remote-evidence-77a996ac1932b7b9b53264b79e4352d6626c5cc0`), digest `sha256:c0ca99774f398fbd77f0df83901f3e556a158a0ea906939009f46ef6dc4b5fd7`.
- This closes the previously pending D1-01 migration/readback sub-gate only. It does not promote AUTH-002, ENT-SESSION, or Mapping 0.

## Governance boundaries

- Do not add `User.layer`.
- Do not create a second session identity or parallel full sessions table.
- Do not synthesize `accountState` in W01/W02.
- Do not treat source code or unit tests as controlled remote runtime evidence.
- Do not repeat the already-passing W02 unit/type/migration-generation tests unless the source or contracts change.

## Next cursor

`E6 Runtime-002 / W02 deployment + W01→W02 binding evidence`

Remaining execution sequence:
1. execute the already-authorized W02 deployment against the exact admitted source commit;
2. execute W01 `W02_AUTH` binding deployment against its exact source commit;
3. then generate the controlled authLogin/authRefresh runtime evidence package;
4. register the resulting executable evidence without promoting stale or documentation-only records;
5. resolve AUTH-013 separately before any dependent account-state runtime claim is promoted.

Prerequisite before public auth runtime wiring:
1. resolve the existing AUTH-013 account-state authority/implementation gap under its own contract/change-control path;
2. execute the already-authorized W02 deployment and D1-01 migration workflows;
3. execute W01 `W02_AUTH` binding deployment;
4. then produce controlled authLogin/authRefresh runtime evidence against the exact deployed source commit.


## Superpowers continuation — W02 deployment verified; W01 binding CI blocker isolated — 2026-09-23

### W02 deployment evidence
- Controlled W02 deployment workflow run `35816952574` = **SUCCESS**.
- Exact source checkout: `0c0c250f1f2ec6da38a8b3c50834d74a4999f5da`.
- Worker: `luckread-w02`.
- Cloudflare Current Version ID: `7eb5d373-14b3-4354-9d72-af72c1a0a6cc`.
- Deployment used fixed Wrangler `4.116.0` and the configured `D1_01 -> luckread` binding.
- This is fresh W02 deployment evidence at a later source head than the earlier W02 deployment record; it does not prove W01 `W02_AUTH` binding.

### W01 `W02_AUTH` binding attempt
- Controlled W01 binding workflow run `35816996216` = **FAILURE**.
- Exact source checkout: `0c0c250f1f2ec6da38a8b3c50834d74a4999f5da`.
- Failure occurred at `pnpm install --frozen-lockfile` before binding verification, build, or deployment.
- Runner output reports `ERR_PNPM_IGNORED_BUILDS` for `esbuild`, `sharp`, `unrs-resolver`, and `workerd`.
- Therefore this run is **not** W01 binding failure evidence and does not establish or invalidate the Service Binding itself.

### Repair applied
- GitHub `main` commit `d64d7527564239a487a6e0ad6dceb1b5e8dac3b9` adds `workers/W01-payload/pnpm-workspace.yaml`.
- The file explicitly allows build scripts only for the packages reported by the failed install; unrestricted dependency build execution was not enabled.
- Current pnpm documentation confirms unreviewed dependency build scripts can fail installation under `strictDepBuilds`, while explicit `allowBuilds` entries are the supported control. Reference: https://pnpm.io/settings/build.

### Current cursor
- W02 deployment: **PASS_VERIFIED** at tested source scope.
- W01 `W02_AUTH` deployment/binding: **TODO_VERIFY**; pending a controlled rerun after the dependency-install repair.
- Do not repeat W02 migration/deployment.
- Required next external execution: dispatch `W01 W02 Auth Binding Deploy` with `source_sha=d64d7527564239a487a6e0ad6dceb1b5e8dac3b9` and `confirm=DEPLOY_BINDING`.
- Only after a successful W01 binding deployment should the existing controlled `authLogin/authRefresh` runtime evidence path be executed.
