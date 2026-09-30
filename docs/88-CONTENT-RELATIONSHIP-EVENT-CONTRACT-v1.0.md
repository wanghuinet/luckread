# LuckRead Content Relationship Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Event Envelope

所有关系事件统一携带：

```text
eventId
eventType
schemaVersion
producer
resourceRef
actorId (nullable)
sourceRef
targetRef
occurredAt
correlationId
requestId
idempotencyKey
```

## 2. Event Types

```text
content.relationship.created
content.relationship.updated
content.relationship.revoked
content.provenance.recorded
content.provenance.disputed
content.provenance.resolved
content.version.created
content.version.superseded
content.attribution.changed
content.translation.created
content.remix.created
content.derivative.created
content.adaptation.created
content.series.attached
content.collection.attached
content.ip.attached
```

## 3. Delivery Semantics

```text
Producer → Queue → Consumer
```

默认：at-least-once delivery + idempotent consumer。

要求：

- duplicate-safe；
- out-of-order safe where possible；
- retry with bounded backoff；
- poison event → DLQ；
- replay supported；
- consumer failure 不回滚已提交的关系 authority；
- downstream index failure 不阻断关系写入。

## 4. Consumers

允许：

```text
Search
Recommendation
Analytics
Creator Center
IP projections
Notification
Moderation/Rights reaction
```

消费者只能读取/派生，不得通过事件直接成为 Relationship authority。

## 5. STOP

禁止无 schemaVersion、无 eventId、无 idempotency strategy 的生产事件；禁止事件 payload 携带不必要的敏感身份/法律证据。
