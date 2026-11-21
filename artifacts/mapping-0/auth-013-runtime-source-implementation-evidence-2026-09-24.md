# AUTH-013 W02 Runtime Source Implementation Evidence — 2026-09-24

## Result

**PASS_VERIFIED — SOURCE_IMPLEMENTATION_ONLY**

## Exact source

- Commit: `d9c663f233329c7c65946026475b44b9d23427ca`
- Worker: W02
- Persistence authority: D1-01 / `users`
- Runtime source:
  - `workers/W02-content/src/account/account-state-transition.ts`
  - `workers/W02-content/src/account/account-state-transition.test.ts`

## Verification

- GitHub Actions Run: [35943346415](https://github.com/wanghuinet/luckread/actions/runs/35943346415)
- Workflow: `W02 AUTH-013 Runtime Source Verification`
- Conclusion: SUCCESS
- TypeScript check: PASS
- Test file: `workers/W02-content/src/account/account-state-transition.test.ts`
- Tests: **13 passed / 13 total**
- Artifact: `10785334505`
- Artifact digest: `sha256:2a26d13e9f3612fd234fe5efc090e606be73d02a5db95778ee194d49a33a2a3e`

## Verified behavior in this slice

- canonical account-state transition lookup is sourced from `contracts/state-machines/account.json`;
- actor type and actor identity are enforced;
- transition permissions are enforced;
- approval requirements are fail-closed;
- lifecycle preconditions are fail-closed;
- stale `If-Match` / expected-version transitions are rejected without mutation;
- successful transitions perform an atomic compare-and-update;
- successful transitions increment `account_state_version` exactly once;
- concurrent compare-and-set races are rejected without a committed state mutation;
- valid user, system/job, operator and admin transition paths are covered by tests;
- forbidden lifecycle transitions are rejected before persistence.

## Related persistence evidence

- Remote migration Run: [35937873769](https://github.com/wanghuinet/luckread/actions/runs/35937873769)
- Remote migration source commit: `b40ae46fe5862c77f935a54adf4bd7e91c69159a`
- D1: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`
- Migration: `0002_auth_013_account_state.sql`
- Remote migration artifact: `10784305258`
- Remote migration artifact digest: `sha256:72c7b323a3a4713a74776a4560980178f8db4eb1691de722729039506d37cf1c`
- Post-schema proof: `users.account_state = TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'`
- Post-schema proof: `users.account_state_version = INTEGER NOT NULL DEFAULT 1`
- Post-migration users count: `0`
- `d1_migrations` records the migration as applied.

## Boundary

This evidence does **not** establish:

- public `transitionAccountState` HTTP transport implementation;
- W01 route wiring;
- W06 audit persistence;
- `identity.account_state_changed` runtime emission;
- authorization-cache invalidation/propagation;
- token/session invalidation side effects;
- feed/search deindex convergence;
- end-to-end security/integration evidence;
- AUTH-013 GREEN status.

## Disposition

The AUTH-013 W02 transition kernel is now source-implemented and execution-verified. The remaining work is downstream side-effect/integration/security evidence, not a repeat of the migration or kernel unit-test slice.
