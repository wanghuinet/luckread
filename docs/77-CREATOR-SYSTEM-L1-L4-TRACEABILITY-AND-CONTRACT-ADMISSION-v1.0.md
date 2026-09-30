# LuckRead Creator System L1-L4 Traceability & Contract Admission v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System 的实现准入与机器追踪层**

## 1. 目的

本合同承接 `76-CREATOR-SYSTEM-CONTRACT-v1.0.md`，将 Creator System 的 L1-L4 能力转换为可以被 Data / API / Event / Permission / Security / Runtime / Test 逐项验收的责任链。

本文件不新增 Creator 业务能力，不替代 Creator System 主合同，也不把 Creator Center、MCN Center、Growth、Rights、Risk、Commerce、Analytics 变成第二权威。

标准链：

```text
Creator Capability
→ L1
→ L2
→ L3
→ L4
→ Authority
→ Data
→ API / Control
→ Event
→ Permission / Security
→ Privacy / Rights / Risk
→ Runtime
→ Cost
→ Test / Acceptance
→ Evidence
→ READY
```

## 2. L1-L4 Admission Matrix

| L2 | L3 responsibility | L4 atomic examples | Authority | Status |
|---|---|---|---|---|
| Creator Identity | Account Binding / Type / Handle / State | creatorId, userId binding, creator type, handle uniqueness, identity state | Creator System | REQUIRED |
| Creator Profile | Public / Professional / Visibility / Featured | avatar, bio, category, expertise, visibility, featured reference | Creator System | REQUIRED |
| Qualification | Feature / Program / Evaluation / Appeal | publish/live/commerce/program eligibility, evaluatedAt, expiry, appeal | Creator System | REQUIRED |
| Verification | Identity / Creator / Professional / Lifecycle | email/phone/identity evidence reference, verified state, expiry, revocation | Creator System + verification providers | REQUIRED |
| Capability | Publishing / Realtime / Commercial / Ecosystem | text/media/live/membership/commerce/app/game capability | Creator System | REQUIRED |
| Lifecycle | Onboarding / Active / Restricted / Suspension / Closure | apply, activate, restrict, suspend, recover, close | Creator System | REQUIRED |
| Ownership & Attribution | Authorship / Production / Ownership / Derivative | primary/co-creator, editor, publisher, attribution, provenance reference | Creator-side relation; Content/Rights remain authority | REQUIRED |
| Audience Relationship | Follower / Subscriber / Segmentation / Membership | follow state, subscription, audience segment, member projection | Social/Membership domains | REQUIRED |
| Organization Relationship | Affiliation / Role / Lifecycle / Conflict | org reference, role, invite, accept, leave, conflict | Organization/MCN | REQUIRED |
| Creator Rights Relationship | Content / IP / Commercial / Change Reaction | rights references, authorization, distribution/commercial rights | Rights domain | REQUIRED |
| Reputation & Standing | Standing / Quality / Program / Health | good standing, warning, restriction, quality reference, health summary | Risk/Trust + Creator projection | REQUIRED |
| Creator Safety | Protection / Impersonation / Abuse / Recovery | safety state, report reference, recovery state | Security/Risk | REQUIRED |
| Creator Growth | Participation / Level / Missions / Guidance | program state, level, mission progress, guidance | Growth domain | REQUIRED |
| Creator Analytics | Content / Audience / Creator / IP projections | views, watch time, retention, portfolio/IP metrics | Analytics domain | REQUIRED |
| Creator Monetization | Eligibility / Products / Revenue / Settlement projection | ad/membership/commerce eligibility, revenue/settlement summaries | Commerce + Ledger | REQUIRED |
| Creator Collaboration | Co-creation / Contribution / Splits / Lifecycle | invite, role, attribution, split reference, termination | Creator System for participation; domain authorities for content/finance | REQUIRED |
| Creator Ecosystem | Marketplace / Brand / Developer / Resources | participation, partner reference, app ownership reference, education | Respective ecosystem domains | REQUIRED |
| Creator Governance | Policy / Enforcement / Appeal / Audit | acknowledgment, warning/restriction reference, appeal, audit reference | Moderation/Risk/Audit | REQUIRED |

## 3. Traceability Rules

每一个 L4 必须具有唯一的追踪键：

