# CC-MAPPING-0-AUTH-013-PUBLIC-HTTP-E2E-EXECUTION-READINESS-2026-09-28

## Status

`EXECUTION_READY / AUTH-013_NOT_GREEN`

## Purpose

Record the controlled execution path for the already-authorized
AUTH-013 public transport slice. This control admits evidence acquisition only;
it does not promote runtime behavior to VERIFIED/GREEN and does not authorize
automatic or production deployment.

## Exact scope

- Public endpoint: `POST /v1/users/{userId}/account-state`
- operationId: `transitionAccountState`
- W01 public boundary: `luckread-w01-payload`
- W02 authoritative business execution: `luckread-w02`
- Binding: existing `W02_AUTH`
- Persistence authority: D1-01 / `luckread`
- No Worker/D1/Queue/Binding topology change.

## Execution strategy

The production login/register path is not used for this evidence because
Payload 3.90.2 native password hashing is externally incompatible with the
current Cloudflare Workers PBKDF2 limit. The admitted AUTH-013 transport path
does not require a password-hash operation after a valid Payload access JWT is
available.

The controlled E2E therefore:

1. creates two synthetic D1 users in a disposable fixture;
2. creates Payload-native `users_sessions` rows and the already-contracted
   `auth_session_state` extensions;
3. assigns canonical `user` and `operator` roles through existing
   `role_assignments`;
4. stores only SHA-256 refresh-token hashes in D1;
5. obtains real W01 access JWTs through the existing public `/auth/refresh`
   route;
6. exercises the real public AUTH-013 HTTP route;
7. verifies D1-01 state/journal/session outcomes directly;
8. removes all synthetic rows and verifies cleanup.

No application authorization engine, authentication subsystem, schema or
Worker topology is introduced by this evidence path.

## Source artifacts

- HTTP probe: `scripts/auth-013-public-transport-e2e.mjs`
- Synthetic fixture generator: `scripts/auth-013-public-http-e2e-fixture.mjs`
- Controlled workflow: `.github/workflows/auth-013-public-http-e2e.yml`
- Controlled deployment workflow:
  `.github/workflows/w01-w02-binding-deploy.yml`

## Mandatory provenance

The execution workflow requires:

- exact W01 source commit;
- successful W01/W02 binding deployment run ID;
- controlled W01 public URL;
- controlled D1 database name;
- explicit `RUN_AUTH013_E2E` confirmation.

The workflow verifies the deployment artifact name
`w01-w02-binding-deployment-<source_sha>` before testing.

## Required assertions

The E2E must prove, at minimum:

- unauthenticated public denial;
- mandatory `If-Match`;
- client-supplied actor/permission/approval authority is ignored and cannot
  elevate a lower-layer principal;
- valid operator principal can perform the canonical
  `ACTIVE -> RESTRICTED` transition;
- stale `If-Match` is rejected;
- stale/revoked session is denied before W02 mutation;
- canonical response shape is returned;
- D1-01 state version advances exactly once;
- exactly one durable
  `identity.account_state_changed` journal row is written for the
  successful transition;
- unauthorized user state/journal remain unchanged;
- synthetic fixture cleanup leaves zero test rows.

## Evidence boundary

Until a controlled Actions run completes successfully with exact source
provenance and a durable artifact:

- AUTH-013 remains `NOT_GREEN`;
- Evidence Registry remains fail-closed;
- Mapping 0 remains `NOT_GREEN`;
- no production deployment is inferred;
- local/unit evidence is not reinterpreted as public HTTP runtime evidence.

## Implementation commits

- `cbbc7094cc9b2c23c1135c7bc253ad00101a3092`
  — public transport E2E HTTP probe
- `184730ce757f76ddf1212276281c8787a28644ae`
  — isolated fixture generator
- `5c3a6efe8de78e249993f95662599db93d93bd9e`
  — controlled E2E workflow
- `e944c6b44da5f21528f3307833f12f70739bcec5`
  — generated-fixture environment propagation correction
- `9ce0b99885485c4e67060c8a42fa5d832af9249c`
  — persist non-secret public HTTP assertion result
- `91d8bb9e7fc237671427f4979fe4978fbeb04107`
  — persist stale-session and D1 assertion results
- `0baf20e2c23156ef98dd6e0116f0e25ccf1c1ec7`
  — correct controlled E2E workflow heredoc/import issues

These commits add only evidence-execution tooling; they do not change the
AUTH-013 business runtime implementation or the fixed architecture.

The current evidence tooling head is `0baf20e2c23156ef98dd6e0116f0e25ccf1c1ec7`.
The actual deployment source must still be produced by the controlled W01/W02
binding deployment workflow; no current public runtime deployment is inferred
from these tooling commits.

## Current next action

Run the controlled W01/W02 deployment against the exact current source, then
manually dispatch the AUTH-013 public HTTP E2E workflow with that same source
SHA and deployment run ID. Promote evidence only from the resulting artifact.
