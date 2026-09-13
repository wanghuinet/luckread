# LuckRead Unified CL Preflight & Machine Admission Contract v1.0

**状态：PREFLIGHT-DEFINED / CL-CI-NOT-RUN**

## 1. Purpose

本文件定义文档链完成后的统一 CL/CI 前置检查顺序。

它不修改业务合同、不实现业务代码、不替代 CI Workflow；其职责是把最终合同要求转换为确定性的机器检查项目，避免“文档看起来完成”与“实际可以进入代码”之间出现隐性缺口。

## 2. Admission Principle

统一准入必须遵循：

```text
Contract
→ Traceability
→ Consistency
→ Machine Check
→ CL / CI
→ Implementation Admission
```

任何检查项失败都不得通过“人工认为没问题”绕过。

## 3. Machine Check Domains

### A. Repository Baseline

检查：

- `main` 为当前基线；
- 当前文档文件存在且 UTF-8；
- 不存在同路径重复合同；
- 当前工作流、脚本与文档引用路径一致；
- 已删除/废弃文档不会被活动代码引用。

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
```

缺任何一项即 FAIL。

### D. Authority Uniqueness

机器检查应检测：

- 同一业务实体多个 authority；
- 聚合中心声明 authority；
- Cache/KV/R2/Event 被声明为业务事实 authority；
- 外部 OSS 被声明为业务事实 authority；
- API owner 与 data authority 混淆。

结果：

```text
UNIQUE = PASS
AMBIGUOUS = FAIL
DUPLICATE = BLOCK
```

### E. API Contract

每个公开或控制 API 检查：

```text
version
owner
DTO
authentication
authorization/scope
privacy
error model
idempotency
pagination
rate/quota
acceptance
```

### F. Event Contract

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
```

### G. Security / Privacy

检查：

- secrets 不进入源码、日志和 telemetry；
- password/token/recovery secret 不进入 DTO；
- 管理控制具有 authorization + audit；
- 私有内容有 ownership/privacy enforcement；
- 外部 App scope 不绕过 domain authorization；
- telemetry 有敏感字段 redaction。

### H. Payload Boundary

检查：

- 无 Payload fork；
- 无复制 Payload internal implementation 作为业务核心；
- 无第三方直接访问 Payload internals；
- 自定义逻辑通过官方 extension/API/service/event boundary；
- Worker/domain service 不依赖 CMS internals 作为长期合同。

### I. Cloudflare Runtime

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

### J. UX Traceability

关键用户旅程必须能够追踪到后端能力和验收。

特别检查 Personal Content Space：

```text
Personal Space
→ Live / 直播 entry
→ Live experience
→ Back / Close
→ originating Personal Space
```

Live 基础设施可独立变化，但该用户导航合同不得被基础设施实现静默删除。

### K. Reliability

高频/异步能力检查：

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
dependency outage
```

Retry 必须有 idempotency；Queue 必须有 recovery/DLQ 策略。

### L. Observability

关键操作至少能够关联：

```text
requestId
correlationId
traceId
operation
owner
result
latency
failure classification
```

Telemetry 不能成为核心业务同步依赖。

### M. Cost

每个非默认基础设施依赖必须有：

```text
expected usage
budget
failure cost
network/runtime cost
operational owner
replacement/removal path
```

### N. Release / Rollback

发布必须能够形成：

```text
source commit
→ artifact
→ Worker version
→ deployment
→ smoke
→ observability verification
→ rollback target
```

## 4. Current GitHub Workflow Boundary

当前 Cloudflare deployment workflow 已声明：

- `main` push 触发部署；
- `docs/**` 与 Markdown 变更被 `paths-ignore` 排除；
- 支持 `workflow_dispatch`；
- 部署前执行依赖安装、Cloudflare 类型生成和 OpenNext build；
- 部署凭据从 GitHub Secrets 注入；
- Worker deployment 通过现有 `pnpm run deploy` 执行。

因此，**本合同文件以及其他纯文档提交不会自动触发当前 Cloudflare deployment workflow**。这一点属于当前发布边界，而不是缺陷；文档阶段不得因为修改合同而触发生产部署。

当前 workflow 已从 GitHub `main` 验证存在。fileciteturn233file0

## 5. Unified CL / CI Sequence

文档链完成后，统一执行顺序应为：

```text
1. Repository / Document Baseline
2. Contract Index Validation
3. L1-L4 Traceability
4. Authority Uniqueness
5. Data Contract Consistency
6. API Contract Consistency
7. Event Contract Consistency
8. Permission / Security / Privacy
9. Payload Boundary
10. Cloudflare Runtime Boundary
11. OSS Registry Consistency
12. UX Traceability
13. Reliability
14. Observability
15. Cost
16. Test / Acceptance Mapping
17. Existing Code / Workflow Compatibility
18. Build / Type / Lint / Unit / Integration Checks
19. Deployment Dry Validation
20. Final CL Decision
```

## 6. CL Result States

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

## 7. Evidence Requirements

每个 PASS 必须能够留下最小证据：

```text
checkId
commitSha
timestamp
input/reference
result
failure reason if failed
```

不能只有人工口头结论。

## 8. Implementation Admission

只有以下链路全部通过，才允许代码进入正式 IMPLEMENTATION：

```text
Contract Complete
→ Reconciliation PASS
→ Machine Preflight PASS
→ CL PASS
→ CI PASS
→ READY
```

如果 CL/CI 发现合同缺陷，应回退到合同层，而不是通过修改测试来掩盖合同缺陷。

## 9. STOP Conditions

- 文档引用不存在；
- active contract 无 owner/status/version；
- L1-L4 无法追踪；
- authority 重复；
- API/Event 缺少必要合同字段；
- 权限或隐私链缺失；
- Payload boundary 被绕过；
- Cloudflare-first 原则被无理由违反；
- OSS 缺少 adapter/boundary/failure isolation；
- UX 无法追踪到能力；
- retry 无幂等；
- queue 无 recovery/DLQ；
- release 无 rollback target；
- evidence 缺失；
- CL/CI 为 BLOCKED 却被当作 PASS；
- 发现合同问题后通过测试修改掩盖问题。

## 10. Current Status

```text
DOCUMENT CONTRACT CHAIN = READY FOR UNIFIED CL
MACHINE PREFLIGHT        = DEFINED
CL                        = NOT RUN
CI                        = NOT RUN
IMPLEMENTATION            = BLOCKED UNTIL PASS
```

**本文件不执行 CL/CI。**
