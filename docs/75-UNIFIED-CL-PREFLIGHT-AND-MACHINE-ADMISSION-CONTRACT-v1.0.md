# LuckRead Unified CL Preflight & Machine Admission Contract v1.0

**状态：PREFLIGHT-DEFINED / CL-CI-NOT-RUN / CROSS-CUTTING-CONTRACTS-INCLUDED**

## 1. Purpose

本文件定义文档链完成后的统一 CL/CI 前置检查顺序。

它不修改业务合同、不实现业务代码、不替代 CI Workflow；其职责是把最终合同要求转换为确定性的机器检查项目，避免“文档看起来完成”与“实际可以进入代码”之间出现隐性缺口。

## 2. Admission Principle

统一准入必须遵循：

```text
Contract
→ Cross-Cutting Semantics
→ Traceability
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

按最小文件原则：

```text
Entity Deletion / Reference Integrity
→ covered by 160 + 84 Relationship + domain contracts

Release / Smoke / Rollback Closure
→ covered by 71 + this contract

External OSS Lifecycle / Exit
→ covered by 71 + 74 + this contract
```

缺失任一强制横向合同或引用 = FAIL。

## 4. Machine Check Domains

### A. Repository Baseline

检查：

- `main` 为当前基线；
- 当前文档文件存在且 UTF-8；
- 不存在同路径重复合同；
- 当前工作流、脚本与文档引用路径一致；
- 已删除/废弃文档不会被活动代码引用；
- 160–176 强制横向合同均能从当前 `main` 定位。

### B. Contract Index

检查每个 active contract 是否具有：

```text
owner
version
status
scope
authority
dependencies
acceptance
```

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
→ Evidence
```

缺任何一项即 FAIL。

### D. Authority Uniqueness

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

### E. Data Lifecycle / Recovery

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

### F. Schema / Migration

检查：

```text
schema version
compatibility policy
migration owner
backfill strategy
dual-read/write where needed
verification
automatic rollback boundary
```

### G. Event Contract

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

### H. Cross-Domain Consistency

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

### I. Unified Async Operation

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

### J. Unified Error / State

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

### K. Cache

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

### L. Global Scope / Tenant Isolation

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

### M. Security / Secret / Incident

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

### N. Rate / Quota / Traffic

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

### O. Observability

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

### P. Localization / Accessibility

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

### Q. Canonical Identity

所有跨域实体引用必须检查：

```text
canonical ID
resource type
stable URI/reference
uniqueness
non-reuse
external reference mapping
```

### R. Configuration / Policy Versioning

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

### S. Payload Boundary

检查：

- 无 Payload fork；
- 无复制 Payload internal implementation 作为业务核心；
- 无第三方直接访问 Payload internals；
- 自定义逻辑通过官方 extension/API/service/event boundary；
- Worker/domain service 不依赖 CMS internals 作为长期合同。

### T. Cloudflare Runtime

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

外部基础设施必须具有：

```text
justification
→ adapter/API/event boundary
→ failure isolation
→ cost budget
→ upgrade policy
→ exit/removal plan
```

### U. UX Traceability

关键用户旅程必须能够追踪到后端能力和验收。

### V. Evidence Registry

每个重要 PASS 必须能够定位到 176 Evidence Registry，并关联：

```text
claimId
subjectId
commitSha
sourceRef
timestamp
result
```

`BLOCKED` / `NOT-APPLICABLE` 也必须有可审计依据。

### W. Release / Rollback / OSS Closure

Release 必须可关联：

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

外部 OSS 必须可关联版本、owner、security state、退出/替换路径。

## 5. Current GitHub Workflow Boundary

当前 Cloudflare deployment workflow 的发布边界保持不变：文档-only 变更不触发生产部署；代码/配置变更按现有 workflow 进入 build/deploy。

## 6. Unified CL / CI Sequence

```text
1. Repository / Document Baseline
2. Cross-Cutting Contract Presence (160–176)
3. Contract Index Validation
4. L1-L4 Traceability
5. Canonical ID / Entity Reference
6. Authority Uniqueness
7. Data Contract / Lifecycle / Deletion
8. Schema / Migration / Compatibility
9. API Contract Consistency
10. Event Semantics / Ordering / Replay / DLQ
11. Cross-Domain Saga / Compensation
12. Unified Async Operation
13. Unified Error / State
14. Permission / Security / Privacy / Tenant Scope
15. Cache / Invalidation / Hot-Key
16. Rate / Quota / Traffic Shaping
17. Observability / SLI / SLO
18. Localization / Accessibility
19. Feature Flag / Configuration / Policy Versioning
20. Payload Boundary
21. Cloudflare Runtime Boundary
22. OSS Registry / Lifecycle / Exit
23. UX / Center Traceability
24. Reliability / DR / Rollback
25. Test / Acceptance Mapping
26. Evidence Registry Closure
27. Existing Code / Workflow Compatibility
28. Build / Type / Lint / Unit / Integration Checks
29. Deployment Dry Validation
30. Final CL Decision

## 7. CL Result States

机器结果只允许：

```text
PASS
FAIL
BLOCKED
NOT-APPLICABLE
```

不得使用：

```text
probably-pass
manual-pass
acceptable-for-now
```

### PASS

所有强制检查通过。

### FAIL

存在可执行的合同或代码缺陷，必须修复后重新检查。

### BLOCKED

检查无法执行，例如缺少必要凭据、环境或前置 artifact；不得解释为 PASS。

### NOT-APPLICABLE

必须给出机器可审计的理由。

## 8. Evidence Requirements

每个 PASS 必须能够留下最小证据：

```text
checkId
commitSha
timestamp
input/reference
result
failure reason if failed
evidenceId
```

## 9. Final Admission

只有以下链路全部通过，才允许代码进入正式 IMPLEMENTATION：

```text
Contract Complete
→ Cross-Cutting Contracts Closed
→ Reconciliation PASS
→ Machine Preflight PASS
→ CL PASS
→ CI PASS
→ READY
```

如果 CL/CI 发现合同缺陷，应回退到合同层，而不是通过修改测试来掩盖合同缺陷。

## 10. STOP Conditions

- 任一 160–176 mandatory contract missing;
- L1-L4 无法追踪；
- authority 重复；
- Data lifecycle 缺失；
- migration 无兼容/回滚策略；
- Event 缺 ordering/replay/DLQ semantics；
- Saga 无 compensation/convergence owner；
- Async operation 无稳定 identity/state；
- API/Event 缺统一 error/state semantics；
- tenant isolation 缺失；
- secret 无 rotation/revocation/incident response；
- cache 无 authority/version/invalidation；
- UX 无法追踪到能力；
- Payload boundary 被绕过；
- Cloudflare-first 被无理由违反；
- OSS 无 adapter/failure isolation/exit plan；
- evidence 缺失；
- release 无 rollback evidence；
- CL/CI 为 BLOCKED 却被当作 PASS；
- 发现合同问题后通过测试修改掩盖问题。

## 11. Current Status

```text
DOCUMENT CONTRACT CHAIN = CROSS-CUTTING COMPLETE
MACHINE PREFLIGHT        = UPDATED
CL                        = NOT RUN
CI                        = NOT RUN
IMPLEMENTATION            = BLOCKED UNTIL UNIFIED CL + CI PASS
```

**本文件不执行 CL/CI。**
