# LuckRead Final Contract Reconciliation & Admission Gate v1.0

**状态：RECONCILIATION-READY / IMPLEMENTATION BLOCKED UNTIL UNIFIED CL**

## 1. 目的

本文件是 LuckRead 现有架构、能力、数据、API、事件、权限、安全、运行时、UX 与平台治理合同之间的最终横向一致性门。

它不定义新的业务能力，也不替代任何领域合同；它只负责回答：

```text
现有合同是否互相一致？
是否存在重复能力、第二数据权威、边界冲突或旧版本污染？
所有待开发能力是否已经具备统一准入条件？
```

本文件完成后，统一 CL/CI 才是代码实现的下一准入门。

## 2. Source of Truth Hierarchy

合同优先级固定为：

```text
1. 本最终准入合同：跨合同冲突解决规则
2. 领域主合同：各 L1 能力域的业务权威
3. L1-L4 Traceability / Contract Admission：能力可实现性与链路完整性
4. API / Data / Event / Permission / Security 合同
5. UX / Journey 合同
6. Platform Operations / Open Platform 横向合同
7. 实现代码、示例、旧设计、历史草案
```

同级冲突不得通过代码自行选择；必须先形成 ADR / Contract Change，并更新受影响追踪链。

GitHub `main` 是当前合同基线；未进入 `main` 的本地设计不构成平台事实。

## 3. Capability Uniqueness Gate

每一个 L4 能力必须具有唯一的：

```text
L1 owner
L2/L3/L4 identifier
Data authority
API/control owner
Event producer
Permission owner
Runtime boundary
Acceptance owner
```

同一业务事实不得由两个 L1 域同时声明为 authority。

允许多个体验入口、API 或聚合层指向同一 authority，但：

```text
multiple entry points ≠ multiple authorities
multiple projections ≠ multiple authorities
multiple caches ≠ multiple authorities
multiple adapters ≠ multiple authorities
```

发现重复 L4 时，必须标记为 `DUPLICATE / MERGE / DEPRECATE` 之一，不得继续并行实现。

## 4. Authority Reconciliation

最终数据权威遵循领域归属：

```text
User / Account        → User Identity
Creator               → Creator
Organization / MCN    → Organization / MCN
Content               → Content
Media Object          → Media + R2
Social Graph          → Social Graph
Interaction Facts     → Interaction
Feed / Recommendation → corresponding distribution domains
Risk / Trust          → Risk / Trust
Moderation            → Moderation / Appeals
Copyright / Rights    → Copyright / Rights
Commerce              → Commerce
Financial Facts       → Wallet / Ledger
Operational Facts     → Platform Operations
Telemetry             → Observability
```

聚合中心（例如 User Center、Creator Center、MCN Center、Personal Content Space）只能提供 projection / orchestration / experience，不得建立第二份业务事实权威。

## 5. Payload / Worker Boundary

Payload 保持为上游 CMS 基座，不成为 LuckRead 所有业务逻辑的隐式总线。

```text
Payload
  ├─ official extension points
  ├─ authentication / CMS capabilities
  └─ admin/content management integration

LuckRead Worker / Domain Services
  ├─ public API
  ├─ domain rules
  ├─ event processing
  ├─ async orchestration
  └─ Cloudflare runtime integration
```

禁止：

- fork Payload 作为长期业务分支；
- 复制 Payload 内部实现作为 LuckRead 核心代码；
- 让第三方应用直接访问 Payload internals；
- 用 Payload collection 取代已经声明的领域 authority；
- 把 Worker 业务规则偷偷写入 CMS adapter。

Payload 扩展必须经过官方 extension point、API、service 或 event boundary。

## 6. Data / API / Event / Permission / Security Consistency

每个可实现 L4 必须满足：

```text
Capability
→ Data Contract
→ API / Control Contract
→ Event Contract
→ Permission / Security Contract
→ Runtime Contract
→ Test / Acceptance
```

### 6.1 Data

- authoritative state 必须有唯一 owner；
- derived state 必须可重建；
- R2 保存大对象，不承担隐式业务 authority；
- cache/KV 保存热点或派生状态，不取代 authority；
- event 不取代事实表。

### 6.2 API

公开 API 必须具有稳定版本、owner、DTO、鉴权、scope、错误模型、幂等、分页/游标、限流/配额与验收定义。

API ownership 不等于 data authority。

### 6.3 Event

事件必须包含：

```text
eventId
 eventType
schemaVersion
occurredAt
producer
resourceRef
correlationId
dedupe / idempotency strategy
delivery semantics
```

事件传播事实，不重新定义事实。

### 6.4 Permission / Security

权限链统一为：

```text
Authentication
→ Actor
→ App / Session context
→ Scope / Role
→ Domain authorization
→ Audit
```

任何“内部 API”“异步消费者”“管理员任务”均不得天然绕过授权、审计或敏感数据最小化。

## 7. Cloudflare Runtime Consistency

LuckRead 的默认生产运行模型保持 Cloudflare-first：

```text
Request
  ↓
Workers
  ├─ D1      authoritative structured state
  ├─ R2      large objects / media
  ├─ Cache/KV derived and hot state
  ├─ Queues  asynchronous work
  ├─ Durable Objects  strong coordination when required
  └─ Workflows durable execution when appropriate
```

新增外部基础设施必须回答：

1. Cloudflare-native capability 是否足够；
2. 为什么需要外部组件；
3. Adapter/API/Event boundary 是什么；
4. 故障如何隔离；
5. 数据如何退出；
6. 成本如何预算；
7. 如何升级、替换、删除。

不得因为某个 OSS 更熟悉，就改变平台 authority model。

## 8. External OSS Registry Reconciliation

