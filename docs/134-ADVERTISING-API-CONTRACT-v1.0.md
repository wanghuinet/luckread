# LuckRead Advertising API Contract v1.0

**状态：API-CONTRACT-COMPLETE / CONTRACT-READY**

## 1. Public Boundary

Advertising exposes stable versioned APIs and never exposes internal persistence, model, risk, or provider schemas.

## 2. Representative APIs

```text
POST   /v1/ads/advertisers
GET    /v1/ads/advertisers/{id}
POST   /v1/ads/campaigns
GET    /v1/ads/campaigns
GET    /v1/ads/campaigns/{id}
POST   /v1/ads/campaigns/{id}/submit
POST   /v1/ads/campaigns/{id}/pause
POST   /v1/ads/campaigns/{id}/resume
POST   /v1/ads/creatives
POST   /v1/ads/delivery/decide
POST   /v1/ads/events
POST   /v1/ads/attribution/recompute
POST   /v1/ads/budgets/{id}/pause
GET    /v1/ads/reports
GET    /v1/ads/billing-summary
```

## 3. Mutation Requirements

All state-changing APIs require:

- authenticated actor;
- tenant/resource authorization;
- schema validation;
- idempotency where retryable;
- expected-version protection where mutable;
- requestId/correlationId;
- stable error envelope;
- audit for sensitive operations.

## 4. Delivery API

`delivery/decide` is latency-sensitive and must return a bounded response. It may use cache/precomputed state, but final billing/accounting is outside this API.

## 5. Measurement API

Measurement ingestion must support duplicate event delivery, event timestamps, dedupe, validation and asynchronous processing. Invalid or disqualified events must remain distinguishable from valid events.

## 6. Report API

Large reports may be asynchronous. Report responses are derived views and must identify the policy/model version used.

## 7. Errors

Stable machine-readable categories include:

```text
UNAUTHORIZED
FORBIDDEN
INVALID_ARGUMENT
VERSION_CONFLICT
POLICY_REJECTED
BUDGET_EXHAUSTED
DELIVERY_UNAVAILABLE
DUPLICATE_EVENT
RATE_LIMITED
TEMPORARY_FAILURE
```

## 8. STOP

- internal risk schema exposed;
- private targeting attributes returned to client;
- API directly mutates Ledger;
- non-idempotent measurement ingestion;
- tenant boundaries omitted.

## 9. Status

```text
API = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
