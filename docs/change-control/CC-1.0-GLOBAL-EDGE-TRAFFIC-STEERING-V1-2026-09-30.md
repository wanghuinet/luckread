# CC-1.0 Global Edge Traffic Steering & High-Volume Ingestion — 2026-09-30

**Status:** CHANGE-CONTROL / RECONCILED / IMPLEMENTATION PENDING

## Purpose

正式记录 LuckRead 面向后期高并发的“地域就近接入 + 读路径就近化 + 高频行为异步摄取”演进边界。

本变更不修改当前固定拓扑：

```text
12 Workers / 4 D1 / 25 Tasks
```

也不授权立即创建新的 Worker、D1、Region、Load Balancer 或独立数据服务。

## Baseline

Baseline before this change:

```text
4ec956c12feb82a6912f5397b0b3e7a0aa9eb1dd
```

Reconciliation commits:

```text
96fa0fec4b95ae454866dcc4192c1da929efe4cc
cae4ec408932c0633cacf1242c1e6ddecaba6ebb
```

Existing Blueprint already requires:

- cost-first architecture;
- high-frequency behavior as lightweight events;
- cache / queue / aggregation / batch persistence;
- authoritative writes on the defined primary path;
- read replication for read-heavy workloads where appropriate;
- failure isolation and backpressure;
- Payload Core immutability.

## Authorized Architecture Evolution

When measured traffic requires it, the platform may evolve toward:

```text
Client
  ↓
Cloudflare Edge
  ↓
regional / proximity-aware request ingress
  ↓
regional Worker execution where beneficial
  ↓
┌───────────────────────┬──────────────────────┐
│ read-heavy request    │ high-frequency event │
│                       │                      │
│ Cache / D1 replica   │ Queue / aggregation  │
│                       │                      │
└───────────┬───────────┴──────────┬───────────┘
            ↓                      ↓
       authoritative read     batched persistence
                                   ↓
                              Domain authority
                                   ↓
                        projections / analytics
                                   ↓
                            Creator Data Center
```

### Regional steering rule

Geographic steering is a traffic optimization layer, not a data-authority layer.

Allowed:

- route users toward nearby edge/worker execution;
- use geographic/proximity/health/weight policies;
- use Smart Placement where backend proximity reduces request latency;
- use regional read replicas for read-heavy queries;
- use cache to terminate repeated hot reads at the edge.

Not allowed:

- creating a separate authoritative Follow/Subscription/Entitlement state per geography;
- allowing user geography to decide financial or permission truth;
- silently splitting one domain's authoritative writes across multiple databases;
- making Data Center a regional authority.

### High-volume ingestion rule

High-frequency user actions such as:

- video play;
- impression;
- click;
- dwell;
- like/reaction;
- feed interaction;
- recommendation signals;
- analytics events;

must prefer:

```text
Edge
→ lightweight event
→ queue/cache
→ validation/risk
→ aggregation
→ batch persistence
```

A single user action must not imply a synchronous Payload/D1 write merely because an aggregate field exists.

### Read path rule

Read-heavy data may evolve toward:

```text
Edge cache
→ read replica
→ authoritative primary fallback
```

The consistency requirement of each API must determine whether stale/eventual reads are acceptable. Follow state, subscription state, entitlement state, account state and other authority-sensitive reads must use the domain contract's required consistency behavior.

### Data Center rule

Creator/Data Center remains a projection/query surface.

It may consume:

- follower projections;
- subscription/member projections;
- entitlement/access summaries;
- content analytics;
- validated engagement aggregates.

It must not own or rewrite:

- Social Graph truth;
- Subscription truth;
- Entitlement truth;
- payment/ledger truth;
- Content authority.

## Non-Goals

This change does not:

- change the fixed 12 Worker / 4 D1 topology;
- require global multi-primary writes;
- require a new regional D1 per user geography;
- introduce a new database provider;
- modify Payload Core;
- create a TikTok-specific implementation;
- mark any future capability as GREEN;
- authorize premature infrastructure provisioning.

## Reconciliation Requirements

Before runtime implementation of regional steering or high-volume ingestion, the relevant contracts must be reconciled with:

- Blueprint cost-first rules;
- Social / Membership / Entitlement authority boundaries;
- Cache contract;
- Async / Queue contract;
- Event / idempotency contract;
- Data Center projection contract;
- observability and cost evidence requirements.

Implementation readiness requires measured workload evidence demonstrating that the existing topology is the bottleneck being addressed.

## Reconciliation Result

The change is consistent with the existing Blueprint and domain contracts because it:

- does not alter the fixed Worker/D1 topology;
- preserves Social as Follow authority;
- preserves Membership as Subscription/Entitlement authority;
- keeps Data Center as a projection/query surface;
- follows the existing high-volume async and cost-first rules;
- does not modify Payload Core;
- does not require a regional authoritative database per geography.

Therefore the architecture rule is reconciled at contract level. Runtime implementation remains separately gated by measured workload evidence and the relevant execution/evidence contracts.

## Decision

```text
Architecture capability: RECONCILED / ACCEPTED AS FUTURE EVOLUTION
Current implementation: NOT AUTHORIZED BY THIS CC
Current topology: UNCHANGED
Evidence status: NOT GREEN
```
