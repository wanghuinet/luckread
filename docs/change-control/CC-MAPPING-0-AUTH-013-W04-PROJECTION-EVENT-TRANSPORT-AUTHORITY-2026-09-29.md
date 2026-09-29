# CC-MAPPING-0-AUTH-013-W04-PROJECTION-EVENT-TRANSPORT-AUTHORITY-2026-09-29

## Status

`WAIT_AUTHORITY_DECISION`

## Scope

Resolve the transport authority required to move the already-admitted `identity.account_state_changed` event from the canonical W02 → W06 audit path to the W04 derived/projection boundary for T08/T09/T10.

## Facts

1. `identity.account_state_changed` is a canonical v1 event.
2. Its current contract names W02 as producer, W06 as consumer authority, and `luckread-auth013-account-state` as its queue.
3. W04 is now a real physical Worker: `luckread-w04`, verified by controlled provisioning Run `36509211004`.
4. The W04 GAP requires feed/recommendation/search projection/deindex convergence from account-state lifecycle changes.
5. The repository does not currently define a compliant W04 fan-out/derived-event transport contract.

## Non-negotiable constraint

Do not attach W04 to `luckread-auth013-account-state` by inference. The existing queue is the admitted W06 audit-consumer boundary; the current contract establishes no broadcast semantics.

Do not invent a new event type, queue, Service Binding, D1 writer, or public API in implementation code before the transport authority is admitted.

## Required decision inputs

The next Change Control must explicitly choose and contract exactly one transport pattern: (a) direct multi-destination publication from W02 with independent W06 audit and W04 projection queues; or (b) an explicit intermediate fan-out/derived-event boundary owned by the canonical Async/Queue Worker and its contract.

Whichever pattern is admitted must define producer/consumer ownership, queue identity, idempotency, ordering, retry/DLQ, security scope, backpressure, observability, and replay semantics. It must preserve W06 audit authority and W04 as derived/projection only.

## Acceptance boundary

Until that decision is admitted:

- W04 physical resource = PASS_VERIFIED;
- W04 projection/deindex implementation = NOT_AUTHORIZED;
- AUTH-013 remains NOT_GREEN;
- no Mapping 0 GREEN promotion occurs.

## Provenance

- Current main: `e73cced0eca9e3a630f06ac793dd8648298725f1`
- W04 provisioning: Run `36509211004`
- W05-W12 provisioning: Run `36509821604`
- Worker Master: `docs/04-WORKER-MASTER-v1.0.md`
- Event contract: `contracts/events/identity-account-state-changed.v1.json`
- W04 GAP: `docs/change-control/CC-MAPPING-0-AUTH-013-W04-PROJECTION-DEINDEX-GAP-2026-09-29.md`
