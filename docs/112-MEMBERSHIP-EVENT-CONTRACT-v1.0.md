# LuckRead Membership Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Events

```text
membership.plan.created
membership.plan.activated
membership.plan.paused
membership.plan.retired
membership.subscription.created
membership.subscription.activated
membership.subscription.renewal_due
membership.subscription.renewed
membership.subscription.payment_failed
membership.subscription.grace_started
membership.subscription.paused
membership.subscription.resumed
membership.subscription.plan_changed
membership.subscription.canceled
membership.subscription.expired
membership.entitlement.granted
membership.entitlement.revoked
membership.entitlement.expired
```

## 2. Envelope

```text
eventId
eventType
schemaVersion
producer
resourceRef
actorId
occurredAt
correlationId
requestId
idempotencyKey
```

## 3. Semantics

- at-least-once delivery;
- idempotent consumers;
- retry with bounded backoff;
- poison messages enter DLQ;
- replay must be supported from authoritative state/events;
- out-of-order events must be rejected or reconciled by version/time rules.

## 4. Source Events

Payment/Commerce may publish trusted transaction outcomes. Membership consumes them but does not redefine payment truth.

## 5. Downstream Consumers

```text
Notification
Creator Center
Social/Community projections
Access checks
Analytics
Feed/Recommendation eligibility
```

Downstream failures must not rewrite membership authority.

## 6. Durable plan-change audit actions (W06)

The following request/result actions are persisted as immutable W06 audit records, not treated as payment facts or as entitlement transitions:

```text
membership.subscription.plan_change_requested
membership.subscription.plan_change_scheduled
```

A scheduled record remains pending until a verified successful renewal payment advances the Subscription period. A failed payment leaves the source plan in force and preserves the scheduled record for a retry; pause/cancel/expiration cancels the schedule.
