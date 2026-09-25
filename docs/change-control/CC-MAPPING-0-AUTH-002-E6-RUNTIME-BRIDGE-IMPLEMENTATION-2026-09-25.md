# Change Control — AUTH-002 E6 Runtime Bridge Implementation — 2026-09-25

- ID: CC-MAPPING-0-AUTH-002-E6-RUNTIME-BRIDGE-IMPLEMENTATION-2026-09-25
- Status: IMPLEMENTED — CI / DEPLOYMENT / RUNTIME EVIDENCE PENDING
- Feature: AUTH-002
- Gate: E6 Native Session Runtime Evidence
- Parent: CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21
- Current main: `6f4aab68e3e9d7f487046331aef36b9f551d5114`

## Implemented scope

The minimum admitted W01↔W02 runtime bridge is now present on `main`.

### W01 API boundary

- `workers/W01-payload/src/app/auth/login/route.ts`
  - validates the contracted `identity`, `credential`, `deviceId` request;
  - authenticates through the native Payload `users` auth collection;
  - observes the native Payload `sid`;
  - calls W02 over the existing `W02_AUTH` Service Binding to establish extension state;
  - returns the contracted access/refresh/layer response;
  - uses `Cache-Control: no-store`.

- `workers/W01-payload/src/app/auth/refresh/route.ts`
  - accepts only `refreshToken` + `deviceId`;
  - delegates authorization/session state to W02;
  - mints a Payload-compatible HS256 access JWT using the initialized Payload secret;
  - caps JWT expiry to the native session `expiresAt`;
  - returns the contracted access/refresh/layer response;
  - uses `Cache-Control: no-store`.

- `workers/W01-payload/src/app/auth/logout/route.ts`
  - authenticates the current native Payload session;
  - invokes the existing Payload REST logout operation to remove the native session;
  - then records durable extension revocation in W02;
  - returns 204 only after both stages succeed.

### W02 authoritative session boundary

- `workers/W02-content/src/session/session-runtime.ts`
  - establishes extension state only after reading native session identity and authoritative `users.account_state`;
  - resolves layer from the canonical RoleAssignment resolver;
  - refreshes only from authoritative native-session + extension + account-state state;
  - rotates refresh credentials with compare-and-update semantics;
  - keeps native `sid` as the sole session identity.

- `workers/W02-content/src/index.ts`
  - `/internal/auth/session/establish`
  - `/internal/auth/session/refresh`
  - `/internal/auth/session/revoke`

These are Service Binding internal transports only; no new public Worker or D1 domain was introduced.

## Explicit non-changes

- Payload core was not modified.
- No second session table or independent session identifier was introduced.
- No new Worker or D1 database was introduced.
- Existing D1-01 RoleAssignment / role_version evidence remains inherited.
- The generated Payload catch-all route was not modified.
- No cache is used as an authorization authority.

## Exact implementation commits

W02:
- `619f25dbe16dfb4bbb2ec48984fd1991d0dd5b81`
- `2d9fa36acd902903454bcb4198581317e3d6bb30`
- `2acf8a061a315fc3b4094a9334c161e2abae445e`
- `6f4aab68e3e9d7f487046331aef36b9f551d5114`

W01:
- `4597e4e8c711dc781eacf436924c74079257489b`
- `215a8a1ffd87920228bc541b8b2c51e434d8d314`
- `7cb447391b2e5488dd8b31516882b4bf69b85cc1`
- `04f211b5efe88edf1f72cbd3341fcf963dae82ef`
- `288a43f5833d1635db55b08246d5fe686ce59e46`
- `fd833d85bbb19840384ae4cae678ab52945917cb`
- `562e7d41a88dd9a1f0cffd440dbf34ff406710d9`

## Acceptance boundary

This record does **not** promote AUTH-002.

Required next evidence:
1. W01 Payload Foundation CI = PASS.
2. W02 Session Runtime / authorization CI = PASS.
3. Controlled deployment of the exact `main` source commit.
4. Controlled remote runtime evidence for login, native sid correlation, refresh rotation/replay denial, logout/revocation, negative security and concurrency.
5. Evidence Registry binding and AUTH-002 promotion-matrix reconciliation.

Until those gates pass, E6 remains NOT_GREEN.
