# CC-MAPPING-0-AUTH-001-IDEMPOTENCY-SOURCE-GATE-2026-09-27

## Status

`IDEMPOTENCY_PERSISTENCE_NOT_BOUND / IMPLEMENTATION_BLOCKED`

## Finding

AUTH-001 requires:

- `Idempotency-Key`;
- `same-request-replay-must-not-create-second-account`;
- `clientRetrySafe=true`;
- one authoritative registration outcome.

The current repository contains the AUTH-001 policy requirement, but current-source searches do not identify an admitted AUTH-001 registration idempotency persistence record, table, handler or request-hash binding.

The repository does contain a general architectural placement for operational idempotency under D1-03 and an implemented AUTH-013 publication-journal/consumer-idempotency pattern. Those are separate authorities and are not automatically bound to AUTH-001.

## Why this blocks registration recovery

With the already-established W01 -> W02 call boundary, a registration attempt may still have this failure window:

`Payload User created in W01 -> W02 identity materialization fails`

Without a durable AUTH-001 request identity/idempotency record, a later replay cannot safely distinguish:

- the same request that is resuming a partially completed registration; from
- a different anonymous request repeating the same identity.

Blindly resuming from the existing User row could create an account-takeover path, while blindly retrying User creation can create duplicates or expose uniqueness-conflict semantics.

Therefore the current Idempotency-Key requirement is contractually present but not executable/evidence-bound for the registration implementation.

## Existing authority that is NOT silently reused

- D1-03 operational idempotency remains its own domain authority.
- AUTH-013 publication-journal idempotency is specific to `identity.account_state_changed` publication and downstream consumer processing.
- AUTH-003 mutation idempotency is scoped to credential-management operations.
- None of those records may be reused as AUTH-001 registration idempotency without an explicit contract binding.

## Fail-closed disposition

This gate does not:

- add a generic idempotency platform;
- add a new D1;
- create a new table;
- create a queue;
- change AUTH-001 budgets;
- modify Payload Users;
- implement authRegister.

## Next governed gate

The next AUTH-001 Change Control must bind a durable idempotency authority that can safely distinguish same-request replay from unrelated account-registration attempts and define:

1. request-key scope;
2. request fingerprint/hash semantics;
3. stored outcome state;
4. replay response semantics;
5. partial-registration recovery semantics;
6. TTL/retention;
7. security/privacy constraints;
8. owning Worker/D1;
9. interaction with the existing single-write/rpc budget.

Only after that binding is explicit can the registration runtime slice be admitted.

Mapping 0 remains NOT_GREEN.
