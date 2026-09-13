# LuckRead P0 Social Interaction and Event Contract v1.0

**Status:** READY FOR IMPLEMENTATION

## 1. Scope

Freeze follow, block, mute, privacy, like, favorite, share, comment, reply, mention and high-frequency event semantics.

## 2. Social Graph

Core relations:

- follow
- mutual-follow derived state
- block
- mute-user
- mute-topic
- close-friend/private audience membership

Rules:
- block overrides ordinary social visibility and interaction where policy requires.
- mute suppresses selected distribution/notification without deleting authoritative content.
- follow is an authoritative relation; follower counts are derived.
- privacy policy is evaluated server-side.

## 3. Interaction

Authoritative interactions:
- comment/reply
- favorite
- follow
- block
- report

High-frequency interactions:
- view
- like/reaction where volume requires aggregation
- share event
- dwell/watch progress
- feed exposure

The system may aggregate high-frequency events but must preserve idempotency/event identity where required for correctness.

## 4. Event Envelope

Every event uses:

- `eventId`
- `eventType`
- `eventVersion`
- `actorId` when authenticated
- optional anonymous/session/device reference under privacy policy
- target type/id
- timestamp
- correlation/request ID
- source/client version

No recommendation or revenue system may treat raw events as trusted signals automatically.

## 5. Trust Pipeline

```text
Raw Event
→ Admission
→ Abuse / Trust Checks
→ Valid Signal
→ Aggregation
→ Consumer
```

Consumers may include feed, recommendation, analytics and creator dashboards.

## 6. API Boundary

Minimum contracts:

- `POST /v1/users/:id/follow`
- `DELETE /v1/users/:id/follow`
- `POST /v1/users/:id/block`
- `DELETE /v1/users/:id/block`
- `POST /v1/users/:id/mute`
- `POST /v1/content/:id/like`
- `DELETE /v1/content/:id/like`
- `POST /v1/content/:id/favorite`
- `DELETE /v1/content/:id/favorite`
- `POST /v1/content/:id/share`
- `POST /v1/content/:id/comments`
- `POST /v1/comments/:id/replies`
- `POST /v1/content/:id/report`

## 7. Idempotency

Relation mutations must be safe under retries. A repeated request must not create duplicate authoritative relations.

Event ingestion must tolerate client retries and delayed delivery.

## 8. Privacy

- Block and privacy controls are evaluated before exposing social relationships.
- Private content must not enter public feed candidates.
- Sensitive event data must not be exposed to unrelated clients.

## 9. Acceptance Criteria

1. Follow/block/mute are independently represented.
2. Counts are derived and rebuildable.
3. Duplicate follow/like/favorite operations are safe.
4. Comment/reply ownership and moderation boundaries exist.
5. Raw high-frequency events do not directly become trusted recommendation signals.
6. Event envelope is versioned.
7. API errors are stable.
8. Typecheck and local runtime pass.
