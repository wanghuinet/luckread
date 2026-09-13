# LuckRead Center Layer Unified Preflight Contract v1.0

**状态：PREFLIGHT-CONTRACT-COMPLETE / CROSS-CUTTING-CHECKS-INCLUDED / IMPLEMENTATION BLOCKED UNTIL PREFLIGHT PASS**  
**范围：18 Center 全局静态一致性、完整性、横向规则与准入前检查**

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
无 cross-cutting contract closure
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
cross-cutting dependency references
acceptance evidence reference
status
```

缺失任何 mandatory field = FAIL。

## 4. Cross-Cutting Dependency Preflight

每个 Center 必须可映射到适用的统一平台规则：

```text
160 Data Lifecycle
161 Backup / DR / BCP
162 Schema / Migration / Compatibility
163 Event Semantics / Replay / DLQ
164 Cross-Domain Saga / Compensation
165 Unified Async Operation
166 Unified Error / State
167 Cache / Invalidation / Hot-Key
168 Global Scope / Tenant Isolation
169 Security / Secret / Incident
170 Rate / Quota / Traffic Shaping
171 Observability / SLI / SLO
172 Localization / Region / Time / Currency
173 Accessibility
174 Canonical ID / Entity Reference
175 Feature Flag / Configuration / Policy Versioning
176 Evidence Registry
```

不适用项也必须给出机器可审计的 `NOT-APPLICABLE` 理由。

## 5. Preflight Checks

### PF-01 Registry Completeness
18 Center 必须各有唯一 `centerId` 与唯一名称。

### PF-02 Domain Authority Uniqueness
每个 Center 的每项 authoritative business state 必须映射到唯一 Domain owner。

### PF-03 Capability Coverage
每个关键体验能力必须映射：

```text
Center L1
→ Domain L1/L2
→ L3/L4
→ acceptance
```

### PF-04 Cross-Center Duplication
同一业务事实只能有一个权威 owner；多个 Center 只能共享入口/投影/操作。

### PF-05 State Consistency
跨 Center 展示的 authoritative state 必须来自同一 authority/version 或明确 scope。

### PF-06 Journey Completeness
每个 P0 Journey 必须定义：

```text
Entry → Context → Action → Pending → Success → Failure → Partial → Recovery → Completion
```

### PF-07 Mutation Ownership
每个 mutation 必须明确：

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

### PF-09 Permission / Privacy
敏感能力必须有 actor、role/scope、resource、sensitive fields、audit requirement。

### PF-10 Failure / Recovery
关键失败必须明确 user-visible state、preserved context、retryability、safe retry、finalization condition。

### PF-11 Superiority Evidence
每个 Center 必须满足：

```text
Competitor Baseline
→ LuckRead Improvement
→ Metric
→ Target
→ Acceptance Test
→ Evidence
```

### PF-12 Cross-Device Continuity
需要跨设备连续的 Center 必须定义同步来源、冲突规则和恢复行为。

### PF-13 Cloudflare-First Boundary
Center 不得因为聚合体验建立不必要的同步 fan-out、外部状态权威或第二基础设施权威。

### PF-14 Payload Boundary
Center 不得读取 Payload internals、私有 schema 或将 internal type 作为公共 DTO。

### PF-15 Observability
关键 mutation、异步任务、错误必须至少能关联：

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
派生 Center view 必须可由 authoritative source + durable event/evidence 重建。

### PF-18 Evidence Closure
每个 PASS claim 必须关联 176 Evidence Registry 的可定位证据。

### PF-19 Data Lifecycle Closure
资源删除、归档、导出、Legal Hold、tombstone、派生清理必须遵守 160。

### PF-20 Migration Closure
Center 所依赖 schema/API/event 变更必须符合 162 的兼容窗口与回滚边界。

### PF-21 Event Closure
生产事件必须符合 163 的 envelope、ordering、dedupe、retry、DLQ、replay semantics。

### PF-22 Saga Closure
跨 Domain mutation 必须符合 164 的 convergence、timeout、compensation 与 reconciliation。

### PF-23 Error / State Closure
Center user-visible error/state 必须符合 166 的统一 taxonomy。

### PF-24 Cache Closure
Center cache 必须符合 167 的 authority/version/invalidation/stale/hot-key 规则。

### PF-25 Scope Closure
Center 必须符合 168 的 tenant / organization / delegation / break-glass boundary。

### PF-26 Security Closure
Secrets、credentials、incident 与 privileged operation 必须符合 169。

### PF-27 Traffic Closure
高频 Center action 必须符合 170 的 rate/quota/traffic shaping。

### PF-28 Observability Closure
Center P0 path 必须符合 171 SLI/SLO/error budget 与隐私 telemetry 规则。

### PF-29 Localization / Accessibility Closure
适用能力必须符合 172/173 的 locale/region/time/currency 与 accessibility baseline。

### PF-30 Identity Closure
跨域实体引用必须符合 174 canonical ID / uniqueness / reference semantics。

### PF-31 Configuration Closure
受配置、Feature Flag、Policy Version 控制的能力必须符合 175。

## 6. Global Cross-Center Checks

```text
C1 18 Center Registry = 154
C2 L1-L4 = 155
C3 UX baseline = 40/41/139/158
C4 Authority map = domain contracts / 74
C5 Cross-cutting dependency set = 160–176
C6 High-risk mutation = Permission/Security/Audit
C7 Async destructive/financial = operationId + idempotency + recovery
C8 Derived views = rebuildable
C9 Current state = authoritative source/version
C10 PASS claims = 176 evidence
```

## 7. Failure Classification

```text
P0 BLOCKER
P1 CONTRACT DEFECT
P2 TRACEABILITY GAP
P3 EVIDENCE GAP
P4 DOCUMENTATION QUALITY GAP
```

P0/P1 必须阻断 Unified CL；P2/P3 若影响关键 capability/security/authority/superiority，同样阻断。

## 8. Pass Rule

```text
18 Centers Registered
AND No Authority Conflict
AND No Unclassified Capability
AND No Cross-Center State Conflict
AND All P0 Journeys Complete
AND All High-Risk Mutations Scoped
AND All Critical Failure Paths Recoverable
AND Cross-Cutting Dependencies Closed
AND All Superiority Claims Evidence-Backed
AND Cloudflare/Payload Boundaries Valid
→ PREFLIGHT PASS
```

否则：

```text
PREFLIGHT FAIL
→ CLASSIFY
→ REPAIR
→ RECHECK
```

## 9. Relation to Existing Gates

```text
139 Global Superiority
→ 154 Center Master Matrix
→ 155 Center Traceability
→ 160–176 Cross-Cutting Contracts
→ 158 Competitor Benchmark
→ 157 Center Preflight
→ 156 Center Admission
→ 74 Final Reconciliation
→ 75 Unified Machine Preflight
→ Unified CL
→ CI
```

Preflight 不得被用来绕过 156、74 或 75。

## 10. Current Status

```text
18_CENTER_SCOPE = COMPLETE
CENTER_TRACEABILITY = COMPLETE
CROSS_CUTTING_CONTRACTS = CLOSED
STATIC_PREFLIGHT_MODEL = COMPLETE
UNIFIED_CL = REQUIRED
IMPLEMENTATION = BLOCKED UNTIL UNIFIED CL + CI PASS
```
