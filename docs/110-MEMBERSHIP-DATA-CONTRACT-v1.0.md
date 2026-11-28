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

A founding-offer capacity, when configured, is a positive integer on the immutable offer version. Capacity reservation records are separate mutable operational state owned by W07. Reservation records MUST include a stable reservation identity, plan/version reference, order/idempotency reference, state, expiry and timestamps. Capacity decisions MUST be serialized in the W07 membership database, not computed from caches or analytics projections.

Payment/Order records remain in the existing W07 D1-04 authority. No cross-database foreign key or distributed transaction is introduced. The order snapshot carries only the reservation reference needed for idempotent saga reconciliation. Unpaid expired/failed reservations may be released. Whether a paid founding seat is restored after refund, chargeback or subscription termination remains an explicit unresolved product policy and MUST NOT be inferred by runtime code.

