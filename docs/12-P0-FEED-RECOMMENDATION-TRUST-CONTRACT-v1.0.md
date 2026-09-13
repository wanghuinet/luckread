# LuckRead P0 Feed Recommendation Trust Contract v1.0

**Status:** READY FOR IMPLEMENTATION

## 1. Scope

Freeze feed delivery, recommendation feedback and trust boundaries without prematurely selecting a specific ranking algorithm.

## 2. Feed Types

Initial feed contracts:
- for-you
- following
- latest
- trending
- topic
- creator
- IP
- video
- live
- related

## 3. Delivery Protocol

Every feed response supports, where applicable:
- versioned cursor
- request/correlation ID
- stable item identity
- continuation cursor
- deduplication key
- reason/feedback metadata where policy permits
- server-side visibility filtering

Clients must not assume database pagination semantics.

## 4. Candidate Pipeline

```text
Sources
→ Eligibility
→ Safety / Privacy
→ Candidate Recall
→ Trust Weighting
→ Ranking
→ Diversity / Frequency Cap
→ Final Feed
```

## 5. Recommendation Feedback

Supported signals include:
- exposure
- click/open
- dwell
- read/watch completion
- like
- comment
- favorite
- share
- follow
- not-interested
- hide
- report

Raw signal quality is evaluated before it becomes a trusted feature.

## 6. Fairness / Cold Start

The system must support:
- new-user cold start
- new-creator cold start
- new-content exploration
- creator/content diversity
- frequency caps
- repeated-content suppression
- risk-aware exploration

No single engagement metric may become the sole ranking objective.

## 7. Trust Boundary

```text
Raw Behavior
→ Risk / Trust
→ Valid Signal
→ Feature / Aggregate
→ Candidate / Ranking
```

Recommendation poisoning must be explicitly considered for automated traffic, coordinated engagement, spam, fraud and abnormal behavior.

## 8. API Boundary

- `GET /v1/feed/:feedType`
- `POST /v1/feed/events`
- `POST /v1/feed/feedback`
- `GET /v1/recommendations/:surface`

The public API returns stable DTOs and does not expose ranking implementation details.

## 9. Rebuildability

Feed and recommendation derived state must be rebuildable from authoritative content, social state and validated events where practical.

## 10. Cost Rule

Exposure and behavior events should use cache/queue/aggregation paths rather than unconditional D1 writes. Feed reads should prefer cache/derived views when freshness requirements allow.

## 11. Acceptance Criteria

1. Cursor pagination is stable under concurrent inserts.
2. Private/blocked/removed content is filtered before delivery.
3. Duplicate feed items are suppressed within the defined response scope.
4. Feedback events are versioned.
5. Raw events cannot bypass trust checks.
6. Cold-start and diversity policies have explicit test cases.
7. Typecheck and local runtime pass.
