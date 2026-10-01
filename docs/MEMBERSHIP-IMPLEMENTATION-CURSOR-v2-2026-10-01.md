# Membership Implementation Cursor v2 — 2026-10-01

Subscription state machine
→ W07 implementation admission
→ W07→W02 trusted access-state persistence
→ D1-01 persisted optimistic version
→ entitlement convergence
→ Payment Provider Event Admission
→ lifecycle/payment/entitlement E2E
→ Evidence Registry

## Completed in this batch

- Subscription reconciliation without adding new lifecycle states.
- D1-01 Subscription + EntitlementGrant field/persistence contracts.
- Persisted Subscription.version for real optimistic concurrency.
- W02 atomic D1-01 persistence kernel for subscription + entitlement convergence.
- W07→W02 internal binding contract and client.
- W07 subscription creation path connected to W02.
- W07 controlled D1-01 migration workflow now checks the persisted version field.
- Payment-provider callback admission boundary documented without inventing a provider.
- Current W01-facing transition boundary hardened to self-service ACTIVE→CANCELED only; W02 enforces subscriber ownership and entitlement-to-subscription scope.
- Existing API contract IDs reconciled without invention: createSubscription, cancelSubscription (If-Match / ETag CAS), getSubscription, getEntitlements, checkEntitlement.

## Still blocked

- Controlled remote D1-01 migration execution/evidence.
- Concrete provider adapter/signature contract.
- Trusted payment success source for ACTIVE.
- Remote lifecycle/payment/entitlement E2E.
- Evidence Registry verification.
- Public API implementation remains blocked until the corresponding Mapping 0/API admission and remote security/E2E evidence are complete.

No new Worker, no new D1, no direct W07 D1-01 binding, and no client-authoritative payment state.
