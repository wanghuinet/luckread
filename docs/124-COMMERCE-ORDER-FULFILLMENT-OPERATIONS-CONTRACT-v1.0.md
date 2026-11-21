# LuckRead Commerce Order / Fulfillment Operations Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：Commerce 领域下的订单执行、库存、履约、交付、退货、售后与争议操作权威；不创建第二 Commerce / Ledger Authority。**

## 1. 定位

65 号 Commerce Contract 定义 Product / Offer / Order / Entitlement / Payment / Refund 等商业事实边界。本合同补齐 Commerce 的**订单执行与履约操作深度**，使 Commerce 从交易创建延伸到完整可恢复的履约生命周期。

本合同属于 Commerce Authority 的执行子域，不是新的顶层财务或商品权威。

```text
Commerce
├── Product / Offer
├── Pricing / Promotion
├── Order
├── Payment Boundary
├── Entitlement
├── Refund / Cancel
└── Fulfillment Operations
    ├── Inventory
    ├── Allocation
    ├── Delivery
    ├── Return / After-sales
    └── Dispute
```

## 2. Authority

本合同拥有：

```text
order execution state
inventory availability / reservation state
fulfillment task state
delivery state
return / after-sales state
fulfillment dispute state
```

不得拥有：

```text
User Identity
Creator Identity
Content ownership
Legal Rights
Payment provider final fact
Financial Ledger
Wallet balance
Advertising campaign fact
```

## 3. L1-L4 Capability Model

### L2-01 Order Execution

- L3 Order acceptance
  - L4 validation
  - L4 risk eligibility reference
  - L4 inventory/entitlement availability reference
  - L4 acceptance timestamp
- L3 Order state
  - L4 CREATED
  - L4 CONFIRMED
  - L4 PROCESSING
  - L4 FULFILLING
  - L4 COMPLETED
  - L4 CANCELLED
  - L4 FAILED
  - L4 DISPUTED
- L3 Order line execution
  - L4 line status
  - L4 quantity
  - L4 fulfillment reference

### L2-02 Inventory

- L3 Inventory item
  - L4 sku/reference
  - L4 location/reference
  - L4 available quantity
  - L4 reserved quantity
  - L4 unavailable quantity
- L3 Inventory reservation
  - L4 reserve
  - L4 extend
  - L4 release
  - L4 consume
- L3 Inventory consistency
  - L4 idempotency key
  - L4 expected version
  - L4 reconciliation reference

### L2-03 Fulfillment Planning

- L3 Fulfillment order
  - L4 fulfillmentId
  - L4 orderId
  - L4 line references
  - L4 destination reference
- L3 Allocation
  - L4 inventory allocation
  - L4 fulfillment provider allocation
  - L4 partial allocation
- L3 Plan lifecycle
  - L4 PLANNED
  - L4 ALLOCATED
  - L4 READY
  - L4 DISPATCHED
  - L4 COMPLETED
  - L4 FAILED

### L2-04 Delivery / Digital Entitlement Delivery

- L3 Physical delivery
  - L4 carrier/provider reference
  - L4 shipment reference
  - L4 tracking reference
  - L4 delivered timestamp
- L3 Digital delivery
  - L4 entitlement grant reference
  - L4 activation reference
  - L4 download/access reference
- L3 Delivery state
  - L4 PENDING
  - L4 IN_TRANSIT
  - L4 DELIVERED
  - L4 FAILED
  - L4 RETURNED

### L2-05 Return / After-Sales

- L3 Return request
  - L4 reason
  - L4 line references
  - L4 evidence reference
  - L4 request timestamp
- L3 Return lifecycle
  - L4 REQUESTED
  - L4 REVIEWING
  - L4 APPROVED
  - L4 IN_TRANSIT
  - L4 RECEIVED
  - L4 ACCEPTED
  - L4 REJECTED
  - L4 COMPLETED
- L3 After-sales action
  - L4 replacement
  - L4 partial refund reference
  - L4 full refund reference
  - L4 entitlement revocation reference

### L2-06 Cancellation / Exception

- L3 Cancellation
  - L4 pre-fulfillment cancellation
  - L4 partial cancellation
  - L4 provider cancellation
- L3 Exception handling
  - L4 timeout
  - L4 provider outage
  - L4 inventory shortage
  - L4 address/delivery failure
  - L4 duplicate execution
- L3 Recovery
  - L4 retry
  - L4 compensation reference
  - L4 manual intervention reference

### L2-07 Fulfillment Dispute

- L3 Dispute creation
  - L4 reason
  - L4 evidence
  - L4 order/fulfillment reference
- L3 Dispute lifecycle
  - L4 OPEN
  - L4 INVESTIGATING
  - L4 RESOLVED
  - L4 REJECTED
  - L4 ESCALATED
- L3 Resolution
  - L4 replacement
  - L4 refund reference
  - L4 entitlement adjustment reference
  - L4 settlement reference

### L2-08 Fulfillment Governance

- L3 Provider management
  - L4 provider identity
  - L4 capability
  - L4 SLA reference
- L3 Operational controls
  - L4 pause
  - L4 resume
  - L4 replay
  - L4 emergency stop
- L3 Audit
  - L4 actor
  - L4 action
  - L4 resource
  - L4 reason
  - L4 timestamp

