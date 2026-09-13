# LuckRead Center Layer Unified Preflight Contract v1.0

**状态：PREFLIGHT-CONTRACT-COMPLETE / CONTRACT-READY / IMPLEMENTATION BLOCKED UNTIL PREFLIGHT PASS**  
**范围：18 Center 全局静态一致性、完整性与准入前检查**

## 1. Purpose

本合同定义 18 个 Center 在进入 Unified CL 前必须通过的静态 Preflight。

目标不是再次设计产品，而是机器化发现：

```text
遗漏
重复
冲突
无 owner
无 authoritative source
无 UX completion
无 recovery
无 security scope
无 superiority evidence
```

Preflight 只检查合同与映射，不运行生产代码，不替代 Unified CL、Domain Ready Gate 或 User Acceptance。

## 2. 18 Center Scope

```text
用户中心
个人内容空间
创作者中心
MCN中心
商家中心
广告主中心
开发者中心
IP中心
版权/权益中心
订单中心
收益/钱包中心
社区中心
消息中心
安全中心
审核治理中心
数据/增长中心
平台运营中心
客服/帮助中心
```

## 3. Required Record Per Center

每个 Center 必须存在并可解析：

```text
centerId
name
purpose
primaryAuthority
secondaryAuthorities
entryPoints
coreJourneys
L1 capabilities
L2/L3/L4 mappings
API surface
Event surface
permission model
privacy classification
failure/recovery states
performance/cost assumptions
superiority baseline
acceptance evidence reference
status
```

缺失任何 mandatory field = FAIL。

## 4. Preflight Checks

### PF-01 Registry Completeness

18 Center 必须各有唯一 `centerId` 与唯一名称。

禁止同义重复中心、隐式中心或未登记中心。

### PF-02 Domain Authority Uniqueness

每个 Center 的每项 authoritative business state 必须映射到唯一 Domain owner。

禁止：

```text
Center-owned business authority
Center-owned ledger fact
Center-owned risk decision
Center-owned moderation decision
```

### PF-03 Capability Coverage

每个 Center 的关键体验能力必须能映射到既有 Domain capability。

```text
Center L1
→ Domain L1/L2
→ L3 Operation
→ L4 Acceptance
```

发现无法映射的 capability 时，必须判断是：

1. 已存在但文档遗漏；
2. Domain contract 缺失；
3. Center 设计越界。

未分类前不得 PASS。

### PF-04 Cross-Center Duplication

同一业务事实只能有一个权威 owner，但允许多个 Center 展示或操作入口。

例如：

```text
Order fact → Commerce
Order Center + Merchant Center = views / commands

Money fact → Ledger
Earnings Center + MCN + Merchant = views

Risk fact → Risk
Security + Moderation = scoped views
```

### PF-05 State Consistency

同一 resource 在不同 Center 中展示的 authoritative state 必须来自同一 source/version。

禁止：

```text
Center A = ACTIVE
Center B = SUSPENDED
```

除非两者明确表示不同 scope，并可解释。

### PF-06 Journey Completeness

每个 P0 Journey 至少定义：

```text
Entry
→ Context
→ Action
→ Pending
→ Success
→ Failure
→ Partial
→ Recovery
→ Completion
```

### PF-07 Mutation Ownership

每个 Center mutation 必须明确：

```text
actor
scope
resource
command
Domain owner
idempotency
expected version
result state
```

### PF-08 Async Operation Identity

上传、导出、审核、结算、报表、部署、工单等异步流程必须拥有稳定 operation identity 与状态机。

禁止使用“请求成功”代替长期操作完成状态。

### PF-09 Permission / Privacy

每个敏感能力必须映射到：

```text
actor
role where applicable
scope
action
resource
sensitive fields
audit requirement
```

### PF-10 Failure / Recovery

每个关键失败场景必须明确：

```text
failure source
user-visible state
preserved context
retryability
safe retry command
finalization condition
```

### PF-11 Superiority Evidence

每个 Center 至少提供：

```text
Competitor / industry baseline
→ LuckRead improvement hypothesis
→ measurable metric
→ target
→ acceptance test
→ evidence reference
```