当前合同已经声明的外部能力保持统一边界：

| Capability | Selected / Reserved | Boundary |
|---|---|---|
| Live / RTC | LiveKit selected | RTC transport/room infrastructure only |
| Media Processing | FFmpeg selected | processing runtime only |
| Search | Meilisearch selected | derived search index via adapter |
| Observability | OpenTelemetry standard | telemetry standard, not business authority |
| Product Analytics | PostHog reserved | adapter, non-authoritative analytics |
| Durable Workflow | Temporal reserved | later option; Cloudflare Workflows first |
| Vector Search | Qdrant reserved | later option; Vectorize first |
| Event Bus | NATS reserved | Queues first |
| Cache | Redis/Valkey reserved | Cache/KV/DO first |
| IAM | Keycloak reserved | Payload Auth first |
| Commerce | Medusa reserved | Payload/D1 first for v1 |

任何新增 OSS 必须先进入相应主合同和本注册表，再进入实现。

## 9. UX ↔ Capability Traceability

UX 不是独立于后端合同的“页面清单”。每个关键用户旅程必须能够反向追踪：

```text
User Journey
→ UX capability
→ L1-L4 capability
→ API / Event
→ Domain authority
→ Permission / Risk
→ Runtime
→ Acceptance
```

聚合体验层可以组合多个领域，但不得改变领域 authority。

Personal Content Space 必须继续作为聚合体验入口；其中用户可见的 Live/直播入口属于体验合同，即使底层 LiveKit 基础设施由独立外部组件承载，也不得因为基础设施合同变化而静默删除该入口或破坏返回上一页面的导航行为。

## 10. Platform Horizontal Layer Reconciliation

### 70 Open Platform

Open Platform 是第三方开发者、App、Mini App、Plugin、Game 的受控访问层：

```text
Developer
→ App
→ Permission / Scope
→ Public API / SDK / Webhook
→ Domain API
→ Domain Authority
```

第三方不得直接访问 D1、R2、Payload internals、Queue、DO、Cache keys 或私有服务。

### 71 Platform Operations

Platform Operations 管理部署、发布、配置、观测、可靠性、容量、成本、审计、安全与回滚，但不得成为业务事实第二 authority。

因此：

```text
Open Platform controls external access
Platform Operations controls platform operation
Domain contracts control business truth
```

三者不可互相越权。

## 11. Legacy / Deprecated Document Quarantine

旧版本文档、历史方案、实验设计与已废弃能力不得参与当前实现准入。

规则：

```text
current main contract → active
superseded contract   → historical
deprecated contract   → quarantined
unmerged draft        → non-authoritative
```

发现旧文档与当前合同冲突时，默认以当前 `main` 合同为准；不得通过读取旧文档恢复已经废弃的架构。

若旧文档仍被代码、CI、脚本或测试引用，则必须建立 migration/deprecation task；在完成前，该依赖属于 admission blocker。

## 12. Versioning & Change Admission

任何架构变化必须先判断：

```text
documentation-only
contract-compatible
contract-expanding
contract-breaking
```

### Contract-compatible

可直接进入下一阶段，但必须更新受影响 traceability。

### Contract-expanding

必须增加 L1-L4、Data/API/Event/Permission/Test 链，并更新主合同。

### Contract-breaking

必须提供：

```text
ADR
migration plan
compatibility window
rollback plan
acceptance evidence
```

未完成变更合同不得进入代码实现。

## 13. Final STOP Conditions

任一条件成立即 STOP：

- L1-L4 无唯一归属；
- 同一业务事实存在第二 authority；
- Data/API/Event owner 不一致且无明确 boundary；
- API 暴露内部存储模型；
- Event 被当作事实 authority；
- Permission/Security 链缺失；
- Payload boundary 被绕过；
- Cloudflare-native capability 被无理由外置；
- OSS 没有 adapter/API/event boundary；
- OSS 无故障隔离、成本或退出方案；
- UX 无法追踪到能力与验收；
- Open Platform 绕过 domain authorization；
- Platform Operations 产生业务第二 authority；
- 旧文档仍能影响生产实现且没有 quarantine/migration；
- contract-breaking change 没有 ADR/migration/rollback；
- 任一未批准能力直接进入 IMPLEMENTATION。

## 14. Unified READY Gate

最终统一准入链：

```text
Product Requirement
→ L1
→ L2
→ L3
→ L4
→ Capability Uniqueness
→ Data Authority
→ Data Contract
→ API / Control Contract
→ Event Contract
→ Permission / Security
→ UX Traceability
→ Payload / Worker Boundary
→ Cloudflare Runtime Boundary
→ OSS Boundary
→ Reliability
→ Observability
→ Cost
→ Test / Acceptance
→ Contract Reconciliation
→ CI / CL
→ Deployment
→ Smoke
→ Rollback Evidence
→ USER ACCEPTANCE
→ DONE
```

只有全部通过，状态才可从 `READY` 进入 `IMPLEMENTATION`，再进入 `DONE`。

## 15. Current Admission State

```text
ARCHITECTURE        = CONTRACTED
CAPABILITY          = TRACEABLE
DATA                = CONTRACTED
API                 = CONTRACTED
EVENT               = CONTRACTED
PERMISSION/SECURITY = CONTRACTED
UX                  = TRACEABLE
PLATFORM            = CONTRACTED
OSS BOUNDARY        = CONTRACTED
RECONCILIATION      = READY FOR UNIFIED CL
IMPLEMENTATION      = PENDING
```

**本文件只完成跨合同准入设计，不执行 CL/CI。**

统一文档链完成后，再执行一次完整 CL/CI，并以机器结果决定是否进入代码实现。