# LuckRead Content Distribution Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Envelope

Every event contains:

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

## 2. Core Events

```text
distribution.created
distribution.eligible
distribution.rejected
distribution.scheduled
distribution.dispatched
distribution.delivered
distribution.partially_delivered
distribution.failed
distribution.withdraw_requested
distribution.withdrawn
distribution.version_replaced
distribution.replay_requested
distribution.converged
```

## 3. Delivery Semantics

Events use at-least-once delivery. Consumers must be idempotent and tolerate duplication and out-of-order delivery.

## 4. Retry / DLQ / Replay

```text
failure
→ bounded retry
→ DLQ
→ operator/system diagnosis
→ replay
→ convergence verification
```

Replay must preserve causal references and must not create a duplicate authoritative distribution.

## 5. Cross-Domain Events

Content, Rights, Creator, Moderation, Search, Recommendation and Analytics may publish/consume related events. Distribution events never redefine their authority.

## 6. Security

Events must carry references rather than unnecessary sensitive payloads. Secrets, private evidence and internal policy thresholds are prohibited.

## 7. Acceptance

- duplicate event does not duplicate state;
- delayed event cannot overwrite a newer version;
- DLQ item can be replayed safely;
- withdrawal event reaches all registered consumers eventually;
- event schema is versioned and auditable.
