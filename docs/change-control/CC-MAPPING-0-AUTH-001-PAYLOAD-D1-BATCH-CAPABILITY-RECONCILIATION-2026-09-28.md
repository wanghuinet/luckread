# CC-MAPPING-0-AUTH-001-PAYLOAD-D1-BATCH-CAPABILITY-RECONCILIATION-2026-09-28

## Status

`RECONCILED_CAPABILITY_GAP / AUTH-001_RUNTIME_REMAINS_BLOCKED`

## Purpose

Record the exact Payload 3.87.1 + Cloudflare D1 capability boundary behind the current AUTH-001 atomicity blocker.

This control does **not** authorize runtime implementation, does **not** change the registration Contract, and does **not** weaken the requirement that Payload-native User/password handling remain authoritative.

## Authoritative current repository state

- Repository: `wanghuinet/luckread`
- Current `main`: `c59c783217b6b0e37b970d5d7c3c795ec808bbeb`
- Active cursor: `artifacts/mapping-0/current-execution-cursor-2026-09-27.json`
- Active gate: `AUTH-001` D1-compatible atomic W01 registration boundary
- Diagnostic runtime: `36361411407`
- Diagnostic source SHA: `cf443d44d58aab6e5ca8569285345f188df1d714`
- Existing blocker control: `CC-MAPPING-0-AUTH-001-D1-ATOMIC-WRITE-BOUNDARY-2026-09-28`

## Finding 1 — Payload 3.87.1 transaction path is SQLite/Drizzle transaction based

The exact Payload tag `v3.87.1` provides the following implementation:

1. `packages/db-d1-sqlite/src/index.ts` passes `args.transactionOptions` into the SQLite/Drizzle adapter.
2. The same adapter installs Payload's `beginTransaction` implementation only when `transactionOptions` is supplied; otherwise it uses the default no-transaction boundary.
3. `packages/drizzle/src/transactions/beginTransaction.ts` starts a Drizzle `this.drizzle.transaction(...)` and stores the transaction handle in the adapter session registry.
4. `commitTransaction.ts` resolves that Drizzle transaction and `rollbackTransaction.ts` rejects it.

Therefore enabling Payload `transactionOptions` does **not** switch the adapter to Cloudflare D1's `D1Database.batch()` primitive. It selects the generic Drizzle SQLite transaction path.

### Source references

- Payload `v3.87.1`: `packages/db-d1-sqlite/src/index.ts`
- Payload `v3.87.1`: `packages/drizzle/src/transactions/beginTransaction.ts`
- Payload `v3.87.1`: `packages/drizzle/src/transactions/commitTransaction.ts`
- Payload `v3.87.1`: `packages/drizzle/src/transactions/rollbackTransaction.ts`
- Payload `v3.87.1`: `packages/db-d1-sqlite/src/types.ts`

Repository source URL:

https://github.com/payloadcms/payload/tree/v3.87.1

## Finding 2 — The observed Cloudflare runtime rejects the selected transaction mechanism

The controlled AUTH-001 runtime probe recorded:

`D1_ERROR: To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.`

This failure occurred during Payload migration initialization, before the AUTH-001 HTTP probe.

The failure is therefore a runtime capability mismatch, not a Contract or test-harness omission.

## Finding 3 — Cloudflare D1's atomic multi-statement primitive is batch

Current Cloudflare D1 documentation states that:

- D1 operates in auto-commit;
- `D1Database.batch()` sends multiple prepared statements in one database call;
- batched statements are SQL transactions;
- if a statement fails, the full batch sequence is aborted/rolled back.

Source:

https://developers.cloudflare.com/d1/worker-api/d1-database/

This is the primitive that matches the existing AUTH-001 requirement for an atomic W01 User + consent + registration-envelope outcome.

## Finding 4 — Payload-native password semantics are available but the concrete helper is not a stable public export

Payload `v3.87.1` implements native local registration through:

- `packages/payload/src/auth/strategies/local/register.ts`
- `packages/payload/src/auth/strategies/local/generatePasswordSaltHash.ts`

The registration strategy generates the native salt/hash, removes the plaintext password from the persisted document, and creates the User through the Payload database adapter.

The exact password helper is an internal module. Payload `v3.87.1` package exports expose the documented package entrypoints but do not export the local registration/hash helper as a stable public subpath.

Therefore:

- reimplementing the hash algorithm in LuckRead would create a second password implementation and is **not authorized**;
- forking or modifying Payload Core is **not authorized**;
- blindly importing an unpublished internal source path is not an accepted production contract boundary.

## Reconciliation

The existing Contract remains unchanged:

```text
authRegister
  -> W01 is authoritative writer
  -> Payload-native User/password authority
  -> ENT-CONSENT
  -> AUTH-001 registration envelope
  -> one atomic W01 commit
  -> W02/D1-01 eventual identity/credential materialization
```

The current Payload 3.87.1 D1 adapter does not provide that atomic W01 commit boundary against actual Cloudflare D1.

Accordingly, the implementation gate remains:

```text
NOT AUTHORIZED
    ↓
Do not remove atomicity requirement
    ↓
Do not introduce a parallel auth system
    ↓
Admit a minimal W01 integration boundary only after its exact
native-auth + D1.batch semantics are proven
```

## Permitted solution boundary

Any future implementation admission must satisfy **all** of the following:

1. Use Cloudflare D1 `batch()` (or a demonstrably equivalent existing Payload/D1 capability) as the actual atomic commit primitive.
2. Preserve Payload-native User/password semantics; no custom password hashing.
3. Preserve the existing `authRegister` Contract and exact idempotency replay semantics.
4. Keep W01 as the single authoritative registration writer.
5. Do not add a Worker, D1 database, Queue, or generic transaction/idempotency service.
6. Do not modify Payload Core.
7. Provide same-SHA runtime evidence covering success, rollback/failure, replay, and uniqueness/conflict behavior.

## Non-authorizations

This Change Control does **not** authorize:

- removing `transactionID`/atomicity from AUTH-001;
- committing User, consent, and envelope separately;
- direct ad-hoc SQL User persistence;
- copying Payload's password hashing algorithm into LuckRead;
- creating a second password/authentication subsystem;
- changing W01/D1 topology;
- promoting AUTH-001, ENT-CONSENT, Mapping 0, or Evidence Registry to GREEN.

## Next controlled gate

The next admissible change is a **minimal W01 integration-layer design/admission** proving how the exact Payload-native authentication semantics are retained while the final D1 writes are composed into `D1Database.batch()`.

Until that design is proven, the runtime gate remains:

`BLOCKED_D1_TRANSACTION_CAPABILITY / AUTH-001_RUNTIME_NOT_ADMITTED`

## Provenance

- Backup branch: `backup/pre-auth001-d1-batch-capability-reconciliation-20260928`
- Change branch: `fix/auth001-d1-batch-capability-reconciliation-20260928`
- This document records capability reconciliation only and introduces no runtime implementation.
