# LuckRead Final Contract Reconciliation & Admission Gate v1.0

**状态：RECONCILIATION-READY / L1-L6-TRACEABILITY-INCLUDED / IMPLEMENTATION BLOCKED UNTIL UNIFIED CL**

## 1. 目的

本文件是 LuckRead 现有架构、能力、数据、API、事件、权限、安全、运行时、UX 与平台治理合同之间的最终横向一致性门。

它不定义新的业务能力；它负责回答：

```text
现有合同是否互相一致？
是否存在重复能力、第二数据权威、边界冲突或旧版本污染？
所有待开发能力是否已经具备统一准入条件？
L3/L4 是否完成追踪？
L5/L6 是否完成工程执行与验证映射？
```

## 2. Source of Truth Hierarchy

合同优先级固定为：

```text
1. 本最终准入合同：跨合同冲突解决规则
2. 领域主合同：各 L1 能力域的业务权威
3. L1-L4 Traceability / Contract Admission：产品能力可实现性
4. 178 L3/L4 Traceability Closure
5. 179 L5 Execution Specification
6. 180 L6 Verification / Evidence Atomic Unit
7. API / Data / Event / Permission / Security 合同
8. UX / Journey 合同
9. Platform Operations / Open Platform 横向合同
10. 实现代码、示例、旧设计、历史草案
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

每一个进入实现的 L4 还必须映射到：

```text
L5 Execution Specification
→ L6 Verification / Evidence
```

同一业务事实不得由两个 L1 域同时声明为 authority。

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

聚合中心只能提供 projection / orchestration / experience，不得建立第二份业务事实权威。

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

禁止 fork Payload、复制其内部实现、第三方直读 internals、让 Payload collection 取代领域 authority、或把 Worker 规则隐藏在 CMS adapter。

## 6. Data / API / Event / Permission / Security Consistency

每个可实现 L4 必须满足：

```text
L4
→ Data Contract
→ API / Control Contract
→ Event Contract
→ Permission / Security Contract
→ Runtime Contract
→ Test / Acceptance
→ L5 Execution Specification
→ L6 Verification / Evidence
```

### 6.1 Data

- authoritative state 必须有唯一 owner；
- derived state 必须可重建；
- R2 不承担隐式业务 authority；
- cache/KV 不取代 authority；
- event 不取代事实表。

### 6.2 API

公开 API 必须具有稳定版本、owner、DTO、鉴权、scope、错误模型、幂等、分页/游标、限流/配额与验收定义。

### 6.3 Event

事件必须包含 event identity、schema version、producer、resource reference、correlation、dedupe/idempotency 与 delivery semantics。

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

任何内部 API、异步消费者或管理员任务均不得天然绕过授权、审计或敏感数据最小化。

## 7. L3/L4/L5/L6 Traceability Closure

本文件正式纳入 178–181：

```text
37 Product Boundary
→ 34/35/36 Capability Inventory
→ 178 L3/L4 Closure
→ 179 L5 Execution Specification
→ 180 L6 Verification
→ 176 Evidence Registry
```

规则：

```text
L2 → at least one L3
L3 → at least one L4
L4 → at least one L5 before implementation
L5 → at least one L6 before acceptance
L6 → Evidence before PASS
```

任何 orphan 或断链均为 reconciliation blocker。

## 8. Cloudflare Runtime Consistency

LuckRead 的默认生产运行模型保持 Cloudflare-first：

```text
Workers
├─ D1 authoritative structured state
├─ R2 large objects / media
├─ Cache/KV derived and hot state
├─ Queues asynchronous work
├─ Durable Objects strong coordination when required
└─ Workflows durable execution when appropriate
```

新增外部基础设施必须具备 justification、adapter/API/event boundary、failure isolation、cost budget、upgrade policy、exit/removal plan。

## 9. External OSS Registry Reconciliation

当前已声明的外部能力保持既有边界，不得直接成为业务 authority。新增 OSS 必须先进入主合同/注册表并完成 179 L5 与 180 L6 验证映射后才能进入实现。

## 10. UX ↔ Capability Traceability

```text
User Journey
→ UX capability
→ L1-L4 capability
→ L5 execution
→ API / Event
→ Domain authority
→ Permission / Risk
→ Runtime
→ L6 verification
→ Acceptance
```

## 11. Legacy / Deprecated Document Quarantine

旧版本文档、历史方案、实验设计与已废弃能力不得参与当前实现准入。

```text
current main contract → active
superseded contract   → historical
deprecated contract   → quarantined
unmerged draft        → non-authoritative
```

## 12. Versioning & Change Admission

任何架构变化必须判断：

```text
documentation-only
contract-compatible
contract-expanding
contract-breaking
```

Contract-expanding 必须增加受影响的 L3/L4/L5/L6 与 Data/API/Event/Permission/Test 链。

Contract-breaking 必须提供 ADR、migration plan、compatibility window、rollback plan、acceptance evidence。

## 13. Final STOP Conditions

- L1-L4 无唯一归属；
- L3/L4 断链；
- L4 无 L5；
- L5 无 L6/evidence plan；
- 同一业务事实存在第二 authority；
- Data/API/Event owner 不一致；
- Permission/Security 链缺失；
- Payload boundary 被绕过；
- Cloudflare-native capability 被无理由外置；
- OSS 没有 adapter/API/event boundary；
- UX 无法追踪到能力与验收；
- contract-breaking change 没有 ADR/migration/rollback；
- 任一未批准能力直接进入 IMPLEMENTATION。

## 14. Unified READY Gate

```text
Product Requirement
→ L1
→ L2
→ L3
→ L4
→ L5
→ L6
→ Data/API/Event
→ Permission/Security/Privacy
→ UX
→ Payload/Cloudflare/OSS Boundary
→ Reliability/DR
→ Observability
→ Cost
→ Test/Acceptance
→ Evidence
→ Reconciliation
→ Unified Preflight
→ Unified CL
→ CI
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
L1-L4               = TRACEABILITY-CONTRACTED
L5                  = ENGINEERING-SPEC-CONTRACTED
L6                  = VERIFICATION-CONTRACTED
DATA                = CONTRACTED
API                 = CONTRACTED
EVENT               = CONTRACTED
PERMISSION/SECURITY = CONTRACTED
UX                  = TRACEABLE
PLATFORM            = CONTRACTED
RECONCILIATION      = READY FOR UNIFIED CL
IMPLEMENTATION      = PENDING
```

**本文件只完成跨合同准入设计，不执行 CL/CI。**
