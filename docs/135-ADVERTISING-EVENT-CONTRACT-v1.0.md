# LuckRead Advertising Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / CONTRACT-READY**

## 1. Event Envelope

Every event must contain:

```text
eventId
eventType
schemaVersion
producer
resourceRef
occurredAt
requestId
correlationId
idempotencyKey / dedupeKey where applicable
```

## 2. Lifecycle Events

```text
advertiser.created
advertiser.status_changed
campaign.created
campaign.submitted
campaign.approved
campaign.rejected
campaign.activated
campaign.paused
campaign.completed
creative.created
creative.approved
creative.rejected
```

## 3. Delivery Events

```text
delivery.requested
delivery.decided
delivery.blocked
delivery.served
delivery.failed
```

## 4. Measurement Events

```text
ad.impression
ad.view_start
ad.view_complete
ad.click
ad.engagement
ad.conversion
ad.invalid
ad.disqualified
```

Raw measurement events are evidence; they do not directly become financial facts.

## 5. Attribution / Billing Signals

```text
ad.attribution.completed
ad.billing.candidate_created
ad.billing.candidate_rejected
ad.budget.reconciled
```

These are signals between Advertising, Commerce, Risk and Ledger boundaries. Financial posting remains owned by Ledger/Settlement.

## 6. Policy / Risk Events

```text
ad.policy.review_required
ad.policy.suspended
ad.risk.disqualified
ad.privacy.blocked
```

## 7. Delivery Semantics

At-least-once delivery is assumed. Consumers must be idempotent. Out-of-order delivery must be tolerated through version/timestamp rules appropriate to each state machine.

Queue retries, DLQ and replay are mandatory for asynchronous processing paths.

## 8. STOP

No event consumer may treat an unvalidated raw ad event as final billing, payout or user authority.

## 9. Status

```text
EVENT = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
