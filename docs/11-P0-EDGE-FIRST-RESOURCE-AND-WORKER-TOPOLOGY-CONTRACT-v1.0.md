# LuckRead P0 Edge-First Resource & Worker Topology Contract v1.0

Status: **DOCUMENTED / ARCHITECTURE-LOCKED / IMPLEMENTATION-PENDING**

This document freezes the physical Worker baseline, Edge-first read strategy, D1 access budgets, asynchronous write strategy, queue protection, anti-abuse controls, and resource-amplification invariants.

It does not claim implementation, CI Green, Security Green, E2E Green, or Release Green. Those states require repository artifacts and current-SHA evidence.

## 1. Non-negotiable platform objective

LuckRead MUST NOT use D1 as the default request-path database for public reads.

The default direction is:

```text
Client
  ↓
Cloudflare Edge / Cache
  ↓ HIT
Response
```

Only cache misses, authoritative state checks, private data, or explicitly consistency-sensitive operations may continue to Worker data access.

Primary invariant:

> Public read traffic MUST NOT scale D1 reads linearly with request volume.

## 2. Frozen logical capability boundaries

The existing W01–W13 logical boundaries remain unchanged:

1. W01 API Edge
2. W02 Identity & Account
3. W03 Risk & Abuse
4. W04 Authorization & Policy
5. W05 Content
6. W06 Media
7. W07 Social/Feed
8. W08 Event/Notification
9. W09 Discovery
10. W10 Creator/Commerce
11. W11 Control/Platform
12. W12 Recommendation
13. W13 Realtime

Logical boundaries are contract/security/data-ownership boundaries. They are not required to map one-to-one to physical Cloudflare Workers.

## 3. Frozen physical Worker baseline

The initial physical deployment baseline is **8 Workers**:

| Physical Worker | Logical capabilities | Primary resource pattern |
|---|---|---|
| P01 Edge/API | W01 | Cache-first, routing, admission, context |
| P02 Security | W02 + W03 + W04 | AuthN, Risk, AuthZ, policy; no business ownership |
| P03 Public Content/Feed | W05 + W07 + W09 read paths | Cache/read-mostly, bounded reads |
| P04 Interaction | W07 write paths | Single authoritative writes + events |
| P05 Media Gateway/Delivery | W06 | R2/edge/media metadata; no large in-memory media buffering |
| P06 Creator/Commerce | W10 | Bounded authoritative reads/writes |
| P07 Event/Notification/Control | W08 + W11 | Queue/event/control; asynchronous by default |
| P08 Recommendation/Realtime | W12 + W13 | Dedicated runtime/state boundaries; bounded compute |

This is a physical baseline, not a requirement that every capability must remain physically colocated forever.

## 4. Merge/split invariants

Physical merge or split MUST NOT change:

- public API Contract;
- data ownership;
- authorization boundary;
- state-machine semantics;
- security boundary;
- failure boundary;
- resource budgets;
- event semantics;
- idempotency semantics;
- migration ownership.

A physical Worker may be split only when there is evidence of memory pressure, CPU pressure, dependency/bundle pressure, concurrency isolation need, fault isolation need, or materially different scaling characteristics.

A physical Worker MUST NOT be split merely because a new domain name exists.

## 5. Edge-first read contract

Public read APIs MUST declare a cache policy.

Default policy:

```text
PUBLIC GET
  → Edge Cache
  → HIT: D1 = 0
  → MISS: bounded origin path
```

Required protections:

- request coalescing / single-flight for cache misses;
- stale-while-revalidate where safe;
- TTL jitter to avoid synchronized expiry;
- bounded refresh concurrency;
- negative caching where semantically safe;
- ETag/conditional requests where applicable;
- private/no-store policy for sensitive user-scoped data.

A cache key MUST include every authorization/scope/version dimension required to prevent cross-user or cross-tenant data exposure.

## 6. D1 access contract

### 6.1 Public reads