“体验更好”“更快”“更方便”而无指标 = FAIL。

### PF-12 Cross-Device Continuity

需要跨设备连续的 Center 必须定义状态同步来源与恢复行为。

### PF-13 Cloudflare-First Boundary

Center 不得因为聚合体验直接引入无必要的同步 fan-out、外部状态库或新的基础设施权威。

运行时必须保持 Cloudflare-first 边界，并通过 Domain API / query model / event / approved adapter 访问能力。

### PF-14 Payload Boundary

Center 不得：

```text
读取 Payload internals
依赖 Payload 私有 schema
直接把 Payload internal type 当公共 DTO
```

### PF-15 Observability

关键 Center mutation、异步任务和错误必须至少能关联：

```text
requestId
correlationId
operationId where applicable
resourceId
actorId where safe
```

### PF-16 Cost / Performance

必须检查：

```text
unbounded fan-out
unbounded pagination
synchronous heavy aggregation
D1 write amplification
rebuild cost
large export blocking
```

### PF-17 Rebuildability

所有派生 Center view 必须可从 authoritative source + durable event/evidence 按合同重建。

### PF-18 Evidence Closure

每个 PASS claim 必须关联可定位证据。

禁止：

```text
claim = PASS
但 evidence = empty / unknown / stale
```

## 5. Global Cross-Center Checks

### C1
18 Center Registry 与 154 必须一致。

### C2
L1-L4 mapping 与 155 必须一致。

### C3
Authority map 与 Domain master contracts 必须一致。

### C4
UX baseline 与 139 必须一致。

### C5
所有 high-risk mutation 必须有 Permission/Security/Audit。

### C6
所有 asynchronous destructive or financial operations 必须有 operation identity、idempotency 与 recovery。

### C7
所有 Center 都必须遵守同一错误与状态表达原则：

```text
What happened?
Why?
Impact?
Next action?
Recovery?
```

## 6. Minimum Evidence Package

Unified CL 前必须形成：

```text
center-registry.json / equivalent
center-authority-matrix
center-l1-l4-matrix
center-journey-matrix
center-api-boundary-matrix
center-event-boundary-matrix
center-permission-security-matrix
center-privacy-matrix
center-failure-recovery-matrix
center-superiority-matrix
evidence-index
```

文件格式可由现有机器治理体系决定，但语义不得缺失。

## 7. Failure Classification

Preflight 发现问题后必须分类：

```text
P0 BLOCKER
P1 CONTRACT DEFECT
P2 TRACEABILITY GAP
P3 EVIDENCE GAP
P4 DOCUMENTATION QUALITY GAP
```

P0/P1 必须阻断 Unified CL。

P2/P3 若影响关键 capability、security、authority 或 superiority，同样必须阻断。

P4 可在不破坏合同语义的情况下修复后再进入 CL。

## 8. Pass Rule

```text
18 Centers Registered
AND
No Authority Conflict
AND
No Unclassified Capability
AND
No Cross-Center State Conflict
AND
All P0 Journeys Complete
AND
All High-Risk Mutations Scoped
AND
All Critical Failure Paths Recoverable
AND
All Superiority Claims Evidence-Backed
AND
Cloudflare/Payload Boundaries Valid
→ PREFLIGHT PASS
```

否则：

```text
PREFLIGHT FAIL
→ CLASSIFY
→ REPAIR CONTRACT / TRACEABILITY / EVIDENCE
→ RECHECK
```

## 9. Relation to Existing Gates

```text
Center Contracts
→ 154 Master Matrix
→ 155 L1-L4 Traceability
→ 157 Unified Preflight
→ 156 Unified Admission Gate
→ Unified CL
→ Center-specific implementation
→ Local PASS
→ CI PASS
→ User Acceptance
```

Preflight 不得被用来绕过 156；两者均必须通过。

## 10. Current Status

```text
18_CENTER_SCOPE = COMPLETE
STATIC_PREFLIGHT_MODEL = COMPLETE
IMPLEMENTATION = BLOCKED
UNIFIED_CL = REQUIRED
```
