# Change Control: Membership Public Mutation Idempotency Authority Gap — 2026-10-01

- Status: BLOCKED / AUTHORITY_DECISION_REQUIRED
- Scope: `createSubscription` and `cancelSubscription` public mutation admission
- Affected path: W01 → W07 → W02 / D1-01

## Finding

The public Membership contract requires Idempotency-Key semantics, including safe replay of the completed result and rejection of same-key/different-input reuse. The current bounded W07→W02 implementation validates the header and uses optimistic versioning, but does not yet persist a Membership-specific idempotency record.

The canonical D1 domain mapping assigns operational idempotency records to D1-03. W07 is not currently bound directly to D1-03, and introducing a new Worker/D1 binding solely for this gap would violate the frozen 12-Worker / 4-D1 topology.

## Control decision

1. Do not expose `createSubscription` or `cancelSubscription` as public success paths yet.
2. Do not emulate idempotency with process memory, cache, or client-selected subscription state.
3. Do not place operational idempotency rows into D1-01 Membership tables unless a canonical domain decision explicitly changes that ownership.
4. The next admission step must identify an existing approved D1-03 operational-idempotency authority and an existing Worker/service path, or explicitly reconcile the ownership contract before implementation.
5. Until then, the bounded W07 lifecycle kernel and W01 authenticated `getSubscription` read path remain valid implementation slices, but are not public mutation GREEN evidence.

## Evidence / related authority

- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/09-D1-DOMAIN-MASTER-v1.0.md`
- `docs/305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md`
- `contracts/api/rc-04-06-share-subscription-entitlement.v1.json`
- `contracts/api/interaction-operation-policy.v1.json`
- `contracts/admission/W07-subscription-implementation-admission.v1.json`

## STOP conditions

- No public Membership mutation route is promoted to GREEN without durable replay semantics.
- No new D1 or Worker is created for idempotency.
- No direct W01 membership D1 write is introduced.
