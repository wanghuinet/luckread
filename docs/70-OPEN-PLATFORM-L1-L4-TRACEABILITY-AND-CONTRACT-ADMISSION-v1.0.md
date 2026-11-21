# LuckRead Open Platform L1-L4 Traceability and Contract Admission v1.0

**Status:** TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING

## 1. Purpose

This document closes the L1-L4 traceability and admission boundary for Open Platform capabilities defined by `70-OPEN-PLATFORM-DEVELOPER-APPS-MINIAPPS-GAMES-CONTRACT-v1.0.md`.

Required chain:

`L1 → L2 → L3 → L4 → Data → API → Event → Permission/Security → Cost/Runtime → Test/Acceptance`

No implementation may introduce an undocumented Open Platform responsibility.

## 2. L1 Boundary

L1: **Platform / Open Ecosystem / Operations**.

Open Platform is an external capability boundary. It exposes stable contracts while hiding D1, R2, Payload internals, queues, Durable Objects, cache keys, and private services.

## 3. L2-L4 Traceability

| L2 | L3 | L4 responsibility | Authority | Admission |
|---|---|---|---|---|
| Developer | Account | developer identity, organization, members, roles, suspension | Developer domain | A |
| App | Registration | app identity, ownership, environment, lifecycle | Open Platform | A |
| App | Release | version, review, publish, rollback, deprecation | Open Platform | A |
| Authorization | Scope | scope declaration, consent, enforcement | Open Platform + owning domain | A |
| Authorization | OAuth/OIDC | delegated authorization, token lifecycle, revocation | Identity/Auth boundary | A |
| API | Public API | versioned DTOs, errors, pagination, idempotency | API layer + owning domain | A |
| SDK | Client SDK | typed client, auth helper, retries, upload helper | SDK layer | A |
| Integration | Webhook | signing, delivery, retry, idempotency | Open Platform | A |
| Integration | Events | schema version, event identity, delivery semantics | Domain Event layer | A |
| Protection | Rate Limit | request protection, quota, backoff | Platform Operations | A |
| Developer | Console | credentials, scopes, usage, review, releases | Open Platform | A |
| Mini App | Runtime | sandbox, capability declaration, lifecycle | Open Platform | A |
| Extension | Plugin | extension point, timeout, resource limits, compatibility | Owning extension host | A |
| Games | Integration | delegated identity, social/content/payment interfaces | Open Platform + game domain | A |
| Data Access | DTO | data minimization, stable public projection | Owning domain | A |
| Trust | App Review | identity, privacy, security, abuse, policy review | Risk/Trust + Open Platform | A |
| Sandbox | Test Environment | isolated credentials, fixtures, simulated events | Platform Operations | A |
| Commercial | Developer Billing | usage evidence and billing candidate | Analytics → Commerce/Ledger | A |
| Analytics | API Analytics | usage, errors, latency, quota, webhook metrics | Analytics domain | A |
| Security | Integration Security | auth, scope, secrets, audit, anomaly controls | Risk/Security | A |
| Ecosystem | App Marketplace | discovery, eligibility, publication, suspension | Open Platform | A |

## 4. Authority Rules

Open Platform owns registration and integration lifecycle, but never becomes authority for another domain's business state.

- User identity → User Identity domain.
- Content → Content domain.
- Media → Media domain.
- Creator → Creator domain.
- Social graph → Social Graph domain.
- Risk decisions → Risk/Trust domain.
- Moderation decisions → Moderation domain.
- Commerce → Commerce domain.
- Financial facts → Wallet/Ledger domain.
- Objects → R2 boundary.
- Structured authoritative state → applicable domain/D1 boundary.

`API ownership ≠ data authority`.

## 5. API Admission

Every public endpoint requires:

- stable `/v1/...` contract;
- owning domain;
- request/response DTO;
- authentication requirement;
- scope requirement;
- privacy classification;
- risk/moderation path where applicable;
- rate/quota policy;
- idempotency policy where applicable;
- error model;
- pagination semantics;
- version/deprecation policy;
- acceptance tests.

Internal implementation APIs cannot become public by convention.

## 6. Event Admission

Integration events MUST have:

- eventId;
- event type;
- schema version;
- occurredAt;
- producer/domain owner;
- resource reference;
- delivery semantics;
- retry/idempotency behavior.

Webhook path:

`Domain Event → Queue → Dispatcher → Signed Delivery → Consumer`

External consumers cannot publish authoritative domain facts merely by sending a webhook callback.

## 7. Permission and Security Admission

Permission model:

`Developer authorization → App authorization → User delegation → Domain authorization`

These layers MUST remain distinct.

Sensitive scopes require stronger review and, where applicable, explicit user consent.

Credentials MUST be rotatable and revocable. Secrets/tokens MUST NOT enter ordinary logs or analytics.

## 8. Mini App / Plugin / Game Admission

All embedded ecosystems use declared capabilities.

### Mini App

- sandboxed;
- public API only;
- no raw storage access;
- no privileged arbitrary code;
- no ledger mutation bypass;
- moderation/risk controls remain mandatory.

### Plugin / Extension

- documented extension point;
- bounded timeout/resources;
- explicit permission;
- compatibility contract;
- failure isolation.

### Game

- treated as an Open Platform application;
- no privileged backend by default;
- game-owned state remains game-owned;
- payments and entitlements use approved commerce contracts.

## 9. Cost / Runtime Admission

Cloudflare-native runtime remains the default:

`Workers + D1 + R2 + Queues + KV/Cache + Durable Objects + Cron/Workflows`

Rules:

- ordinary API requests remain lightweight;
- large/slow processing is asynchronous;
- webhook fanout uses Queue boundaries;
- hot/derived data may use Cache/KV;
- strong coordination uses Durable Objects only when justified;
- external infrastructure must sit behind an explicit adapter/API/event boundary;
- developer quota is separate from financial settlement authority.

## 10. Test / Acceptance Admission

Every Open Platform capability MUST test, where applicable:

1. authentication;
2. authorization and scope enforcement;
3. ownership;
4. lifecycle transitions;
5. duplicate/replay handling;
6. idempotency;
7. privacy/data minimization;
8. risk/moderation enforcement;
9. webhook signature and retry behavior;
10. quota/rate limiting;
11. API compatibility;
12. failure isolation;
13. auditability;
14. observability;
15. sandbox isolation;
16. rollback/revocation;
17. cost and latency bounds.

## 11. STOP Conditions

Implementation MUST STOP and return to architecture review if:

- a new L1/L2 responsibility appears without traceability;
- an Open Platform service claims another domain's authoritative state;
- public DTOs expose internal persistence models or secrets;
- third-party applications bypass scope or risk controls;
- webhook delivery becomes a synchronous business dependency;
- billing bypasses validated usage evidence and the Commerce/Ledger chain;
- Mini Apps or plugins obtain unrestricted privileged execution;
- production credentials leak into sandbox;
- a new external infrastructure dependency lacks an adapter/API/event boundary.

## 12. Admission Decision

The Open Platform contract is **CONTRACT-ADMISSION-READY**.

All currently defined L2 capabilities map to L3/L4 responsibilities and have explicit authority boundaries. Implementation remains blocked until the corresponding Data/API/Event/Security/Cost/Test contracts are produced for the specific capability being implemented.

**No CL/CI is run by this document update.**
