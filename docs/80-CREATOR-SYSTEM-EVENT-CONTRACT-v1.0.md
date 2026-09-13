# LuckRead Creator System Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System 事件与异步传播合同**

## 1. 目的

事件用于传播 Creator authority 已经发生的业务事实，不重新定义事实，不成为第二数据库。

标准：

```text
Authority mutation
→ committed state
→ domain event
→ Queue / consumer
→ derived projections
```

## 2. Event Envelope

每个事件必须包含：

```text
eventId
eventType
schemaVersion
occurredAt
producer
actorId
resourceType
resourceId
correlationId
requestId
idempotencyKey
causationId
payload
```

事件 payload 不得包含不必要的秘密或敏感证据。

## 3. Core Events

### Identity / Profile

```text
creator.created
creator.updated
creator.profile.updated
creator.handle.changed
creator.type.changed
```

### Qualification / Verification

```text
creator.qualification.evaluated
creator.qualification.changed
creator.qualification.expired
creator.qualification.appealed
creator.verification.requested
creator.verification.approved
creator.verification.rejected
creator.verification.expired
creator.verification.revoked
```

### Capability / Lifecycle

```text
creator.capability.granted
creator.capability.restricted
creator.capability.revoked
creator.lifecycle.transitioned
creator.suspended
creator.reinstated
creator.deactivated
creator.deletion.requested
creator.deletion.completed
```

### Ownership / Collaboration

```text
creator.authorship.created
creator.authorship.updated
creator.authorship.ended
creator.collaboration.proposed
creator.collaboration.accepted
creator.collaboration.rejected
creator.collaboration.completed
creator.collaboration.terminated
```

### Standing / Governance

```text
creator.standing.changed
creator.notice.created
creator.policy.acknowledged
creator.appeal.created
creator.appeal.updated
```

## 4. Delivery Semantics

默认：

```text
at-least-once
+ idempotent consumer
+ replayable
```

事件顺序仅在明确声明的 aggregate key 内要求有序；跨 Creator 不假设全局顺序。

## 5. Consumer Rules

消费者必须：

- 使用 eventId 去重；
- 支持重复投递；
- 支持乱序保护；
- 处理 poison message；
- 支持 retry；
- 支持 DLQ；
- 支持 replay/backfill；
- 不把派生结果写回为 Creator authority。

## 6. Event-to-Projection

允许：

```text
creator.updated
→ cache invalidation
→ public profile projection
→ search indexing
→ analytics update
```

不允许：

```text
cache/index/analytics
→ creator authority overwrite
```

## 7. Cross-Domain Events

Creator System 可消费：

```text
organization.membership.changed
content.published
content.restricted
rights.changed
risk.standing.changed
moderation.completed
ledger.revenue.attributed
```

Creator System 只能据此更新 Creator-side state/projection；跨域事实仍由原领域拥有。

Creator System 可生产供其他域消费的事件，例如：

```text
creator.created
creator.capability.changed
creator.lifecycle.transitioned
creator.standing.changed
creator.authorship.changed
creator.collaboration.changed
```

## 8. Privacy / Security

事件总线不是权限绕过通道。消费者必须验证：

```text
consumer identity
→ allowed event type
→ allowed scope
→ minimum payload
```

敏感字段默认不进入通用广播事件。

## 9. Failure / Recovery

```text
publish failed
→ retry
→ backoff
→ DLQ
→ alert
→ replay
```

事件发布失败不得撤销已经提交的 Creator authoritative mutation；必须通过可靠的 outbox/transactional publication strategy 或等价机制保证可恢复传播。

## 10. Runtime

Cloudflare-first：

```text
D1 authority
→ event publication
→ Queues
→ Workers consumers
→ Cache / projections / indexes
```

需要强协调时才引入 Durable Objects；不得为了普通事件传播强制引入外部消息中间件。

## 11. Acceptance

至少验证：

- event schema stable；
- eventId unique；
- duplicate delivery safe；
- out-of-order handling；
- retry + DLQ；
- replay/backfill；
- sensitive payload redaction；
- failed consumer does not block authority；
- derived projection can be rebuilt；
- cross-domain events do not create second authority。

## 12. STOP

- Event is treated as authority；
- consumer can bypass authorization；
- no idempotency；
- no DLQ/replay；
- sensitive evidence broadcast；
- failed event silently lost；
- event consumer overwrites another domain authority。

## 13. Status

```text
EVENT CONTRACT = COMPLETE
IMPLEMENTATION = PENDING
CL / CI = NOT RUN
```
