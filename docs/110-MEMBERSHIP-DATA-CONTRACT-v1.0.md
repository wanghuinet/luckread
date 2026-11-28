# LuckRead Membership Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Authoritative Entities

```text
MembershipPlan
Subscription
Entitlement
MembershipPolicy
```

## 2. MembershipPlan

Required:

```text
planId
ownerType
ownerId
version
name
tier
billingInterval
status
visibility
createdAt
updatedAt
```

`planId + version` uniquely identifies a plan definition.

## 3. Subscription

Required:

```text
subscriptionId
subscriberId
planId
planVersion
status
startedAt
currentPeriodStart
currentPeriodEnd
cancelAt
createdAt
updatedAt
```

A subscription has one authoritative current status. Historical transitions are append-only or auditable state changes.

## 4. Entitlement

Required:

```text
entitlementId
subscriptionId
entitlementType
scopeType
scopeId
status
effectiveAt
expiresAt
sourcePlanVersion
createdAt
updatedAt
```

Entitlement is derived from valid subscription state but is authoritative for the platform's current access decision state.

## 5. Privacy / Retention

- subscriber identifiers are private by default;
- public creator member counts are projections;
- payment details are never stored in membership records unless strictly required as opaque provider references;
- audit-required lifecycle history follows platform retention policy;
- deleted users do not cause invalid financial records to be deleted.

## 6. Rebuild / Recovery

```text
Subscription state
→ entitlement rebuild
→ cache rebuild
→ creator/member projections rebuild
```

Caches and projections must be reconstructable without treating them as authority.

## 7. Consistency

Unique keys must prevent duplicate active subscriptions where business policy requires one active subscription per subscriber/plan scope. Upgrades, downgrades and renewals use expected-version checks.

## 8. Creator Offer Pricing (Phase 2 change control)

A MembershipPlan version MUST retain its immutable pricing definition:

- `priceMode`: `FIXED` or `FLEXIBLE`.
- FIXED: `priceMinor` is the sole authoritative unit price; flexible range fields are absent.
- FLEXIBLE: `minimumPriceMinor`, `suggestedPriceMinor`, and `maximumPriceMinor` are required integer minor-unit values with `1 <= minimum <= suggested <= maximum <= 2147483647`. `priceMinor` is not an alternative buyer-selected price.
- Historical rows without `priceMode` are interpreted as FIXED and retain their existing `priceMinor`; no historical snapshot is rewritten.
- All fields are scoped to `planId + planVersion`. A revision creates a new immutable version; existing subscriptions and orders continue to reference their accepted version.

A MembershipPlan version MUST also retain its immutable offer definition:

- `offerKind`: `STANDARD` or `FOUNDING`; legacy omission means STANDARD.
- STANDARD requires `foundingCapacity = null`.
- FOUNDING requires FIXED pricing and a positive integer `foundingCapacity`.
- The first FOUNDING version establishes the lifetime capacity for that plan. Every later version MUST remain FOUNDING and preserve the exact same capacity. Application validation and a PostgreSQL BEFORE INSERT guard enforce this rule; a plan cannot reset seats by publishing a new version.
- Capacity is counted across all plan versions of the same plan.

W07's `membership_founding_reservations` table is the authoritative mutable operational state. It records reservation ID, plan/version, subscriber, idempotency key, optional D1-04 order reference, state (`HELD`, `COMMITTED`, `RELEASED`, `EXPIRED`), expiry, and lifecycle timestamps/reason. The reservation references an existing immutable plan version in the same D1-01 database. A separate append-only payment-event identity row records the verified provider event used to commit a seat.

Capacity decisions MUST serialize on the parent plan row and count authoritative reservation rows, never caches or analytics projections. A hold lasts at most 15 minutes; an expired hold is not released merely because its clock elapsed. After a five-minute reconciliation grace period, W07 releases it only when D1-04 proves there is no payment attempt or every payment attempt is terminally unpaid. Any succeeded, unknown or nonterminal payment retains the hold. Payment-intent creation rechecks the hold after persisting its finance attempt.

Payment/Order records remain in the existing W07 D1-04 authority. No cross-database foreign key or distributed transaction is introduced. W07 creates the D1-01 hold before the D1-04 order write, places the reservation ID in the immutable order-line snapshot, then attaches the order reference. A verified signed success event plus finance-authoritative successful payment/order and the matching order snapshot commits the hold before membership fulfillment. Retries repair interrupted steps; no buyer-supplied reservation ID or capacity is trusted.

Unpaid expired/failed reservations may be released. Whether a paid founding seat is restored after refund, chargeback or subscription termination remains an explicit unresolved product policy and MUST NOT be inferred by runtime code.