Normal public GET paths SHOULD have:

```text
D1_READ = 0
D1_WRITE = 0
```

Cache-miss origin paths SHOULD have:

```text
D1_READ <= 1
D1_WRITE = 0
```

Exceptions require an explicit Contract-level justification and budget.

### 6.2 Interaction writes

Like, follow, favorite, comment and similar state-changing operations MUST use a bounded authoritative write model:

```text
D1_READ = 0..1
D1_WRITE <= 1 authoritative write
EVENT <= 1
```

Counters, feed projections, notifications, analytics and recommendation feedback MUST NOT be synchronously multiplied into additional authoritative D1 writes.

### 6.3 Media

Media delivery MUST NOT read D1 for every media object request.

Media bytes MUST use Cloudflare/R2/media delivery paths. Worker code MUST NOT buffer large media objects in memory.

Media metadata operations SHOULD be bounded to at most one authoritative D1 write per state-changing completion operation.

## 7. Single-flight / cache stampede protection

For a cache key with an origin MISS, concurrent equivalent requests MUST be coalesced.

Forbidden:

```text
10,000 concurrent MISS
→ 10,000 D1 reads
```

Required behavior:

```text
10,000 concurrent MISS
→ one bounded origin fetch
→ one cache fill
→ shared result
```

The coalescing mechanism MUST itself have bounded lifetime, concurrency, memory and failure behavior.

## 8. Async-first write amplification control

A synchronous request MUST perform only the authoritative operation required to commit its own business fact.

The preferred pattern is:

```text
Request
  ↓
Admission / Auth / Anti-Abuse
  ↓
Authoritative write
  ↓
One domain event
  ↓
Return
  ↓
Async projections
```

Feed, search, counters, notifications, analytics and recommendation projections MUST be asynchronous or otherwise bounded/rebuildable unless an explicit consistency contract requires otherwise.

## 9. Queue contract

Queues MUST be treated as a resource boundary, not an infinite buffer.

Every queue MUST declare:

- enqueue rate budget;
- maximum backlog;
- task size limit;
- consumer concurrency;
- retry limit;
- replay limit;
- task age/TTL;
- DLQ policy;
- deduplication/idempotency strategy;
- overload behavior.

When queue admission limits are reached, the system MUST reject, throttle, coalesce, or degrade. It MUST NOT enqueue without bound.

## 10. Anti-abuse contract

Anti-abuse checks MUST happen before expensive D1/R2/Queue operations whenever technically possible.

Protection dimensions may include:

- IP;
- account/user;
- device/client identity;
- API credential/developer app;
- organization/tenant;
- endpoint/action;
- target resource;
- global platform state.

Enforcement actions:

```text
ALLOW → THROTTLE → CHALLENGE → REVIEW/BLOCK
```

Rate limit is not equivalent to authorization and is not equivalent to entitlement.

Abuse controls MUST protect both synchronous resources and asynchronous resources.

## 11. Retry amplification contract

Retry budgets are request-scoped, not Worker-scoped.

A downstream Worker MUST consume the caller's remaining retry budget rather than starting an independent retry budget.

Forbidden:

```text
Request × Worker A retry × Worker B retry × Worker C retry
```

Required:

```text
Request Context
  └─ total retry budget
```

Retries MUST be limited by error classification, idempotency, deadline and resource budget.

## 12. RPC amplification contract

A physical Worker boundary MUST NOT create an uncontrolled synchronous RPC graph.

Every public API declares a maximum synchronous RPC budget.

Default target:

```text
Public read: 0..1 synchronous internal call
Write:       0..1 synchronous internal call
```

Any higher budget requires explicit architecture evidence.

## 13. Resource budget contract

Every public API and asynchronous task MUST declare applicable limits for:

