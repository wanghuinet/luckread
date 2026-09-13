# LuckRead 全平台 Feature Master Matrix v1.0

**Status:** ARCHITECTURE BASELINE / IMPLEMENTATION NOT AUTHORIZED BY THIS FILE

**Repository:** `wanghuinet/luckread`

**Purpose:** 将 `00-PROJECT-BLUEPRINT`、`02-PAYLOAD-CAPABILITY-MAP`、`03-API-CAPABILITY-COMPLETENESS-CONTRACT`、`04-MAINSTREAM-SELF-MEDIA-CAPABILITY-MATRIX`、`05-PLATFORM-CAPABILITY-GAP-AUDIT` 汇总为单一 Feature Master Matrix，作为后续 Feature Contract 的入口。

> 本文件冻结“能力范围”，不等于立即开发。任何 Feature 仍必须经过 Architecture Review、Data Contract、API Contract、Payload/Worker Boundary、Risk/Security Review、Cost Review、Test/Acceptance Definition 后才能进入 READY。

## 1. 权威关系

```text
产品能力蓝图
    ↓
Feature Master Matrix  ← 本文件：能力总目录
    ↓
Feature Contract
    ↓
Data Contract
    ↓
API Contract
    ↓
Payload / Worker / D1 / R2 / Cache / Queue
    ↓
Test Contract
    ↓
READY
    ↓
Implementation
```

GitHub approved contract is authoritative when chat, local notes and code disagree.

## 2. Status / Priority / Ownership Legend

### Status

- `COVERED`：现有文档已经明确覆盖
- `GAP`：能力已识别但尚未形成完整 Feature Contract
- `CONTRACTED`：已有明确 Contract，可进入实现评审
- `IMPLEMENTED`：代码已实现，但仍需 CI / User Acceptance 才能 DONE
- `DEFERRED`：明确保留，但暂不实现

### Priority

- `P0`：平台基础能力；缺失会造成架构不完整
- `P1`：主流平台核心体验；应进入产品合同并分阶段实现
- `P2`：规模化、商业化、生态能力；先冻结接口
- `P3`：高级/实验能力

### Execution ownership

- `Payload`：Payload 官方能力或官方 extension point
- `API`：稳定 APP API / DTO / auth boundary
- `Worker`：独立运行逻辑或高频异步处理
- `D1`：权威结构化状态
- `R2`：大对象、媒体、内容 blob 等
- `Cache`：短期/热点/派生状态
- `Queue`：异步事件、聚合、fan-out、批处理
- `Risk`：风控/反作弊/公平性保护

## 3. Master Matrix