```text
creatorCapabilityId
l1
l2
l3
l4
authority
```

并必须能够继续追踪：

```text
Data Contract
API / Control
Event Contract
Permission / Security
Privacy / Rights / Risk
Runtime
Cost
Test / Acceptance
Evidence
```

任意一项缺失即 `FAIL`；无法判断 owner 即 `BLOCKED`。

## 4. Authority Rules

Creator System 只对以下事实拥有业务权威：

```text
creator identity
creator profile
creator type
creator lifecycle
creator qualification
creator verification state
creator capability state
creator-side collaboration state
creator-side attribution relationship
```

以下不得由 Creator System 重新建立第二 authority：

```text
organization membership → Organization / MCN
content truth → Content
legal rights → Rights
social relationship → Social Graph
membership entitlement → Membership / Commerce
risk decision → Risk / Trust
moderation decision → Moderation / Appeals
money / balance / settlement fact → Wallet / Ledger
analytics truth → Analytics
```

规则：

```text
reference / projection / orchestration ≠ authority
Creator Center ≠ authority
Creator dashboard ≠ authority
Cache/KV ≠ authority
Queue/Event ≠ authority
R2 object ≠ authority
```

## 5. Data Traceability

每个 Creator L4 数据项必须声明：

- entity / aggregate；
- authoritative fields；
- derived fields；
- owner；
- schemaVersion；
- createdAt / updatedAt；
- lifecycle state；
- provenance where applicable；
- retention/deletion rule；
- privacy classification。

Creator verification 与安全类数据必须采用最小化原则；敏感原始证据不得进入普通 Creator DTO。

派生能力（如 analytics、growth、health summary）必须可重建，不得覆盖 Creator authoritative state。

## 6. API Traceability

所有 Creator API 必须具备：

```text
version
owner
DTO / schemaVersion
authentication
actor context
scope / authorization
privacy enforcement
idempotency for mutation
cursor pagination where collection
stable error model
rate / quota
requestId
correlationId
acceptance
```

推荐公开边界：

```text
/v1/creators
/v1/creators/{creatorId}
/v1/creators/{creatorId}/profile
/v1/creators/{creatorId}/qualification
/v1/creators/{creatorId}/verification
/v1/creators/{creatorId}/capabilities
/v1/creators/{creatorId}/lifecycle
/v1/creators/{creatorId}/relationships
/v1/creators/{creatorId}/collaborations
/v1/creators/{creatorId}/standing
```

Creator Center、Public Profile、MCN Center 等体验入口必须复用 Domain API/Service，不得绕过领域授权直接访问存储。

## 7. Event Traceability

Creator System 至少需要定义：

```text
creator.created
creator.profile_updated
creator.type_changed
creator.qualification_changed
creator.verification_submitted
creator.verification_changed
creator.capability_changed
creator.lifecycle_changed
creator.attribution_changed
creator.collaboration_created
creator.collaboration_changed
creator.standing_changed
creator.safety_state_changed
creator.organization_link_changed
creator.rights_reference_changed
creator.program_enrolled
creator.program_status_changed
creator.closed
```

事件最少包含：

```text
eventId
eventType
schemaVersion
producer
creatorId
occurredAt
requestId
correlationId
source
idempotency/dedupe data
delivery semantics
```

事件用于传播事实变化，不成为 Creator 事实的第二数据库。

## 8. Permission / Security Admission

统一授权链：

```text
Authentication
→ Actor
→ App / Session Context
→ Creator Scope
→ Domain Authorization
→ Sensitive Action Policy
→ Audit
```

敏感操作至少包括：

- creator lifecycle change；
- verification decision；
- capability elevation；
- organization affiliation change；
- ownership/attribution change；
- collaboration split reference change；
- creator closure/deletion；
- security/recovery action。

安全规则：

- 不把 password、token、recovery secret 放入 Creator API；
- 不把 identity verification 原始材料暴露给普通客户端；
- 管理操作必须审计；
- 内部 Worker / Queue consumer 仍须执行 domain authorization；
- capability 不能替代 per-request authorization。

## 9. Rights / Risk / Governance Boundary

### Rights

Creator System 保存 Creator-side rights references；法律权利、授权、地域、期限、独占性等事实由 Rights domain 权威化。

