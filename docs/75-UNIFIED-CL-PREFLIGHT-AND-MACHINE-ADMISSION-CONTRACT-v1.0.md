# LuckRead Unified CL Preflight & Machine Admission Contract v1.0

**状态：PREFLIGHT-DEFINED / L1-L6-INCLUDED / CL-CI-NOT-RUN**

## 1. Purpose

本文件定义文档链完成后的统一 CL/CI 前置检查顺序。

它不修改业务合同、不实现业务代码、不替代 CI Workflow；其职责是把最终合同要求转换为确定性的机器检查项目，避免“文档看起来完成”与“实际可以进入代码”之间出现隐性缺口。

## 2. Admission Principle

统一准入必须遵循：

```text
Contract
→ Cross-Cutting Semantics
→ L1-L4 Traceability
→ L5 Execution Specification
→ L6 Verification Claim
→ Evidence
→ Consistency
→ Machine Check
→ CL / CI
→ Implementation Admission
```

任何检查项失败都不得通过“人工认为没问题”绕过。

## 3. Mandatory Cross-Cutting Contract Set

本次统一准入必须显式纳入：

```text
160 Data Lifecycle / Retention / Erasure
161 Backup / Disaster Recovery / Business Continuity
162 Schema / Migration / Compatibility / Backfill
163 Event Semantics / Delivery / Ordering / Replay / DLQ
164 Cross-Domain Consistency / Saga / Compensation
165 Unified Async Operation
166 Unified Error / State Taxonomy
167 Cache / Invalidation / Hot-Key / Stampede
168 Global Scope / Tenant / Organization Isolation
169 Security / Secret / Key Lifecycle / Incident
170 Rate Limit / Quota / Traffic Shaping
171 Observability / SLI / SLO / Error Budget
172 Localization / Region / Time / Currency
173 Accessibility Baseline
174 Canonical ID / Entity Reference / Uniqueness
175 Feature Flag / Configuration / Policy Versioning
176 Evidence Registry / Acceptance Traceability
```

缺失任一强制横向合同或引用 = FAIL。

## 4. Machine Check Domains

### A. Repository / Contract Baseline

检查：

- `main` 为当前基线；
- 当前文档文件存在且 UTF-8；
- 不存在同路径重复合同；
- 当前工作流、脚本与文档引用路径一致；
- 已删除/废弃文档不会被活动代码引用；
- 160–181 强制合同均能从当前 `main` 定位；
- 任何 active contract 均具 owner/version/status/scope/authority/dependencies/acceptance。

### B. Capability Hierarchy

必须验证：

```text
L1 → L2 → L3 → L4 → L5 → L6
```

机器检查：

- 每个 L2 至少有一个 L3；
- 每个 L3 至少有一个 L4；
- 实现候选 L4 必须有 L5；
- 接受候选 L5 必须有 L6；
- L5/L6 不得创建新的未登记 L1/L2 产品能力；
- 不得存在 orphan L3/L4/L5/L6。

### C. L1-L4 Traceability

每个待实现 L4 必须能够追踪：

```text
L1 → L2 → L3 → L4
→ Data
→ API / Control
→ Event
→ Permission / Security
→ Runtime
→ Cost
→ Test / Acceptance
→ L5
→ L6
```

缺任何强制项即 FAIL。

### D. L5 Execution Specification

每个实现候选 L4 必须验证其 L5 至少包含：

```text
Input / Output
Preconditions
Validation
Authorization / Scope
State Transition
Data Boundary
Concurrency
Idempotency
Transaction Boundary
Event Side Effects
Async Operation
Cache / Derived State
Error Mapping
Recovery
Audit
Observability
Cost / Latency
Test Mapping
Evidence Mapping
```

### E. L6 Verification / Evidence

每个接收候选 L5 至少具有可判定 L6 claim，并可映射：

```text
claim
verification type
test / check
commit
result
evidence reference
```

禁止模糊 PASS。

### F. Authority Uniqueness

机器检查应检测：

- 同一业务实体多个 authority；
- 聚合中心声明 authority；
- Cache/KV/R2/Event 被声明为业务事实 authority；
- 外部 OSS 被声明为业务事实 authority；
- API owner 与 data authority 混淆；
- Saga/Operation/Cache/Telemetry 层意外成为业务事实 authority。

结果：

```text
UNIQUE = PASS
AMBIGUOUS = FAIL
DUPLICATE = BLOCK
```

### G. Data Lifecycle / Recovery

所有 authoritative、derived、event、cache、media、audit、backup 数据必须检查：

```text
retentionClass
lifecycleState
legalHold
export/delete semantics
tombstone/reference integrity
backup interaction
purge verification
```

### H. Schema / Migration

检查：

```text
schema version
compatibility policy
migration owner
backfill strategy
dual-read/write where needed
verification
rollback / forward-fix boundary
```

### I. Event Contract

每个生产事件检查：

```text
eventId
eventType
schemaVersion
occurredAt
producer
resourceRef
correlationId
dedupe/idempotency
delivery semantics
ordering scope
replay/DLQ semantics
```

### J. Cross-Domain Consistency

跨领域流程必须能够说明：

```text
command owner
participant domains
expected sequence
convergence condition
compensation owner
timeout policy
reconciliation
```

### K. Unified Async Operation

所有长时间、异步或跨域操作必须具有：

```text
operationId
operation type
owner
state
progress where applicable
retry/cancel semantics
result reference
expiry/retention
correlationId
```

### L. Unified Error / State

检查所有公开 API、异步 operation 和用户可见状态是否统一支持：

