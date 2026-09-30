# LuckRead Content Distribution Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authority

Distribution System owns authoritative distribution intent, target binding, eligibility result reference, delivery lifecycle and convergence state.

## 2. Core Entities

### distribution

```text
distributionId
contentId
contentVersion
targetId
targetType
scope
status
scheduleAt
expiresAt
attempt
idempotencyKey
eligibilitySnapshotRef
rightsSnapshotRef
policySnapshotRef
createdAt
updatedAt
```

### distribution_target

```text
targetId
targetType
channelRef
locale
region
constraints
status
```

### distribution_attempt

```text
attemptId
distributionId
attemptNumber
startedAt
finishedAt
result
failureClass
providerReference
```

## 3. Invariants

- `contentId + contentVersion + targetId` is unique for active authoritative distribution.
- Content must exist and be eligible for the requested target.
- Delivery state changes are versioned and auditable.
- Derived target/read models must be rebuildable.
- No financial, legal-rights or ranking facts are stored as distribution authority.

## 4. State Machine

```text
CREATED
→ ELIGIBILITY_CHECKING
→ ELIGIBLE | REJECTED
→ SCHEDULED | DISPATCHING
→ DELIVERED | PARTIALLY_DELIVERED | FAILED
→ WITHDRAW_REQUESTED
→ WITHDRAWN
```

Stale versions and superseded distributions must be explicitly represented.

## 5. Privacy / Retention

Distribution records follow content visibility, creator authorization and applicable policy. Operational attempt data may have shorter retention than authoritative distribution history, but audit-critical state must remain reconstructable.

## 6. Rebuild

```text
Distribution authority
+ domain events
→ rebuild target projections
→ rebuild cached status
```

Search, feed and analytics indexes are not required for source recovery.
