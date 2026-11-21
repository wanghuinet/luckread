# CC-MAPPING-0-AUTH-001-D1-ATOMIC-WRITE-BOUNDARY-2026-09-28

## Status

`BLOCKED_D1_TRANSACTION_CAPABILITY_GAP / AUTH-001_RUNTIME_NOT_ADMITTED`

## Trigger

The AUTH-001 development implementation was exercised against the existing W01 Payload + D1 runtime boundary before any production deployment.

Controlled runtime evidence:

- workflow: `AUTH-001 Development Local Runtime Evidence`
- run: `36361411407`
- tested source SHA: `cf443d44d58aab6e5ca8569285345f188df1d714`
- result: `FAIL`
- failure phase: Payload migration initialization, before the AUTH-001 HTTP probe

The failure is:

`D1_ERROR: To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.`

Payload 3.87.1's generic SQLite transaction documentation requires `transactionOptions: {}` to enable SQLite transactions, and its Local API transaction path uses `beginTransaction / commitTransaction / rollbackTransaction`. The W01 D1 runtime rejects that SQL transaction mechanism.

Cloudflare D1 is auto-commit and defines atomic multi-statement work through `D1Database.batch()`; a batch is the D1 transaction boundary.

## Reconciliation result

The currently admitted AUTH-001 implementation contract requires:

1. W01 Payload is the authoritative registration commit boundary.
2. User + ENT-CONSENT + AUTH-001 registration envelope must commit atomically.
3. Payload native User/password handling remains authoritative.
4. No direct W01 -> D1-01 identity/credential write.
5. No new Worker/D1/Queue.
6. No Payload Core fork.

The current Payload Local API transaction mechanism cannot satisfy item 2 against the actual D1 adapter/runtime boundary.

Exact Payload 3.87.1 capability reconciliation is recorded in `docs/change-control/CC-MAPPING-0-AUTH-001-PAYLOAD-D1-BATCH-CAPABILITY-RECONCILIATION-2026-09-28.md`. It confirms that the installed D1 adapter selects the generic Drizzle transaction path when `transactionOptions` is enabled; it does not translate the Payload transaction session into Cloudflare `D1Database.batch()`.

This is a genuine capability mismatch, not a test-harness defect and not a reason to weaken the contract.

## Non-authorizations

Until this Change Control is reconciled:

- AUTH-001 runtime is NOT admitted.
- PR #114 MUST NOT be merged.
- No production W01 deployment is authorized for AUTH-001.
- No direct SQL write of the native User record is authorized as a workaround.
- No custom password hashing or parallel authentication system is authorized.
- No generic transaction/idempotency service is authorized.
- No new Worker/D1/Queue is authorized.
- Mapping 0 and Evidence Registry remain NOT_GREEN.

## Required next reconciliation

A D1-compatible atomic commit mechanism must be explicitly reconciled with the existing Payload-native User boundary before implementation resumes.

The admissible design space is limited to an existing Payload/D1 capability or a minimal W01 integration-layer change that preserves:

- Payload-native password hashing/auth semantics;
- D1 `batch()` atomicity;
- one authoritative W01 write boundary;
- exact replay/idempotency semantics;
- no Payload Core modification;
- no topology expansion.

No implementation choice is inferred from this record.

## Evidence boundary

The failed runtime run is diagnostic evidence for the capability gap only. It does not promote AUTH-001, ENT-CONSENT, the registration envelope, Mapping 0, or the Evidence Registry.

The previously successful Foundation / typecheck / lint / build / implementation-admission checks remain valid static evidence and are not being re-run merely because this capability gap exists.
