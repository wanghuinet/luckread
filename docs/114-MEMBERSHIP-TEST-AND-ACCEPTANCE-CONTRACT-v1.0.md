# LuckRead Membership Test & Acceptance Contract v1.0

**状态：TEST-ACCEPTANCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. P0 Functional Acceptance

| Case | Expected |
|---|---|
| Create plan | plan created with version and scope |
| Activate plan | only active plan can sell/subscribe |
| Create subscription | one valid subscription and entitlement state |
| Duplicate create | no duplicate subscription or entitlement |
| Renewal | period extends exactly once |
| Payment failure | enters grace according to policy |
| Recovery | valid recovery restores access |
| Cancel | cancellation follows defined effective time |
| Expire | entitlement expires and access closes |
| Upgrade/downgrade | exactly one valid transition |
| Creator management | creator only manages owned plans |
| Member access | entitlement controls protected access |
| Cache loss | entitlement can be rebuilt from authority |
| Downstream outage | membership authority remains writable/consistent |

## 2. Security Acceptance

Must prove:

- cross-user access denied;
- creator scope enforced;
- organization delegated scope enforced;
- external app scope enforced;
- client cannot forge paid/active state;
- replayed mutation is idempotent;
- sensitive membership data is not leaked;
- admin/support changes are audited.

## 3. Consistency Acceptance

Test:

```text
duplicate payment event
out-of-order cancel/renew
stale cache
retry
replay
period-end boundary
partial downstream failure
```

Expected: one authoritative final subscription state and deterministic entitlement outcome.

## 4. Performance / Cost Acceptance

Verify hot entitlement checks avoid unnecessary full scans and that cache miss safely falls back to authoritative state. Async propagation must use bounded retries and DLQ where applicable.

## 5. Evidence

Every P0 case must record:

```text
caseId
commitSha
runtime
input class
expected
actual
result
timestamp
```

Allowed result states:

```text
PASS
FAIL
BLOCKED
```

BLOCKED is not PASS.

## 6. Phase 2 Tier & Founding Offer Acceptance

- Existing fixed-price plan creation, revision, replay, publication and checkout resolution remain backward compatible.
- Flexible pricing accepts the exact minimum, suggested and maximum; rejects below/above range, fractional, unsafe, negative and malformed values.
- Fixed plans reject flexible range fields; flexible plans reject ambiguous fixed-price input.
- Order creation rejects a buyer-selected amount for fixed plans and requires a valid selected amount for flexible plans.
- The immutable order-line snapshot preserves selected amount, price mode, range, currency and plan version after later plan revisions.
- Concurrent founding reservations at the final available seat never oversell across all plan versions; same-plan parent-row serialization and subscriber/idempotency advisory locking are verified.
- STANDARD/FOUNDING invariants are enforced by both W07 validation and PostgreSQL: FOUNDING is FIXED-only, the first founding capacity cannot be changed/reset by later versions, and reservation rows reference an existing immutable plan version.
- Duplicate reservation retries reuse the same reservation; reusing one subscriber/idempotency key for another plan/version conflicts. Order creation stores the reservation ID in the immutable line snapshot and attaches the D1-04 order reference; retry after an interrupted attach repairs the same order without consuming another seat.
- A failed payment attempt must not release the hold while another payment attempt for the order is pending, succeeded, unknown or otherwise nonterminal. Reconciliation releases only orders with no payment attempt or all attempts terminally unpaid after the five-minute grace period.
- Payment intent validates the hold before and after finance attempt persistence; a race that releases the hold prevents provider-intent creation. A delayed signed success commits only when finance `confirmed_at` is before hold expiry and the order snapshot points to the matching reservation.
- Signed success commits the founding seat before membership fulfillment. Duplicate webhook delivery retries the commit idempotently. Released/expired/committed reservations cannot be silently reopened or double-committed.
- Creator ownership, stale If-Match, idempotency-key body mismatch and missing durable audit all fail closed.
- Refund/chargeback/termination seat-restoration behavior remains BLOCKED until its explicit product decision is admitted; tests must prove no implicit seat restoration.
- PostgreSQL 18 migration rehearsal verifies fresh schema, upgrade compatibility, source/template parity and rollback/recovery behavior. No remote DDL is authorized by this contract change.

