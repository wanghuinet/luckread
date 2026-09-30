# CC-MAPPING-0-AUTH-003-TASK-POLICY-AUTHORITY-ADMISSION-2026-09-27

Status: **CLOSED — AUTHORITY ADMITTED / RUNTIME STILL BLOCKED**

## Scope

This Change Control admits the Feature → Contract Task edge and the AUTH-003 Operation Policy values required before runtime/persistence implementation.

## 1. Task edge admission

Canonical authority chain:

`AUTH-003 → T01 → W02 → D1-01`

Basis:

- W02 is the canonical Identity / Account / Authorization Worker.
- W02 owns T01/T02/T03.
- AUTH-003 is explicitly the Identity credentials capability: username/email/phone credential lifecycle.
- T02 is profile/lifecycle-oriented.
- T03 is authorization-policy-oriented.
- Therefore T01 is the direct Contract Task boundary for AUTH-003.

Status: **ADMITTED / PASS_VERIFIED_LOGICAL_MAPPING**

This is an explicit Change Control decision; it is not inferred merely from directory or domain naming.

## 2. Operation Policy admission

The canonical AUTH-003 profile is admitted using the project cost-first rules, existing authentication policy precedents, the frozen self-scope contract, and the requirement that authorization-bound credential resources are never shared-cacheable.

### authCredentialList
- resource: `BOUNDED_READ`
- D1 reads: 1
- D1 writes: 0
- read rows: 100
- write rows: 0
- RPC: 0
- outbound: 0
- cache: `NO_STORE`, shared=false, authorizationBoundary=true
- retry: maxAttempts=1, clientRetrySafe=true
- events: sync=0, async=0, fanout=0
- queue: enqueueMax=0
- anti-abuse: required; scopes account/identity/device/endpoint; actions ALLOW/THROTTLE/CHALLENGE/BLOCK

### authCredentialAdd
- resource: `SINGLE_AUTHORITATIVE_WRITE`
- D1 reads: 2
- D1 writes: 1
- read rows: 8
- write rows: 4
- RPC: 0
- outbound: 0
- cache: `NO_STORE`, shared=false, authorizationBoundary=true
- retry: maxAttempts=1, clientRetrySafe=true
- idempotency: required via `Idempotency-Key`
- events: sync=0, async=0, fanout=0
- queue: enqueueMax=0
- anti-abuse: required; scopes account/identity/device/endpoint; actions ALLOW/THROTTLE/CHALLENGE/BLOCK

### authCredentialReplace
- resource: `SINGLE_AUTHORITATIVE_WRITE`
- D1 reads: 2
- D1 writes: 1
- read rows: 8
- write rows: 4
- RPC: 0
- outbound: 0
- cache: `NO_STORE`, shared=false, authorizationBoundary=true
- retry: maxAttempts=1, clientRetrySafe=true
- idempotency: required via `Idempotency-Key`
- events: sync=0, async=0, fanout=0
- queue: enqueueMax=0
- anti-abuse: required; scopes account/identity/device/endpoint; actions ALLOW/THROTTLE/CHALLENGE/BLOCK

### authCredentialRemove
- resource: `SINGLE_AUTHORITATIVE_WRITE`
- D1 reads: 2
- D1 writes: 1
- read rows: 8
- write rows: 4
- RPC: 0
- outbound: 0
- cache: `NO_STORE`, shared=false, authorizationBoundary=true
- retry: maxAttempts=1, clientRetrySafe=true
- idempotency: required via `Idempotency-Key`
- events: sync=0, async=0, fanout=0
- queue: enqueueMax=0
- anti-abuse: required; scopes account/identity/device/endpoint; actions ALLOW/THROTTLE/CHALLENGE/BLOCK

## 3. Event/queue disposition

No AUTH-003-specific event or queue contract is currently required by the frozen feature semantics. Zero event/queue budgets are therefore admitted rather than inventing a new asynchronous side effect.

Future event/queue behavior requires a separate Contract change.

## 4. Security and cost rationale

- No shared cache because credential resources are self/authorization-bound.
- No cross-Worker RPC or outbound dependency because the current feature contract can be satisfied inside W02/D1-01.
- Mutations are single authoritative write boundaries and carry idempotency.
- D1 budgets are bounded and use the smallest read/write counts consistent with uniqueness and lifecycle checks.
- Anti-abuse is mandatory before credential-management work to avoid turning credential mutations into an expensive or enumerable attack surface.
- Payload remains the native authentication substrate for user/password/recovery behavior; AUTH-003 does not introduce a duplicate password/recovery system.

## 5. Non-actions

This admission does not:
- promote ENT-IDENTITY or ENT-CREDENTIAL to VERIFIED;
- invent physical tables, columns, indexes, or constraints;
- execute MIG-AUTH-003-CREDENTIAL-V1;
- claim runtime correctness;
- create Evidence Registry PASS;
- promote Mapping 0 GREEN.

## 6. Next gate

AUTH-003 implementation is now blocked only by the remaining executable persistence/runtime admission inputs:

1. actual D1-01 schema/migration evidence;
2. exact tested-commit deployment/runtime evidence;
3. same-SHA security/negative/concurrency evidence.

After those inputs are captured, the smallest admitted implementation slice is:

`authCredentialAdd → persistence uniqueness boundary → idempotency → authorization/security-negative → durable evidence`
