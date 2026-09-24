# AUTH-013 Remote Transition Runtime Evidence Admission — 2026-09-24

## Scope

This control admits one non-public, CI-only runtime evidence path for AUTH-013.

It executes the already-admitted W02 function:

`workers/W02-content/src/account/account-state-transition.ts`

against the real Cloudflare D1-01 binding using an ephemeral Wrangler remote development session. It does not add a production route, Worker, Service Binding, or D1.

## Exact admitted implementation

- Source commit: `763a857759233c5a23d7bd733a72e0729b20a373`
- W02 Worker: `luckread-w02`
- D1-01: `luckread`
- D1-01 UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`

## Controlled evidence sequence

1. Fail closed unless the target `users` table is empty.
2. Fail closed unless the AUTH-013 publication journal is empty.
3. Insert one synthetic User row using the already-migrated physical fields.
4. Invoke the actual W02 transition kernel against the remote D1 binding.
5. Verify `users.account_state` becomes `RESTRICTED` and `account_state_version` advances from 1 to 2.
6. Verify exactly one `auth_013_publication_journal` row is committed with source version 2 and the canonical event payload.
7. Re-run the same transition with stale expected version 1 and require canonical `CONFLICT`, with no duplicate journal.
8. Delete the synthetic User and Journal rows and fail if cleanup is incomplete.

## Evidence boundary

A PASS proves:

- W02 transition code executes in the Cloudflare Worker runtime against the real D1-01 binding.
- Account State and publication Journal are durably committed together through the admitted `D1Database.batch()` path.
- Canonical event metadata survives round-trip through D1.
- A stale If-Match version does not advance the state or create a duplicate Journal entry.
- The synthetic evidence data is removed before the workflow completes.

A PASS does **not** prove:

- public HTTP `transitionAccountState` transport through W01;
- W06 queue consumption or idempotency;
- D1-03 AuditEvent persistence;
- token/session invalidation;
- cache invalidation/deindex convergence;
- security/integration E2E outside this controlled probe;
- overall AUTH-013 GREEN.

## Non-goals

- no production public route;
- no new Worker or D1;
- no change to Payload `Users.ts`;
- no direct W01 D1 authority;
- no modification to canonical state-machine or event contracts.