```text
code
category
severity
retryability
user-safe reason
next action
correlationId
```

### M. Cache

检查：

```text
authoritative version
key scope
TTL/stale policy
invalidation source
stampede protection
hot-key policy
rebuildability
```

### N. Global Scope / Tenant Isolation

检查：

```text
actor
subject
tenant
organization
role
scope
resource boundary
delegation
break-glass audit
cross-tenant deny
```

### O. Security / Secret / Incident

检查：

```text
secret ownership
storage boundary
rotation
revocation
exposure response
incident severity
containment
forensics/audit
break-glass
```

### P. Rate / Quota / Traffic

检查：

```text
identity key
resource key
tenant key
burst
sustained rate
retry semantics
fairness
emergency throttle
```

### Q. Observability

检查：

```text
requestId
correlationId
traceId
metric/log/trace naming
SLI
SLO
error budget
sampling
retention
PII redaction
```

Telemetry 不得成为业务成功条件。

### R. Localization / Accessibility

检查：

```text
locale fallback
region policy
timezone
currency
content availability
keyboard
screen reader
focus
caption/motion/touch-target acceptance where applicable
```

### S. Canonical Identity

所有跨域实体引用必须检查：

```text
canonical ID
resource type
stable URI/reference
uniqueness
non-reuse
external reference mapping
```

### T. Configuration / Policy Versioning

所有 feature flags、configuration、policy 必须检查：

```text
owner
version
scope
rollout
targeting
expiry
kill switch
audit
rollback
schema compatibility
```

### U. Payload Boundary

检查：

- 无 Payload fork；
- 无复制 Payload internal implementation 作为业务核心；
- 无第三方直接访问 Payload internals；
- 自定义逻辑通过官方 extension/API/service/event boundary；
- Worker/domain service 不依赖 CMS internals 作为长期合同。

### V. Cloudflare Runtime

默认路径必须保持：

```text
Workers
├── D1 authoritative structured state
├── R2 objects/media
├── Cache/KV derived/hot state
├── Queues async work
├── Durable Objects strong coordination when justified
└── Workflows durable execution when appropriate
```

### W. UX / Center Traceability

关键用户旅程必须能够追踪：

```text
Journey
→ L1-L4 capability
→ L5 execution
→ API/Event
→ Domain authority
→ Permission/Risk
→ Runtime
→ L6 verification
→ Acceptance
```

### X. Evidence / Release / OSS Closure

Evidence 必须可追踪到当前 commit。

Release 必须形成：

```text
source commit
→ artifact
→ Worker version
→ deployment
→ smoke
→ observability verification
→ rollback target
→ closure evidence
```

OSS 必须具备版本、owner、security state、adapter/failure isolation 与退出路径。

## 5. Unified CL / CI Sequence

```text
1. Repository / Document Baseline
2. Cross-Cutting Contract Presence (160–181)
3. Contract Index Validation
4. L1-L4 Traceability
5. L5 Execution Specification Mapping
6. L6 Verification Mapping
7. Evidence Registry Linkage
8. Canonical ID / Entity Reference
9. Authority Uniqueness
10. Data + Lifecycle + Deletion
11. Schema / Migration / Compatibility
12. API Contract Consistency
13. Event Semantics / Ordering / Replay / DLQ
14. Cross-Domain Saga / Compensation
15. Unified Async Operation
16. Unified Error / State
17. Permission / Security / Privacy / Tenant Scope
18. Cache / Invalidation / Hot-Key
19. Rate / Quota / Traffic Shaping
20. Observability / SLI / SLO
21. Localization / Accessibility
22. Feature Flag / Configuration / Policy Versioning
23. Payload Boundary
24. Cloudflare Runtime Boundary
25. OSS Registry / Lifecycle / Exit
26. UX / Center Traceability
27. Reliability / DR / Rollback
28. Test / Acceptance Mapping
29. Existing Code / Workflow Compatibility
30. Build / Type / Lint / Unit / Integration Checks
31. Deployment Dry Validation
32. Final CL Decision
```

## 6. CL Result States

机器结果只允许：

```text
PASS
FAIL
BLOCKED
NOT-APPLICABLE
```

PASS 必须有 Evidence；BLOCKED 不得解释成 PASS。

## 7. Implementation Admission

```text
Contract Complete
→ L1-L6 Traceability Complete
→ Reconciliation PASS
→ Machine Preflight PASS
→ CL PASS
→ CI PASS
→ READY
```

## 8. STOP Conditions

- mandatory contract missing;
- L1-L6 断链；
- L5 引入未登记产品能力；
- L6 不可验证；
- authority 重复；
- migration 无兼容/回滚策略；
- event 无 ordering/replay/DLQ semantics；
- saga 无 compensation/convergence owner；
- async operation 无 stable identity/state；
- tenant isolation 缺失；
- security lifecycle 缺失；
- cache 无 authority/version/invalidation；
- UX 无能力与验收追踪；
- Payload boundary 被绕过；
- Cloudflare-first 被无理由违反；
- OSS 无 exit/failure isolation；
- evidence 缺失；
- release 无 rollback evidence；
- CL/CI 为 BLOCKED 却被当作 PASS。

## 9. Current Status

```text
DOCUMENT CONTRACT CHAIN = L1-L6 READY FOR CL
MACHINE PREFLIGHT        = DEFINED
CL                        = NOT RUN
CI                        = NOT RUN
IMPLEMENTATION            = BLOCKED UNTIL PASS
```

**本文件不执行 CL/CI。**