| Domain | Capability Group | Priority | Status | Primary Owner | Storage / Runtime | API | Risk | H5 | Android | iOS |
|---|---|---:|---|---|---|---|---|---|---|---|
| Identity | User / Account / Auth / Session | P0 | CONTRACTED | Payload + API | D1 | YES | YES | YES | YES | YES |
| Identity | Profile / Device / Identity Linkage | P0 | GAP | Payload + API | D1 | YES | YES | YES | YES | YES |
| Identity | Permission / Access Control | P0 | CONTRACTED | Payload + API | D1 | YES | YES | YES | YES | YES |
| Creator | Creator Profile / Verification | P0 | COVERED | Payload + API | D1 | YES | YES | YES | YES | YES |
| Creator | Creator Studio / Dashboard | P0 | GAP | API + Worker | D1 + Cache | YES | YES | YES | YES | YES |
| Creator | Creator Analytics / Growth | P1 | GAP | Worker | Cache + D1/Analytics | YES | YES | YES | YES | YES |
| MCN | Organization / Members / Roles | P1 | COVERED | Payload + API | D1 | YES | YES | YES | YES | YES |
| MCN | Contracts / Revenue Share / Analytics | P1 | GAP | API + Worker | D1 + Queue | YES | YES | YES | YES | YES |
| Content | Unified Content Identity | P0 | CONTRACTED | Payload + API | D1 | YES | YES | YES | YES | YES |
| Content | Article / Dynamic / Gallery | P0 | CONTRACTED | Payload | D1 + R2 | YES | YES | YES | YES | YES |
| Content | Video Metadata | P0 | CONTRACTED | Payload | D1 + R2 | YES | YES | YES | YES | YES |
| Content | Novel / Comic / Drama / Audio | P1 | COVERED | Payload | D1 + R2 | YES | YES | YES | YES | YES |
| Content | Live / Game / App References | P1 | COVERED | API + Domain | D1 | YES | YES | YES | YES | YES |
| Content | Draft / Version / Preview / Schedule | P0 | GAP | Payload | D1 | YES | YES | YES | YES | YES |
| Content | Content Relationship Graph | P0 | GAP | API + Worker | D1 | YES | YES | YES | YES | YES |
| Content | Series / Collection / Playlist / Channel | P1 | GAP | Payload + API | D1 | YES | YES | YES | YES | YES |
| Content | Localization / Multi-version | P1 | GAP | Payload + API | D1 + R2 | YES | YES | YES | YES | YES |
| Creation | Rich Editor / Block / Markdown / HTML | P0 | GAP | Payload extension | D1 + R2 | YES | YES | YES | YES | YES |
| Creation | Image Editing / Cover / Templates | P1 | GAP | API + Media | R2 + Cache | YES | YES | YES | YES | YES |
| Creation | Video Basic Editing | P1 | GAP | Media Worker | R2 + Queue | YES | YES | YES | YES | YES |
| Creation | Music / Audio / Subtitle / Effects | P1 | GAP | Media + API | R2 + D1 | YES | YES | YES | YES | YES |
| Creation | Remix / Duet / Stitch / Derivative | P1 | GAP | API + Risk | D1 + R2 | YES | YES | YES | YES | YES |
| Media | Media Metadata / Object Lifecycle | P0 | CONTRACTED | Payload + API | D1 + R2 | YES | YES | YES | YES | YES |
| Media | Processing / Transcoding / Thumbnail | P1 | GAP | Worker | R2 + Queue | YES | YES | YES | YES | YES |
| Media | Adaptive Delivery / Preload | P1 | GAP | API + Worker | R2 + Cache | YES | YES | YES | YES | YES |
| Interaction | Like / Favorite / Follow / Share | P0 | COVERED | API + Queue | Cache + Queue + D1 | YES | YES | YES | YES | YES |
| Interaction | Comment / Reply / Mention / Reaction | P0 | COVERED | Payload + API | D1 + Cache | YES | YES | YES | YES | YES |
| Interaction | High-frequency Counters | P0 | GAP | Worker | Cache + Queue + D1 | YES | YES | YES | YES | YES |
| Social Graph | Follow Graph / Mutual / Close Friends | P0 | GAP | API + Worker | D1 + Cache | YES | YES | YES | YES | YES |
| Social Graph | Block / Mute / Privacy Controls | P0 | GAP | API + Payload | D1 + Cache | YES | YES | YES | YES | YES |
| Community | Group / Community / Topic | P1 | GAP | API + Payload | D1 + Cache | YES | YES | YES | YES | YES |
| Community | Fan Group / Badge / Member Level | P1 | GAP | API + Worker | D1 + Cache | YES | YES | YES | YES | YES |
| Feed | For You / Following / Latest | P0 | COVERED | Feed API | Cache + Queue | YES | YES | YES | YES | YES |
| Feed | Trending / Local / Topic / Creator | P0 | GAP | Feed Worker | Cache + Queue | YES | YES | YES | YES | YES |
| Feed | Cursor / Resume / Incremental / Dedup | P0 | GAP | API + Feed | Cache | YES | YES | YES | YES | YES |
| Feed | Diversity / Frequency Cap / Feedback | P0 | GAP | Feed + Risk | Cache + Queue | YES | YES | YES | YES | YES |
| Recommendation | Candidate / Ranking / Personalization | P0 | COVERED | Recommendation Worker | Cache + Queue | YES | YES | YES | YES | YES |
| Recommendation | Cold Start / Exploration / Fairness | P0 | GAP | Recommendation + Risk | Cache + Queue | YES | YES | YES | YES | YES |
| Risk | Behavior Trust / Fraud Detection | P0 | CONTRACTED | Risk Worker | Cache + Queue + D1 | YES | YES | YES | YES | YES |
| Risk | Author / Device / IP / Network Abuse | P0 | GAP | Risk Worker | Cache + Queue | YES | YES | YES | YES | YES |
| Risk | Recommendation Poisoning Protection | P0 | GAP | Risk + Recommendation | Cache + Queue | YES | YES | YES | YES | YES |
| Moderation | Content / Comment / Live / DM Safety | P0 | GAP | Safety Worker | Queue + D1 | YES | YES | YES | YES | YES |
| Moderation | Enforcement / Appeal / Evidence | P0 | GAP | Operations + Risk | D1 + R2 | YES | YES | YES | YES | YES |
| Copyright | Ownership / License / Rights | P0 | GAP | Rights Domain | D1 + R2 | YES | YES | YES | YES | YES |
| Copyright | Fingerprint / Match / Claim / Takedown | P0 | GAP | Rights Worker | R2 + Queue + D1 | YES | YES | YES | YES | YES |
| Live | Live Room / Ingest / Scheduling | P0 | GAP | Live Worker | R2 + Queue + D1 | YES | YES | YES | YES | YES |
| Live | Co-host / Multi-guest / PK / Moderation | P0 | GAP | Live Worker | Cache + Queue | YES | YES | YES | YES | YES |
| Live | Replay / Highlight / Clip | P1 | GAP | Media + Live | R2 + Queue | YES | YES | YES | YES | YES |
| Live | Gifts / Membership / Paid Interaction | P1 | GAP | Commerce + Live | D1 + Queue | YES | YES | YES | YES | YES |
| IM | 1:1 / Group Messaging | P1 | GAP | Realtime Worker | Cache + D1 | YES | YES | YES | YES | YES |
| IM | Delivery / Read / Typing / Presence | P1 | GAP | Realtime Worker | Cache + Queue | YES | YES | YES | YES | YES |
| IM | Group Admin / Anti-spam / Retention | P1 | GAP | Realtime + Risk | D1 + Cache | YES | YES | YES | YES | YES |
| Search | Autocomplete / Suggest / History | P1 | GAP | Search API | Cache + Search | YES | YES | YES | YES | YES |
| Search | Content / Creator / Video / Live / App | P1 | GAP | Search Worker | Search + D1 | YES | YES | YES | YES | YES |
| Search | Semantic / Related / Quality Feedback | P2 | DEFERRED | Search Worker | Search + Cache | YES | YES | YES | YES | YES |
| Notification | System / Like / Comment / Follow | P0 | COVERED | API + Queue | Queue + Cache + D1 | YES | YES | YES | YES | YES |
| Notification | Fanout / Digest / Preference | P1 | GAP | Notification Worker | Queue + Cache | YES | YES | YES | YES | YES |
| Monetization | Ads / Subscription / Membership | P0 | GAP | Commerce | D1 + Queue | YES | YES | YES | YES | YES |
| Monetization | Gifts / Tips / Paid Content | P1 | GAP | Commerce | D1 + Queue | YES | YES | YES | YES | YES |
| Commerce | Product / Merchant / SKU / Catalog | P1 | GAP | Commerce | D1 + R2 | YES | YES | YES | YES | YES |
| Commerce | Affiliate / Coupon / Campaign | P1 | GAP | Commerce + Worker | D1 + Queue | YES | YES | YES | YES | YES |
| Finance | Ledger / Settlement / Revenue Share | P0 | GAP | Commerce | D1 | YES | YES | YES | YES | YES |
| Analytics | User / Content / Creator / Video | P1 | GAP | Analytics Worker | Queue + Analytics | YES | YES | YES | YES | YES |
| Analytics | Funnel / Cohort / Retention / Attribution | P1 | GAP | Analytics Worker | Queue + Analytics | YES | YES | YES | YES | YES |
| Experiment | A/B / Feature Flag / Remote Config | P0 | GAP | Config API + Worker | Cache + D1 | YES | YES | YES | YES | YES |
| APP Experience | Bootstrap / Version / Upgrade | P0 | GAP | API | Cache + D1 | YES | YES | YES | YES | YES |
| APP Experience | Push / Badge / Unread / Deep Link | P0 | GAP | API + Notification | Cache + Queue | YES | YES | YES | YES | YES |
| APP Experience | Offline / Delta Sync / Read State | P1 | GAP | API | Cache + D1 | YES | YES | YES | YES | YES |
| Localization | Locale / Region / Market Availability | P1 | GAP | API + Payload | D1 + Cache | YES | YES | YES | YES | YES |
| Privacy | Consent / Export / Delete / Preferences | P0 | GAP | API + Payload | D1 + R2 | YES | YES | YES | YES | YES |
| Operations | Content / User / Creator / MCN Ops | P0 | GAP | Admin Operations | D1 + Cache | YES | YES | YES | YES | YES |
| Operations | Moderation / Risk / Search / Live Ops | P0 | GAP | Operations Workers | D1 + Queue | YES | YES | YES | YES | YES |
| Operations | Support / Ticket / Appeal | P0 | GAP | Operations | D1 + R2 | YES | YES | YES | YES | YES |
| Operations | Incident / Audit / Rollout | P0 | GAP | Platform Ops | D1 + Queue | YES | YES | YES | YES | YES |
| Open Platform | OAuth / App Registration / Scopes | P1 | GAP | Developer API | D1 | YES | YES | YES | YES | YES |
| Open Platform | API Keys / SDK / Webhook / Quota | P1 | GAP | Developer API | D1 + Cache + Queue | YES | YES | YES | YES | YES |
| Open Platform | Sandbox / Review / Release Channels | P1 | GAP | Developer Platform | D1 + R2 | YES | YES | YES | YES | YES |
| Apps | Developer / App / Version / Release | P1 | COVERED | Developer Platform | D1 + R2 | YES | YES | YES | YES | YES |
| Apps | App Review / Rating / Analytics | P1 | GAP | Developer + Operations | D1 + Queue | YES | YES | YES | YES | YES |
| Apps | App ↔ Content Relationship | P1 | GAP | API + Content | D1 | YES | YES | YES | YES | YES |

