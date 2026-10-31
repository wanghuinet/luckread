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


## 7. Durable trial lifecycle audit actions (W06)

WEB trial start and cancellation use W01 authorization and immutable W06 audit records:

```text
membership.subscription.trial_requested
membership.subscription.trial_cancel_requested
membership.subscription.trial_started
membership.subscription.trial_canceled
```

The start intent is recorded before W07 writes the D1-01 Subscription and trial row. The cancellation intent is also recorded before W07 mutates the Subscription and is replayed by stable semantic event identity; the final start/cancel result uses a stable event ID and source timestamp. W06 records describe user intent and subscription lifecycle evidence; they are not payment facts.

App Store and Play Store trial state is reconciled from a current RevenueCat customer snapshot only after W02 verifies the App User ID against the authenticated subscriber and W07 resolves the immutable store-product binding. Store purchase and renewal facts remain under App Store/Google Play and RevenueCat; an unverified webhook body or client field cannot start a trial or grant access.

A WEB trial may be canceled while TRIALING or after its first MIT attempt has moved the Subscription to PAST_DUE. Cancellation sets cancel_at to trial_ends_at and blocks new retries while keeping access through the trial period. If a payment was already submitted before cancellation and the signed provider outcome later succeeds, the same Subscription may still convert to CONVERTED/ACTIVE; otherwise it expires at the trial boundary.
