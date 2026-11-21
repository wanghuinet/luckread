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
