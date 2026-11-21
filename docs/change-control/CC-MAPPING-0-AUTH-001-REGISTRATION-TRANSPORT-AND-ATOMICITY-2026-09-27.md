# CC-MAPPING-0-AUTH-001-REGISTRATION-TRANSPORT-AND-ATOMICITY-2026-09-27

## Status

`TRANSPORT_RECONCILED / ATOMIC_PERSISTENCE_BLOCKED`

## Scope

Narrow the remaining AUTH-001 registration gate using the already-admitted W01 -> W02 internal transport. No new Worker, D1, public endpoint, queue type, Payload fork, or topology change is introduced.

## Existing transport authority

The repository already has an admitted and runtime-verified W01 -> W02 HTTP Service Binding:

- caller: W01;
- binding: W02_AUTH;
- callee: W02 (luckread-w02);
- direction: W01 -> W02;
- purpose: governed AUTH/T01/T03 calls;
- W01 remains public API/Gateway;
- W02 remains Identity/Account/Authorization authority and D1-01 owner;
- no direct W01 D1-01 authority is granted.

The transport decision explicitly requires operation IDs, wire schemas, timeout/retry/failure behavior and mutation idempotency to be bound to existing contracts before runtime acceptance.

The deployment/transport evidence already verifies the binding at runtime. This is inherited; it is not rerun by this change.

## AUTH-001 implication

AUTH-001 resource policy permits:

- `rpcMax = 1`;
- `outboundMax = 0`.

Therefore one internal W01 -> W02 Service Binding call is compatible with the resource envelope. `outboundMax=0` is not a reason to forbid the already-admitted internal transport.

This closes the transport-mechanism question.

## Remaining atomicity problem

The current authority model simultaneously establishes:

1. W01 is the public API/Gateway edge and has no authoritative D1 write ownership.
2. W02 is the sole D1-01 Identity/Account/Authorization writer.
3. Payload-native User authentication remains the required password boundary in W01.
4. ENT-IDENTITY and ENT-CREDENTIAL persistence belong to the D1-01 authority.
5. AUTH-001 declares `SINGLE_AUTHORITATIVE_WRITE` with `d1WriteMax=1` and `d1WriteRowsMax=4`.

The repository does not currently contain a transaction contract that spans the W01 Payload User write and the W02 D1-01 identity/credential write.

A simple sequence such as:

`W01 create Payload User -> W02 create Identity/Credential`

would create two independent persistence authorities and a partial-failure window. It also cannot be described as one D1 mutation under the current operation budget.

The inverse sequence has the same failure-window problem.

A cross-worker compensation path would add additional writes and would no longer satisfy the current single-write envelope.

## No implicit solution

This control therefore does not authorize any of the following by inference:

- W01 direct writes to `auth_identities` or `auth_credentials`;
- a second D1 writer;
- distributed database transactions;
- a new saga/compensation framework;
- a new queue/event type for registration materialization;
- Payload Core modification;
- bypass of the existing Payload-native password boundary.

## Next governed gate

The next Change Control must explicitly admit one of two facts, based on existing architecture/contracts rather than code inference:

1. a concrete single-writer transaction boundary that owns the complete registration persistence outcome while preserving Payload-native password handling; or
2. an explicit eventual-consistency/reconciliation contract stating that AUTH-001 completion is allowed before Identity/Credential materialization, including the authoritative state machine, replay/idempotency, failure recovery and admission semantics.

Until one of those contracts exists, the registration runtime implementation remains unauthorized.

## Result

Closed:

- public API edge authority = W01;
- identity/account D1 authority = W02/D1-01;
- W01 -> W02 transport mechanism;
- registration field/entity vocabulary subset;
- Payload-native password boundary;
- User-ID authority;
- first account-state persistence semantics.

Blocked:

- registration internal wire operation contract;
- atomic-vs-eventual registration persistence semantics;
- consent persistence authority;
- concrete authRegister handler;
- executable security/anti-abuse/integration evidence;
- Evidence Registry admission;
- Mapping 0 promotion.
