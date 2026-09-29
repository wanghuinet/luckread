# CC-MAPPING-0-AUTH-013-W04-PROJECTION-EVENT-TRANSPORT-AUTHORITY-2026-09-29

## Status

`ADMITTED_FOR_IMPLEMENTATION`

## Decision

Use direct multi-destination publication from the canonical W02 event producer. The same canonical `identity.account_state_changed` event is delivered independently to the existing W06 audit queue and a dedicated W04 projection queue. W06 remains the audit consumer authority; W04 consumes only for derived Feed/Recommendation/Search projection and deindex reaction.

## Why this is the minimum compliant path

- W02 remains the sole producer and owner of event meaning.
- W06's existing audit queue and consumer authority remain unchanged.
- W04 is not attached to the audit queue, avoiding an invalid broadcast assumption.
- No additional Worker is introduced; W10 remains the async execution boundary rather than becoming an artificial event authority for this feature.
- At-least-once delivery and eventId idempotency already match the platform Event Contract.
- A partial destination failure keeps the durable publication pending; retry may duplicate a successful destination, which is expected and must be absorbed by consumer deduplication.

## New physical delivery resources

- W04 projection queue: `luckread-auth013-account-state-projection`
- W04 projection DLQ: `luckread-auth013-account-state-projection-dlq`
- Consumer: `luckread-w04`

These queue resources are required infrastructure for the admitted contract. They do not become business authority or a fifth D1.

## Runtime implementation boundary

The next implementation slice may change only:
1. W02 publication to address both admitted queues;
2. W04 queue consumer validation/idempotency/deindex projection behavior;
3. controlled queue provisioning and corresponding evidence.

It must not change the account-state state machine, W02 D1-01 authority, W06 D1-03 audit authority, Payload Core, public API semantics, or frozen Worker/D1 counts.

## Acceptance requirements

- both destination queues exist and each has exactly one consumer;
- one state transition produces one logical eventId;
- duplicate delivery produces no duplicate projection side effect;
- out-of-order delivery cannot regress per-resource version;
- W06 audit remains independently durable;
- W04 projection/deindex is derived and non-authoritative;
- failed projection delivery reaches the dedicated DLQ after bounded retries;
- replay is safe and does not resurrect deleted/purged content.

## Provenance

- Current base: `fbc0d8ccd799ac4c975e46497de9dab30928f897`
- Worker Master: `docs/04-WORKER-MASTER-v1.0.md`
- Event Contract: `contracts/events/identity-account-state-changed.v1.json`
- W04 GAP: `docs/change-control/CC-MAPPING-0-AUTH-013-W04-PROJECTION-DEINDEX-GAP-2026-09-29.md`
- Cloudflare queue semantics checked against official documentation dated 2026-04-21/2026-08-25: a queue has one consumer Worker, while a Worker may produce to multiple queues. citeturn511064search4turn511064search1
