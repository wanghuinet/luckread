# LuckRead P0 Public API Inventory & Completeness Contract v1.0

Status: **ARCHITECTURE-LOCKED / IMPLEMENTATION-AUDIT-PENDING**

## 1. Purpose

This contract converts “API 功能是否完整” from a subjective checklist into a machine-verifiable endpoint inventory.

The platform may have broad functional coverage while still being incomplete. Completeness is achieved only when every required endpoint is explicitly mapped to its contract, implementation, security, state, resource, and integration evidence.

## 2. Source of truth

Public API truth is the Contract/OpenAPI layer, not Payload collections or admin UI behavior.

The machine-readable baseline is `contracts/api/api-inventory.v1.json`.

Payload is an implementation dependency behind the domain/service boundary.

## 3. Completeness invariant

For every required endpoint:

```text
Endpoint → Schema → OpenAPI → Permission → Scope → State Machine
→ Cache Policy → Read/Write Classification → Resource Budget
→ RPC Budget → Retry Budget → Event Budget → Queue Budget
→ Anti-Abuse → Idempotency → Storage/Domain Mapping
→ Examples → Integration/E2E → Security E2E when sensitive
```

Missing mapping or missing evidence means **NOT GREEN**.

## 4. Functional coverage baseline

The baseline inventory covers authentication/identity, users/accounts, articles/posts/galleries/content lifecycle, media upload/processing/playback, feeds, likes/favorites/follows/comments, notifications, search/discovery, creator/IP/MCN, subscriptions/entitlements/payments, audit/compliance/data export/deletion, analytics, recommendation, realtime, and developer/open-platform capabilities including OAuth, API keys and webhooks.

This is a **coverage baseline**, not an implementation claim.

## 5. Required API classes

Every endpoint MUST be classified as one of:

1. `CACHE_ONLY`
2. `CACHE_THEN_BOUNDED_READ`
3. `SINGLE_AUTHORITATIVE_WRITE`
4. `QUEUE_INGEST`
5. `R2/MEDIA_STREAM`
6. `BOUNDED_COMPOSITION`
7. `HEAVY_ASYNC_COMPUTE`

No endpoint may reach Contract Green while unclassified.

## 6. Client convergence

Web, Android, iOS and Mini Program clients MUST consume the same public API contract for the same business capability. Client-specific UX may differ; business semantics, authorization, state transitions, error model, pagination, idempotency and resource limits MUST NOT fork without an explicit versioned contract.

## 7. Completeness levels

### L0 — Inventoried
Endpoint exists in the inventory.

### L1 — Contracted
Schema, OpenAPI, error, permission/scope and state references exist.

### L2 — Resource-safe
Cache, read/write classification, D1/bytes/rows/RPC/retry/event/queue budgets and anti-abuse policy exist.

### L3 — Implemented
Domain/service implementation and Payload boundary mapping exist.

### L4 — Integrated
Contract CI, build, unit, migration and integration evidence pass.

### L5 — Production-ready
E2E, security, load/resource, observability, Cloudflare runtime and release evidence pass.

Only L5 may be called **API COMPLETE / PRODUCTION GREEN**.

## 8. Explicit non-goals

The following do NOT prove API completeness:

- Payload Admin UI works;
- a Payload collection exists;
- a local route returns HTTP 200;
- a mock endpoint passes;
- OpenAPI exists without implementation evidence;
- implementation exists without contract mapping;
- one client works while other clients are unverified;
- CI is green while required inventory entries are missing.

## 9. Audit order

1. Inventory completeness
2. Contract/schema completeness
3. OpenAPI operation completeness
4. Permission/scope completeness
5. State-machine completeness
6. Resource/cache/async completeness
7. Payload/storage mapping completeness
8. Implementation completeness
9. Integration/E2E completeness
10. Security and production-release completeness

The audit MUST stop at the first blocking layer rather than declaring downstream Green prematurely.

## 10. Architecture lock

Adding a new public endpoint requires an inventory record before implementation. Removing or materially changing an endpoint requires a versioned contract change and breaking-change analysis.

This contract does not claim that the current repository has completed every endpoint. It establishes the mandatory mechanism by which that claim can later be proven.
