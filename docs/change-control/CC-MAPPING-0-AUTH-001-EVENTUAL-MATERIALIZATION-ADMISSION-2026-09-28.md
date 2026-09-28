# CC-MAPPING-0-AUTH-001-EVENTUAL-MATERIALIZATION-ADMISSION-2026-09-28

## Status

`CONSISTENCY_MODEL_ADMITTED / IMPLEMENTATION_NOT_AUTHORIZED`

## Base

- main reviewed: `d49329094ed76d1ab1459009ce394d5f32a77cb9`
- backup branch: `backup/pre-auth001-eventual-materialization-admission-20260928`
- work branch: `reconcile/auth001-eventual-materialization-admission-20260928`

## Decision

AUTH-001 uses the already-admitted eventual-consistency model:

`W01 Payload User + ENT-CONSENT + registration envelope commit` → `W02/D1-01 eventual ENT-IDENTITY/ENT-CREDENTIAL materialization`.

The W01 transaction is the completion boundary of the public registration operation. Identity/Credential materialization is not part of that cross-worker transaction and must not be represented as such.

## Authoritative inputs

- `contracts/api/auth-operation-policy.v1.json` — authRegister consistency/resource policy;
- `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-WRITER-BOUNDARY-2026-09-27.md` — W01 commit boundary and W02 eventual materializer;
- `contracts/persistence/AUTH-001-registration-envelope-contract.v1.json` — replay/idempotency source;
- `docs/change-control/CC-MAPPING-0-AUTH-001-IDENTITY-INPUT-AUTHORITY-RECONCILIATION-2026-09-28.md` — admitted AUTH-001 entity participants;
- `contracts/alignment/mapping-batches/AUTH-003-real-evidence-reconciliation.v1.md` — existing ENT-IDENTITY / ENT-CREDENTIAL persistence and normalization authority.

## Admitted consistency semantics

1. `authRegister` is complete after the authoritative W01 transaction commits User, consent and registration envelope.
2. The completed envelope is the durable reconciliation source for subsequent materialization.
3. W02/D1-01 is the sole authority allowed to materialize `ENT-IDENTITY` and `ENT-CREDENTIAL`.
4. Materialization consumes the envelope together with the committed Payload User/native-auth source; it does not introduce a second password store.
5. Materialization is idempotent: an existing identity for the same authoritative `ENT-USER.id` is not duplicated; missing identity/credential rows are reconciled using the already-admitted AUTH-003 rules.
6. The existing W02 scheduled reconciliation is the recovery mechanism. No new Queue, Worker, D1, saga, compensation framework or cross-worker transaction is introduced.
7. A materialization delay does not rewrite the already committed registration response or its W01 idempotency envelope.
8. Failed or incomplete materialization remains a recoverable downstream state; it does not authorize a second public registration commit.
9. Native Payload password material remains exclusively under the Payload User/auth boundary.

## Resource boundary

The existing `authRegister` operation policy remains authoritative:

- `d1WriteMax=1`;
- `rpcMax=1`;
- `outboundMax=0`;
- `crossWorkerTransaction=false`;
- `crossD1Transaction=false`;
- `identityCredentialMaterialization=EVENTUAL`;
- `materializerAuthority=W02_D1-01`;
- `recovery=W02_SCHEDULED_RECONCILIATION`.

No budget expansion is created by this decision.

## Promotion boundary

This Change Control admits the consistency model only. It does not:

- add or authorize a new runtime handler;
- authorize a W02 materialization route;
- authorize a migration;
- claim D1 runtime evidence;
- promote ENT-IDENTITY or ENT-CREDENTIAL;
- promote AUTH-001 to GREEN;
- promote Mapping 0 or the Evidence Registry to GREEN.

Implementation requires a separate minimal W02 execution admission and same-SHA executable evidence. Existing AUTH-003 runtime evidence remains inherited and is not rerun.

## Result

The previously open atomic-vs-eventual consistency choice for AUTH-001 is closed in favor of the architecture already recorded by the operation policy and registration writer boundary. The remaining gate is implementation/evidence, not invention of a second registration consistency architecture.
