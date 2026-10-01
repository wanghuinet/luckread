# Change Control: Membership Public Mutation Idempotency Authority — 2026-10-01

- Status: RESOLVED_FOR_BOUNDED_IMPLEMENTATION / NOT_GREEN
- Scope: `createSubscription` and `cancelSubscription` public mutation implementation
- Persistence owner: W02 / D1-01
- Lifecycle owner: W07
- Public boundary: W01

## Resolution

The canonical concurrency contract requires the idempotency record and protected business write to commit in the same transaction. Membership Subscription and Entitlement access state already have D1-01 as their authoritative persistence domain and W02 as the persistence boundary.

Therefore the smallest architecture-consistent solution is a **Membership-scoped idempotency record in D1-01**, committed atomically with the Subscription/Entitlement mutation. This is a domain-local replay-protection record, not the generic D1-03/W10 execution-idempotency authority.

No new Worker, D1 or cross-D1 transaction is introduced.

## Admitted semantics

- Same owner + operation + key + same request hash → return the previously committed response without repeating the business mutation.
- Same owner + operation + key + different request hash → `422 IDEMPOTENCY_KEY_REUSE_CONFLICT`.
- Concurrent same-key requests converge at the unique idempotency key and the Subscription version CAS; the losing transaction cannot commit a second state mutation.
- Expired records may be reclaimed after their TTL.
- The authoritative Subscription version remains the If-Match/CAS source; Idempotency-Key does not replace optimistic concurrency.

## Scope controls

1. W02 remains the only D1-01 write boundary.
2. W07 remains the lifecycle decision owner.
3. W01 never writes D1-01 directly.
4. Payment-originated ACTIVE transitions remain separately blocked until a trusted provider authority is admitted.
5. Public GREEN still requires controlled migration execution, runtime/security/concurrency E2E and Evidence Registry reconciliation.
6. No generic idempotency service or new platform database is created.

## Related authority

- `docs/09-D1-DOMAIN-MASTER-v1.0.md`
- `docs/305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md`
- `contracts/persistence/MEMBERSHIP-D1-01-subscription-entitlement-persistence.v1.json`
- `workers/W02-identity/src/membership/access-state-persistence.ts`
- `workers/W07-subscription-commerce/migrations/0001_membership_subscription_entitlement.sql`

## Result

The previous “idempotency authority missing” blocker is resolved for the bounded Membership implementation. Runtime GREEN remains blocked by migration and evidence gates.
