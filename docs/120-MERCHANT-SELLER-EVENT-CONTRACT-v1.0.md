# LuckRead Merchant / Seller Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Event Types

```text
merchant.created
merchant.updated
merchant.qualification.submitted
merchant.qualification.approved
merchant.qualification.rejected
merchant.restricted
merchant.suspended
merchant.reinstated
store.created
store.updated
store.paused
store.resumed
store.closed
merchant.staff.invited
merchant.staff.joined
merchant.staff.role_changed
merchant.staff.removed
merchant.fulfillment.updated
```

## 2. Envelope

Every event must include:

```text
eventId
eventType
schemaVersion
producer
resourceRef
actorId (nullable)
merchantId
storeId (nullable)
occurredAt
correlationId
idempotencyKey
```

## 3. Delivery

At-least-once delivery is required. Consumers must be idempotent and support bounded retry, DLQ and replay.

## 4. State Safety

An event may propagate merchant/store state but must not be interpreted as payment, ledger, rights or order authority.

## 5. Cross-Domain Events

Commerce, Payment, Ledger, Risk, Creator and Analytics consumers receive references and facts according to their own contracts; no consumer may silently rewrite Merchant authority.
