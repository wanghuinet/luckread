# Change Control: Membership W07→W02 Access-State Persistence — 2026-10-01

- Status: BOUNDED_IMPLEMENTATION / NOT_GREEN
- Caller: W07 Membership / Commerce
- Persistence owner: W02 / D1-01
- Scope: Subscription creation and lifecycle persistence; EntitlementGrant convergence

## Controls

1. W07 remains the lifecycle decision owner.
2. W02 remains the D1-01 persistence owner.
3. No W07 direct D1-01 binding is added.
4. Subscription version is persisted and incremented atomically under expectedVersion.
5. Entitlement grant/revoke is executed in the same D1-01 batch as the accepted subscription transition.
6. Public clients cannot write subscription status, payment success or entitlement state.
7. Payment-originated ACTIVE transitions remain blocked until a trusted Commerce/Payment decision source is bound.
8. The current W01-facing Membership boundary derives actor=user and permits only ACTIVE→CANCELED; system/creator/admin/payment transitions require a separately admitted trusted source.
9. W07 derives entitlement action from the transition; W01 client input cannot author entitlement grant/revoke semantics.
10. W02 enforces user subscription ownership at the D1-01 read/write boundary.
11. W02 terminal REVOKE derives scope from subscription_id and revokes all ACTIVE grants for that subscription.
12. W07 reads authoritative Subscription status/version from W02 before lifecycle decision; W01-supplied state/version is non-authoritative.
13. The existing getSubscription public read path is implemented as W01→W07→W02, with authenticated L2 self scope; getEntitlements remains blocked by the pre-existing duplicate operationId conflict.

## Gate

- D1-01 migration: controlled workflow, not yet executed.
- W07→W02 service binding: source implemented, remote verification required.
- Lifecycle/payment/entitlement remote E2E: required.
- Evidence Registry: not promoted.