### Risk / Trust

Risk System 决策风险与安全阈值；Creator System 只保存可对创作者展示的 standing / notice / capability consequence。

### Moderation

Moderation System 决定审核、限制与申诉结果；Creator System 只消费和展示 Creator-scoped 状态。

### Governance

所有关键状态变更必须具备 provenance 和 audit reference。

## 10. Runtime / Cost

默认 Cloudflare-first：

```text
Workers
├── D1 authoritative Creator state
├── R2 sensitive/large evidence only when explicitly required
├── Cache/KV hot projections
├── Queues asynchronous propagation
├── Durable Objects only for justified strong coordination
└── Workflows when durable multi-step execution is required
```

禁止：

- 每个 Creator 页面实时扫描全部事件；
- 用 Cache/KV 替代 Creator authority；
- 用事件表代替事实表；
- 为普通 Creator 查询引入无必要外部数据库。

高频路径优先：

```text
Authoritative Change
→ Event
→ Queue
→ Derived Projection
→ Cache
→ Read API
```

## 11. Reliability

Creator mutation 与异步链必须定义：

```text
timeout
retry
duplicate
out-of-order
poison message
DLQ
replay
backfill
rollback
partial failure
```

所有可重试 mutation 必须幂等；状态迁移必须允许检测非法回退；关键生命周期与 verification 操作必须具有明确恢复路径。

## 12. Test / Acceptance Matrix

### P0 identity

- Creator 可创建并绑定唯一 User；
- Creator public ID / handle 唯一；
- Profile 更新遵守 visibility；
- Creator state 与 User state 冲突时按 authority 规则处理。

### P0 qualification / verification

- 不满足资格不能使用对应 capability；
- qualification expiry 可被重新评估；
- verification 状态可 pending/approved/rejected/expired/revoked；
- 敏感证据不会进入普通 API response。

### P0 lifecycle

- activate/restrict/suspend/reinstate/close 均可审计；
- 非法状态跃迁被拒绝；
- 重复请求不会产生重复业务事实；
- 关闭后的 Creator 行为符合 retention / deletion 合同。

### P0 relationships

- Creator 与 Organization/MCN 的关系不产生第二 membership authority；
- Content attribution 可追踪；
- Rights 变化可触发 Creator capability/standing projection 更新；
- collaboration 可幂等创建、终止和恢复。

### P0 governance

- 权限提升有 authorization + audit；
- 风险/审核状态能安全投影到 Creator；
- appeal reference 可追踪；
- 内部阈值和安全策略不会泄露。

### P0 scale / resilience

- 热点 Creator profile 支持缓存；
- 派生 projection 可以重建；
- Queue 重试不会重复状态变更；
- 外部依赖失败不破坏 authoritative Creator write；
- 关键请求具备 request/correlation trace。

## 13. Evidence Requirements

每个通过的 Creator L4 必须能够留下最小证据：

```text
checkId
creatorCapabilityId
commitSha
schema/API/event version
testId
input/reference
result
timestamp
```

不得用“页面可以打开”替代业务事实验收。

## 14. STOP Conditions

以下任一条件成立即 STOP：

- Creator L4 无 owner；
- Creator 与 User/Organization/Content/Rights 等 authority 重复；
- qualification/capability 没有明确来源；
- verification 敏感证据泄露；
- lifecycle 存在不可审计跃迁；
- mutation 无幂等策略；
- event 无 schema/version/dedupe；
- Queue retry 可能产生重复事实；
- Creator Center 直接访问内部存储；
- Cloudflare-native capability 被无理由外置；
- derived analytics/growth/health 覆盖 authoritative Creator state；
- Risk/Moderation 内部规则向创作者暴露；
- audit / evidence 缺失。

## 15. Ready Gate

只有以下链路全部成立，Creator System 才能进入代码实现：

```text
76 Creator System Contract
→ L1-L4 Traceability COMPLETE
→ Authority Unique
→ Data Contract READY
→ API Contract READY
→ Event Contract READY
→ Permission/Security READY
→ Runtime/Cost READY
→ Test/Acceptance READY
→ Unified CL Preflight PASS
→ CI PASS
→ IMPLEMENTATION
```

**当前状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**

**本文件不执行 CL/CI。**
