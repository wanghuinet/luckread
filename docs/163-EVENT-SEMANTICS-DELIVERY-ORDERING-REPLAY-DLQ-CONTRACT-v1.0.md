# LuckRead Event Semantics / Delivery / Ordering / Replay / DLQ Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义平台事件的 schema、投递语义、顺序边界、去重、重试、死信、重放和 poison-message 处理，消除各 Domain 各自定义事件语义造成的跨域不一致。

## 2. Event Is a Signal

```text
Event = durable signal about an authoritative state transition
Event ≠ business authority
```

事件不得替代权威记录。

## 3. Canonical Envelope

所有生产事件至少包含：

```text
eventId
eventType
schemaVersion
producer
resourceType
resourceId
occurredAt
publishedAt
correlationId
causationId
idempotencyKey
attempt
sourceVersion
payload
```

禁止把密码、token、支付凭据、私密消息或不必要个人数据放入事件 payload。

## 4. Delivery Semantics

默认语义：

```text
At-least-once
```

需要更强保证时必须显式声明，不得从实现细节推断 exactly-once。

消费者必须幂等。

## 5. Ordering Scope

平台不承诺全局事件顺序。

可以定义：

```text
per-resource ordering
per-aggregate ordering
per-stream ordering
```

事件必须声明 ordering scope。

跨资源顺序必须通过业务版本、时间窗或 reconciliation 解决。

## 6. Deduplication

消费者必须至少能够使用：

```text
eventId
or
producer + idempotencyKey + resourceId
```

执行去重。

去重记录必须有明确 retention 和恢复策略。

## 7. Retry

重试必须区分：

```text
transient failure
permanent failure
poison message
```

要求：

```text
bounded retry
backoff
jitter where appropriate
attempt count
failure classification
```

## 8. DLQ

达到重试上限后进入 DLQ。

DLQ record 至少包含：

```text
eventId
original event metadata
attempt count
last error class
last error summary
firstSeenAt
lastSeenAt
```

DLQ 不等于业务成功，也不等于永久失败；必须存在修复/重放路径。

## 9. Replay

Replay 必须明确：

```text
replayId
source range
selection criteria
target consumer
mode
startedAt
completedAt
result
```

Replay 默认不能再次触发无法接受重复副作用的外部操作。

需要副作用保护时必须使用：

```text
idempotency
replay mode
side-effect suppression
```

## 10. Poison Message

若单条消息因 schema、数据或业务错误持续失败，必须：

```text
isolate
→ classify
→ quarantine
→ alert
→ repair / discard by policy
→ replay if safe
```

禁止 poison message 无限阻塞正常队列消费。

## 11. Schema Evolution

事件 schema 必须版本化。

默认规则：

```text
additive change → compatible
meaning change → new schemaVersion or new eventType
breaking change → compatibility window + migration
```

消费者不能静默解释旧字段为新语义。

## 12. Transaction Boundary

权威写入与事件发布之间必须采用明确的一致性策略。

允许：

```text
transactional outbox / durable publication boundary / equivalent
```

但必须保证：

```text
authoritative state transition
→ durable event intent
```

不会因为 Worker 短暂失败而永久丢失关键事件。

## 13. Out-of-Order Handling

消费者必须依据 resource version / sequence / state machine 判断旧事件。

```text
newer state already applied
→ ignore / record stale event
```

不得因乱序事件把资源从最终状态回退。

## 14. Delete / Tombstone Interaction

删除类事件必须遵守 Data Lifecycle 合同。

已完成 purge 的资源不得因旧 event replay 被重新物化。

## 15. Cross-Domain Events

跨域事件必须保持：

```text
producer owns event meaning
consumer owns derived reaction
```

消费者不得重新定义 producer 的 authority。

## 16. Queue Isolation

不同风险级别/吞吐特征的事件应隔离：

```text
critical domain events
high-volume interaction events
analytics events
external webhook events
batch/replay jobs
```

不得让低价值高吞吐事件阻塞关键业务传播。

## 17. Backpressure

消费者拥塞时必须支持：

```text
bounded concurrency
rate limiting
queue depth monitoring
pause/resume
load shedding where safe
```

Backpressure 不得通过丢弃关键权威事件静默解决。

## 18. Event Security

事件消费同样必须执行：

```text
producer trust
schema validation
scope / authorization where applicable
payload validation
redaction
audit for sensitive consumers
```

“来自内部 Queue”不能自动等于“可信任业务事实”。

## 19. Observability

关键事件链必须可关联：

```text
eventId
correlationId
causationId
resourceId
producer
consumer
attempt
latency
result
```

至少可以定位：产生、排队、消费、失败、DLQ、重放。

## 20. Cost

高频事件必须通过：

```text
aggregation
batching
coalescing
sampling where valid
```

减少无意义 Worker / D1 写放大；不得因此丢失权威状态变更事件。

## 21. Acceptance

P0 至少验证：

1. duplicate event；
2. out-of-order event；
3. transient retry；
4. poison message；
5. DLQ；
6. safe replay；
7. schema version compatibility；
8. missing event detection/recovery；
9. delete event cannot resurrect purged data；
10. high-volume isolation；
11. backpressure；
12. producer/consumer traceability。

## 22. STOP Conditions

- event 被当作 authority；
- 无 eventId 或 schemaVersion；
- 无幂等；
- 无限重试；
- poison message 阻塞队列；
- 无 DLQ；
- replay 可制造重复副作用；
- 乱序事件可以回退权威状态；
- 关键事件可无故永久丢失；
- 删除后 replay 可复活资源。

## 23. READY Gate

```text
Envelope
→ Delivery Semantics
→ Ordering Scope
→ Deduplication
→ Retry / DLQ
→ Replay
→ Schema Evolution
→ Consistency Boundary
→ Security
→ Observability
→ Cost
→ Acceptance Evidence
→ READY
```

## 24. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