## 4. Core State Machines

### Order

```text
CREATED
→ CONFIRMED
→ PROCESSING
→ FULFILLING
→ COMPLETED
```

Exception paths:

```text
CREATED / CONFIRMED / PROCESSING → CANCELLED
PROCESSING / FULFILLING → FAILED
Any eligible state → DISPUTED
```

### Inventory Reservation

```text
REQUESTED
→ RESERVED
→ CONSUMED
```

or:

```text
RESERVED → RELEASED
```

### Fulfillment

```text
PLANNED
→ ALLOCATED
→ READY
→ DISPATCHED
→ COMPLETED
```

### Return

```text
REQUESTED
→ REVIEWING
→ APPROVED
→ RECEIVED
→ ACCEPTED
→ COMPLETED
```

## 5. Data Contract

Minimum authoritative entities:

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

Minimum common fields:

```text
id
status
version
idempotencyKey
orderId
sourceReference
actorReference
createdAt
updatedAt
```

Inventory quantity must use deterministic integer units; monetary fields follow 65 / 68 contracts and use minor units.

## 6. API Contract

Representative endpoints:

```text
POST /v1/orders/{id}/confirm
POST /v1/orders/{id}/cancel
GET  /v1/orders/{id}/execution
POST /v1/inventory/reservations
POST /v1/inventory/reservations/{id}/release
POST /v1/inventory/reservations/{id}/consume
POST /v1/fulfillments
GET  /v1/fulfillments/{id}
POST /v1/fulfillments/{id}/dispatch
POST /v1/fulfillments/{id}/complete
POST /v1/fulfillments/{id}/retry
POST /v1/returns
GET  /v1/returns/{id}
POST /v1/returns/{id}/approve
POST /v1/returns/{id}/receive
POST /v1/returns/{id}/complete
POST /v1/after-sales/cases
POST /v1/fulfillment-disputes
```

Mutations require authentication, authorization, idempotency, expected-version protection, stable errors, correlation IDs and audit where sensitive.

## 7. Event Contract

Representative events:

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

Every event carries stable eventId, eventType, schemaVersion, producer, resourceRef, occurredAt, correlationId and dedupe/idempotency information.

## 8. Reliability

必须处理：

```text
duplicate order confirmation
duplicate inventory reservation
reservation timeout
provider timeout
partial fulfillment
out-of-order callbacks
stale version
return/refund race
retry after success
```

原则：一次业务成功不能因重复消息产生第二次库存扣减、第二次履约、第二次退款或第二次权益变更。

## 9. Cross-Domain Boundary

```text
Commerce Operations
→ Payment Boundary (65)
→ Entitlement (65)
→ Ledger / Settlement (68)
→ Rights (64)
→ Risk / Trust (62)
→ Moderation (63)
→ Creator / Merchant attribution (76 / 116)
```

Payment callback 必须经过 65 的支付状态机；资金事实进入 68；数字权益变化进入 Commerce Entitlement；版权权限由 64 决定。

## 10. Cloudflare-First Runtime

```text
Workers
→ D1 authoritative commerce execution state
→ Queues asynchronous fulfillment / callbacks / retries
→ Cache/KV hot non-authoritative availability views
→ R2 evidence / media references where applicable
→ Durable Objects only for narrowly scoped strong coordination
```

不得因为第三方履约服务变慢而阻塞普通查询路径。

## 11. Security

至少区分：

```text
CUSTOMER
MERCHANT
MERCHANT_STAFF
FULFILLMENT_OPERATOR
SUPPORT
FINANCE_REVIEWER
PLATFORM_ADMIN
```

越权访问订单、库存、地址、售后证据和商家经营数据必须被拒绝。

## 12. Privacy

配送地址、联系方式、售后证据等属于敏感业务数据；必须最小化、按用途访问、避免进入普通日志与分析事件。

## 13. Observability

关键执行链必须可追踪：

```text
requestId
correlationId
orderId
fulfillmentId
providerReference
eventId
```

故障不得依赖人工查看底层数据库才能定位。

## 14. Rebuildability

非权威视图必须可重建：

```text
Order execution dashboard
Inventory summary views
Fulfillment monitoring views
Delivery tracking views
After-sales dashboard
```

权威执行状态与事件历史丢失不得通过缓存恢复。

## 15. Acceptance

P0 至少验证：

1. order confirm 幂等；
2. cancellation race；
3. inventory reservation/release/consume；
4. partial fulfillment；
5. digital entitlement delivery；
6. provider callback duplication；
7. delivery failure retry；
8. return lifecycle；
9. refund/entitlement synchronization；
10. dispute resolution；
11. stale-version rejection；
12. queue retry / DLQ / replay；
13. merchant staff scope enforcement；
14. sensitive logistics data isolation；
15. reconciliation with Commerce / Ledger。

## 16. STOP Conditions

- 建立第二个 Order Authority；
- 库存可被缓存直接扣减；
- 重试产生重复 fulfillment；
- 履约状态绕过订单状态机；
- 退款直接覆盖历史资金事实；
- 售后直接修改 Ledger；
- 数字权益不经过 Entitlement；
- 商家员工绕过 scope；
- provider callback 可重复造成副作用；
- 无法从权威状态和事件恢复执行状态。

## 17. Status

```text
CAPABILITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
