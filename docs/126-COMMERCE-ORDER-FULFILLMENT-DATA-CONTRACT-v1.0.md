# LuckRead Commerce Order / Fulfillment Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE**

## 1. Authoritative Entities

```text
OrderExecution
OrderLineExecution
InventoryItem
InventoryReservation
Fulfillment
FulfillmentLine
Delivery
ReturnRequest
AfterSalesCase
FulfillmentDispute
ProviderReference
```

## 2. Common Rules

Every mutable entity requires `id`, `status`, `version`, `createdAt`, `updatedAt`; every externally triggered mutation requires idempotency protection.

## 3. Inventory Invariants

```text
available + reserved + unavailable = total
reserved >= 0
available >= 0
consume <= reserved
release <= reserved
```

No cache may mutate authoritative inventory.

## 4. Order / Fulfillment Relations

```text
OrderExecution 1 → N OrderLineExecution
OrderExecution 1 → N Fulfillment
Fulfillment 1 → N FulfillmentLine
Fulfillment 1 → N Delivery
OrderExecution 1 → N ReturnRequest
ReturnRequest 1 → 0..1 AfterSalesCase
```

Partial fulfillment is first-class.

## 5. Provider References

Provider identifiers are references only and must not replace LuckRead authority.

## 6. Sensitive Data

Address/contact/after-sales evidence references are purpose-limited and must be excluded from ordinary logs.

## 7. Money Boundary

Monetary facts remain governed by 65 and 68; this contract stores references and operational amounts only where necessary and uses integer minor units.

## 8. Versioning

State changes use optimistic concurrency through `version` / expected-version semantics.

## 9. Rebuildability

Dashboard and tracking projections are rebuildable from authoritative execution records and events.

## 10. Status

```text
DATA = COMPLETE
IMPLEMENTATION = PENDING
```