## 4. What is already strong

Current architecture already has a solid foundation in these areas:

1. Payload is the CMS/core administrative foundation, not a business-orchestration engine.
2. Payload Core remains upstream-only; custom business code must use supported extension points.
3. Unified content identity and domain separation are defined.
4. R2 is the preferred home for large media/content blobs while D1 stores authoritative metadata.
5. High-frequency behavior is explicitly designed as `event → cache/queue → aggregation/validation → batch → minimal D1 write`.
6. Risk & Trust is a first-class platform capability.
7. API completeness is a P0 rule: every APP capability must have a stable API contract.
8. H5 / Android / iOS are intended to consume the same versioned API contracts.
9. Cost review is a mandatory architecture gate.
10. Worker splitting is evidence-driven rather than premature microservice decomposition.

## 5. Highest-priority gaps before broad business implementation

The matrix identifies the following as the next contract work, not an instruction to implement all at once:

### P0 foundation gaps

1. Identity completion: device, identity linkage, privacy and permission boundaries.
2. Content lifecycle: draft/version/preview/schedule/recovery and content relationship graph.
3. Social graph: follow/block/mute/privacy semantics.
4. Feed protocol: cursor/resume/incremental/dedup/diversity/feedback.
5. Recommendation fairness: cold-start, exploration, frequency caps and risk-weighted events.
6. High-frequency counters: event quality, aggregation and batch persistence.
7. Safety: moderation, enforcement, appeal and evidence model.
8. Copyright: ownership, authorization, fingerprint, claims and takedown model.
9. Live core contract.
10. APP experience contract: bootstrap, versioning, push, deep links and state sync.
11. Platform operations contract.
12. Privacy / consent / deletion / export contract.
13. Monetization ledger and settlement contract.

