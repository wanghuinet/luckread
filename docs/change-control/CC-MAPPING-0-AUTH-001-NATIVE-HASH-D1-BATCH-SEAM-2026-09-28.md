# CC-MAPPING-0-AUTH-001-NATIVE-HASH-D1-BATCH-SEAM-2026-09-28

## Status

`DESIGN_ADMITTED / IMPLEMENTATION_NOT_YET_AUTHORIZED`

## Purpose

Admit the minimum W01 integration-layer design needed to reconcile the existing AUTH-001 registration Contract with the real Cloudflare D1 transaction boundary, without creating a parallel authentication system or modifying Payload Core.

This Change Control is a design admission. It does not claim runtime success, persistence verification, Evidence Registry promotion, or Mapping 0 GREEN.

## Current authority

- Repository: `wanghuinet/luckread`
- Current main at design start: `c59c783217b6b0e37b970d5d7c3c795ec808bbeb`
- Active cursor: `artifacts/mapping-0/current-execution-cursor-2026-09-27.json`
- Active gate: `AUTH-001::D1-compatible atomic commit boundary reconciliation`
- Prior capability control: `docs/change-control/CC-MAPPING-0-AUTH-001-PAYLOAD-D1-BATCH-CAPABILITY-RECONCILIATION-2026-09-28.md`
- Prior runtime blocker: `docs/change-control/CC-MAPPING-0-AUTH-001-D1-ATOMIC-WRITE-BOUNDARY-2026-09-28.md`
- Backup branch: `backup/pre-auth001-native-hash-d1-batch-seam-20260928`
- Change branch: `fix/auth001-native-hash-d1-batch-seam-20260928`

## Contract that must not change

The existing AUTH-001 contract remains authoritative:

```text
public authRegister
  -> W01 authoritative registration writer
  -> Payload-native User/password authority
  -> ENT-CONSENT
  -> AUTH-001 registration envelope
  -> one atomic W01 commit
  -> W02/D1-01 eventual identity/credential materialization
```

The following semantics remain unchanged:

- Payload-native password handling remains authoritative.
- User + consent + registration envelope commit atomically.
- `Idempotency-Key` semantics remain the existing canonical contract.
- A completed replay returns the first `{userId, accountState}` result.
- No direct W01 -> D1-01 identity/credential write.
- No new Worker, D1 database, Queue, generic transaction service, or generic idempotency platform.
- No Payload Core fork.

## Design decision

Use a **registration-scoped W01 integration seam** that separates two responsibilities which are currently coupled inside Payload's generic SQLite transaction path:

### A. Payload remains responsible for native authentication semantics

The registration flow continues to call the existing Payload Local API create path for the authenticated `users` collection.

Payload therefore remains the authority for:

- registration field validation;
- username/email uniqueness checks;
- native password validation;
- native password salt generation;
- native password hash generation;
- native auth document shaping.

The design does **not** copy Payload's password hashing algorithm into LuckRead.

### B. W01 owns only the D1-specific atomic commit seam

For the admitted registration context, the W01 integration layer captures the final native User persistence intent produced by Payload and converts the complete registration write set into a fixed D1 prepared-statement plan.

The final plan contains exactly the contracted registration-local writes:

1. native Payload User row;
2. ENT-CONSENT row;
3. AUTH-001 registration-envelope row/finalization.

The plan is executed with one `D1Database.batch()` call.

Cloudflare documents `D1Database.batch()` as sequential, transactional execution of prepared statements; failure of a statement aborts/rolls back the entire batch. citeturn211747search0turn626246search0

## User ID handling

The active W01 physical `users` table uses an integer primary key in the Payload baseline, while the public `ResourceId` contract is an opaque string.

The design therefore MUST NOT invent a new UUID user-ID persistence model.

The batch plan must allow SQLite/D1 to allocate the native User integer ID and must derive that ID in later statements from authoritative database state within the same batch.

Because D1 batch statements execute sequentially and later statements can observe earlier writes, the admitted implementation may use a deterministic SQL lookup keyed by the already-normalized, uniqueness-controlled registration identity to bind the consent/envelope rows to the newly inserted User.

