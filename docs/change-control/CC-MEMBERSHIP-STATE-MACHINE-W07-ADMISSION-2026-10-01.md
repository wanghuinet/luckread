# Change Control: Membership State Machine Reconciliation and W07 Bounded Admission — 2026-10-01

- Status: BOUNDED_IMPLEMENTATION_ADMISSION / MIGRATION_PENDING
- Canonical owner: Membership → W07
- Access-state authority: D1-01
- Financial authority: D1-04 / Commerce / Ledger

## Reconciliation

The existing state machine is retained exactly: PENDING → ACTIVE; ACTIVE ↔ PAST_DUE; ACTIVE/PAST_DUE → CANCELED; ACTIVE/PAST_DUE → EXPIRED; CANCELED and EXPIRED are terminal. No new transition is introduced. Stale-version, replay, out-of-order, payment-boundary and entitlement-convergence rules are explicit.

## Bounded admission

Admitted: pure state transition/reconciliation engine; scoped Subscription + EntitlementGrant D1-01 schema; controlled migration artifact/workflow; unit tests.

Blocked until evidence: public Membership API; trusted Commerce/Payment event ingestion; production entitlement mutation; remote lifecycle/payment/entitlement E2E; Evidence Registry verification.

## STOP

No client can assert payment success, ACTIVE subscription or ACTIVE entitlement. No Social or Ledger duplicate authority is introduced.