### P1/P2 platform gaps

- Creator Studio
- Short-video creation ecosystem
- Search platform
- IM / realtime
- Community / groups
- Commerce
- Analytics / experiments
- Open developer platform
- App ecosystem completion
- Advanced semantic search

## 6. Cost-first implementation rule

For every matrix row, the Feature Contract must explicitly answer:

```text
1. Can Worker executions be reduced?
2. Can D1 reads be reduced?
3. Can D1 writes be reduced?
4. Can cache serve repeated reads?
5. Can events be aggregated?
6. Can queue/batch compress persistence?
7. Can R2 avoid unnecessary D1 storage?
8. What is the authoritative state?
9. What can be eventually consistent?
10. What must remain strongly consistent?
```

No Worker, Queue, Cache, Search engine or independent service may be introduced only because it is architecturally fashionable.

## 7. API completeness gate

Every row marked `P0` or `P1` must eventually map to:

```text
Feature
  ↓
Domain Contract
  ↓
API Contract
  ↓
DTO / Error / Permission Contract
  ↓
H5 / Android / iOS consumption
```

A capability is not considered platform-complete if it exists in Payload but cannot be consumed safely through the public application API.

## 8. Payload boundary gate

The following remain outside Payload Core/business hooks by default:

- Feed ranking
- Recommendation
- Risk computation
- High-frequency counters
- Notification fan-out
- Search indexing engine
- Video processing
- Live orchestration
- IM realtime orchestration
- Analytics aggregation
- Queue orchestration
- Large-scale commerce settlement orchestration