- D1_READ;
- D1_WRITE;
- D1_READ_ROWS;
- D1_WRITE_ROWS;
- D1_READ_BYTES;
- D1_WRITE_BYTES;
- RPC_CALLS;
- CPU_TIME;
- WALL_TIME;
- RETRY_COUNT;
- EVENT_COUNT;
- EVENT_FANOUT;
- QUEUE_OPERATIONS;
- R2_OPERATIONS;
- R2_BYTES;
- CACHE_OPERATIONS;
- OUTBOUND_REQUESTS;
- REQUEST_BODY_BYTES;
- RESPONSE_BYTES;
- CONCURRENCY.

Hard limits MUST fail closed or degrade safely. A warning MUST NOT be treated as a successful budget check.

## 14. Content-type applicability

The same architecture applies to:

- ARTICLE;
- POST/DYNAMIC;
- VIDEO/SHORT VIDEO;
- GALLERY;
- future LIVE, AUDIO, COMIC, NOVEL and other Content types.

Content Contract, Feed Contract, Interaction Contract, Event Contract, Cache Contract and Anti-Abuse Contract are shared. Media processing is the specialized path for video/media workloads.

## 15. Read/write classification

Every API MUST be classified as one of:

1. CACHE_ONLY;
2. CACHE_THEN_BOUNDED_READ;
3. SINGLE_AUTHORITATIVE_WRITE;
4. QUEUE_INGEST;
5. R2/MEDIA_STREAM;
6. BOUNDED_COMPOSITION;
7. HEAVY_ASYNC_COMPUTE.

No endpoint may remain unclassified at Contract Green.

## 16. Load shedding

Platform load states:

```text
NORMAL
→ PROTECTED
→ DEGRADED
→ LOAD_SHED
→ EMERGENCY
```

Under pressure the platform MUST preserve, in priority order, security, authentication/account recovery, critical authoritative writes, and safety controls.

Noncritical workloads such as recommendation refresh, analytics, notification batching, search refresh and heavy media processing may be delayed, reduced or shed according to policy.

## 17. Forbidden anti-patterns

The following are architecture violations:

- public GET → D1 by default;
- cache MISS → unbounded D1 fan-in;
- one user action → multiple synchronous projection writes;
- Worker-local independent retry budgets;
- synchronous event fan-out;
- unbounded queue growth;
- per-message D1 writes for realtime traffic;
- full media buffering inside Worker memory;
- unbounded feed/search/recommendation candidate sets;
- client-specific business logic forks;
- splitting Workers without preserving logical contracts;
- using rate limits as a substitute for authorization.

## 18. Contract CI admission gates

A domain/API cannot become Contract Green unless applicable checks prove:

- cache policy exists;
- read/write classification exists;
- D1 read/write budgets exist;
- rows/bytes budgets exist where applicable;
- single-flight protection exists for cacheable origin reads;
- retry budget exists;
- RPC budget exists;
- event/fan-out budget exists;
- queue budget exists for async work;
- anti-abuse policy exists;
- idempotency exists for repeatable state changes;
- private-cache safety exists;
- load-shed behavior exists for high-cost workloads;
- no N+1 query/RPC pattern is introduced;
- no unbounded pagination/candidate set is introduced;
- no unbounded queue/event loop is introduced.

Missing evidence = NOT GREEN.

## 19. Architecture lock

This contract freezes the following baseline for implementation:

```text
Logical capability boundaries: W01–W13
Physical Worker baseline:     8
Public read default:          Edge Cache first
Normal public GET D1 reads:   0
Cache-miss D1 reads:          bounded, target <= 1
Simple interaction writes:    target <= 1 authoritative write
Domain event per mutation:    target <= 1
Heavy work:                   Queue/Async first
Anti-abuse:                   before expensive work
Retry budget:                 request-scoped
RPC budget:                   explicit
Queue budget:                 explicit
D1:                           authoritative state, not default read cache
```

Changing this baseline is a Core Architecture Contract Change and requires a documented review plus Contract CI evidence. Implementation code MUST NOT silently redefine this topology or resource model.
