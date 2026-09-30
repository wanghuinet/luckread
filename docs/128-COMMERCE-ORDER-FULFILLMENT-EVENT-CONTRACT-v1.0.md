# LuckRead Commerce Order / Fulfillment Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE**

## 1. Event Rules

Events are integration signals, not authority transfer. Delivery is at-least-once unless explicitly contracted otherwise. Consumers must be idempotent.

## 2. Event Types

```text
commerce.order.confirmed
commerce.order.cancelled
commerce.order.fulfillment_started
commerce.order.completed
commerce.order.failed
commerce.inventory.reserved
commerce.inventory.released
commerce.inventory.consumed
commerce.fulfillment.created
commerce.fulfillment.allocated
commerce.fulfillment.dispatched
commerce.fulfillment.completed
commerce.fulfillment.failed
commerce.delivery.updated
commerce.return.requested
commerce.return.approved
commerce.return.received
commerce.return.completed
commerce.after_sales.created
commerce.dispute.created
commerce.dispute.resolved
```

## 3. Envelope

Every event includes:

```text
eventId
eventType
schemaVersion
producer
resourceRef
occurredAt
correlationId
idempotencyKey / dedupeKey
```

## 4. Retry / DLQ / Replay

Consumers must support bounded retry, DLQ and replay without creating duplicate inventory consumption, fulfillment or refund side effects.

## 5. Ordering

Where state ordering matters, consumers compare resource version and reject stale transitions.

## 6. Status

```text
EVENT = COMPLETE
IMPLEMENTATION = PENDING
```