Payload may persist authoritative CMS state and emit domain events; it must not become the high-volume platform orchestration engine.

## 9. Feature readiness definition

A row may move from `GAP` to `CONTRACTED` only when its Feature Contract defines:

- user story / product behavior
- domain ownership
- data model
- authoritative state
- API endpoints and DTOs
- permission model
- risk/safety implications
- consistency model
- cache policy
- queue/event policy where applicable
- cost review
- PostgreSQL migration compatibility
- H5 / Android / iOS behavior
- test and acceptance criteria
- rollback / recovery behavior where applicable

Only then may it enter `READY`.

## 10. Development sequence

```text
Phase 0  Platform Contract
Phase 1  Identity / Auth / Permission
Phase 2  API Worker foundation
Phase 3  Creator / MCN
Phase 4  Content lifecycle + media
Phase 5  Interaction + social graph
Phase 6  Feed + recommendation + risk
Phase 7  Moderation + copyright
Phase 8  Live / realtime
Phase 9  Search
Phase 10 Monetization / commerce / ledger
Phase 11 Analytics / experiments / growth
Phase 12 APP experience / open platform
Phase 13 Apps market / developer ecosystem
Phase 14 Scale / evidence-driven Worker splitting
```

The sequence is intentionally not identical to the matrix ordering. The matrix is a completeness map; the roadmap is an implementation dependency order.

## 11. Non-goals

This matrix does **not** authorize:

- copying Payload internals
- forking Payload Core
- implementing every listed capability immediately
- creating one Worker per row
- creating one database per domain without evidence
- synchronous D1 writes for every user behavior
- treating raw events as trusted recommendation signals
- exposing Payload internal APIs directly to clients
- claiming feature parity merely because a database field exists

## 12. Decision

**Feature Master Matrix v1.0 = ARCHITECTURE BASELINE.**

The capability audit is now sufficiently broad to stop random feature discovery and move to **contract closure**. Future work should select a bounded P0/P1 domain, close its Feature/Data/API/Risk/Cost/Test contracts, mark it `READY`, and only then implement code.
