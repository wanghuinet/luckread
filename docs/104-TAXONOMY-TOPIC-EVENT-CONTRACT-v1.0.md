# LuckRead Taxonomy / Topic / Hashtag / Entity Event Contract v1.0

**状态：EVENT-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Events

```text
taxonomy.created
taxonomy.updated
taxonomy.deprecated
topic.created
topic.updated
topic.merged
topic.split
topic.restricted
topic.archived
hashtag.normalized
hashtag.retired
classification.created
classification.updated
classification.removed
trend.state_changed
localization.updated
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

Events communicate taxonomy/classification state changes to Search, Feed, Recommendation, Analytics, Creator Center and moderation consumers. Consumers must treat these as source events, not replace the authority.

## 4. Reliability

At-least-once delivery, idempotent consumers, bounded retries, DLQ and replay are mandatory. A replayed merge/split must not produce duplicate canonical topics.