The implementation MUST prove that this lookup cannot select an older User under concurrent registration. The preferred binding key is the already-authoritative unique User field set (email and/or username), and the exact lookup predicate must be admitted by a focused test before runtime promotion.

A batch result may then be queried/read back after the batch to obtain the canonical User ID for the HTTP 201 response. D1 returns one result object per prepared statement in batch order. citeturn626246search0turn626246search1

## Transaction dependency rule

D1 batch is a fixed prepared-statement list. Any value required to construct later statement bindings must therefore be available before `batch()`.

The implementation must complete all non-mutating reads and deterministic computations before the batch, including:

- request normalization;
- idempotency-key lookup;
- policy admission and `retentionUntil` calculation;
- native password/hash preparation through Payload;
- uniqueness preflight where required by the existing Payload path.

The final batch itself contains writes only, except for any tightly-scoped deterministic read statement explicitly required to recover the newly committed User ID. No cross-worker call may be introduced into the batch.

## Idempotency semantics

The existing registration-local envelope remains the canonical idempotency record.

The implementation must preserve:

- same key + same payload + COMPLETED -> first 201 response;
- same key + same payload + IN_PROGRESS -> 409 `IDEMPOTENCY_IN_PROGRESS`;
- same key + different payload -> 422 `IDEMPOTENCY_KEY_REUSE_CONFLICT`;
- expired key -> new request.

The active-key uniqueness constraint must remain the concurrency guard.

A failed D1 batch must leave no partial User, Consent, or envelope mutation.

## Payload integration constraint

The seam must be implemented at the W01 integration boundary, not by editing Payload Core.

It must not rely on an undocumented fork of Payload source.

It may use existing Payload adapter/runtime interfaces only where their behavior is stable enough to be verified by same-SHA runtime evidence.

An unpublished internal import of Payload's password-hash helper is **not** the basis of this design. The design instead requires the native Payload create path itself to produce the native hash material before the integration seam assembles the D1 batch.

## Scope restriction

The seam is registration-specific.

It must not become:

- a generic D1 transaction framework;
- a general-purpose SQL builder;
- a generic ORM replacement;
- a second authentication service;
- a second password implementation;
- a generic idempotency service.

No topology expansion is admitted.

## Required implementation evidence before admission

A future implementation PR must demonstrate, on one exact source SHA:

1. successful registration creates exactly one User, one Consent, and one registration envelope;
2. plaintext password never reaches persistence;
3. stored password hash/salt are produced by Payload-native auth;
4. the entire write set is committed by one D1 `batch()`;
5. forced failure of a later batch statement rolls back the User and all registration-local rows;
6. same-key replay returns the original response without another User;
7. same-key/different-payload produces the canonical conflict;
8. concurrent duplicate identity/username registration cannot attach the envelope to the wrong User;
9. returned `userId` matches the committed User row;
10. `accountState=PENDING_VERIFICATION` and version 1 are preserved;
11. development-only PRIV-004 policy `DEV-2026-09-28.1` is used only for controlled development evidence;
12. no W02, D1-01 identity/credential mutation occurs as part of registration commit.

## Explicit non-authorizations

This control does not authorize:

- merging PR #114;
- applying a new registration migration;
- direct production D1 mutation;
- deployment of W01 for AUTH-001;
- promotion of ENT-IDENTITY or ENT-CREDENTIAL;
- Evidence Registry promotion;
- Mapping 0 GREEN.

## Next controlled step

The next implementation slice is limited to the W01 registration-scoped batch seam described here, with approximately one cohesive integration module plus the smallest required registration wiring/test surface.

Before runtime admission, the implementation must pass Contract CI and the focused same-SHA development evidence workflow.

## External capability evidence

Cloudflare's current D1 documentation confirms that `D1Database.batch()` accepts an ordered array of prepared statements, executes them sequentially, and rolls back the batch on failure. citeturn211747search0turn626246search0

Payload 3.87.1's release notes state that this version includes a Cloudflare D1 template fix, but the exact package source used by W01 still exposes the generic Drizzle/SQLite transaction path rather than a D1 `batch()` transaction boundary. citeturn211747search8
