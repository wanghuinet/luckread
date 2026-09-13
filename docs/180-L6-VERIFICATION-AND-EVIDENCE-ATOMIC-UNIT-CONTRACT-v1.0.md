# LuckRead L6 Verification / Evidence Atomic Unit Contract v1.0

**状态：VERIFICATION-CONTRACT / IMPLEMENTATION-PENDING**

## 0. Purpose

L6 是最小可验证工程事实，不是新的产品能力层级。

```text
L1 → L2 → L3 → L4 → L5 → L6
                         ↓
                    Test / Evidence
```

一个 L6 必须能够通过机器测试、代码检查、运行证据或用户验收被明确证明为 PASS / FAIL / BLOCKED / NOT-APPLICABLE。

## 1. Mandatory L6 identity

每个 L6 必须具有：

```text
l6Id
parentL5Id
claim
verificationType
owner
status
```

## 2. Verification types

允许：

```text
UNIT
INTEGRATION
CONTRACT
E2E
SECURITY
PERFORMANCE
RELIABILITY
MIGRATION
SMOKE
USER-ACCEPTANCE
STATIC
```

## 3. Atomic claim rule

L6 claim 必须单一、可判定、可复现。

正确示例：

```text
publish requires owner scope
archived content cannot be published
same idempotency key returns same result
version mismatch returns conflict
successful publish emits content.published
failed publish does not emit content.published
```

禁止模糊 claim：

```text
publish works well
system is fast
security is good
```

## 4. Required evidence

每个 PASS 至少关联：

```text
claimId
checkId
testId or verificationId
commitSha
timestamp
input/reference
result
artifact/log/trace reference where applicable
```

## 5. Negative evidence

必须允许记录：

```text
FAIL
BLOCKED
NOT-APPLICABLE
```

失败不得删除或覆盖成 PASS。

## 6. L5 coverage

一个 L5 至少需要验证：

```text
happy path
validation
authorization
state transition
idempotency/concurrency where applicable
side effects
error mapping
recovery
observability
```

高风险领域额外验证：

```text
security
privacy
rights
financial integrity
cross-tenant isolation
```

## 7. Evidence integrity

Evidence 必须具备：

```text
provenance
freshness
scope
integrity
reproducibility
```

无法定位来源、过期或与当前 commit 不匹配的证据不得直接支持 PASS。

## 8. Test-to-claim mapping

必须能够反向追踪：

```text
L6 claim
→ test
→ implementation
→ L5
→ L4
→ L3
→ L2
→ L1
```

## 9. Runtime evidence

对运行时能力，可使用：

```text
logs
traces
metrics
HTTP responses
queue outcomes
operation records
smoke results
```

但 telemetry 本身不能成为业务事实 authority。

## 10. Performance evidence

性能类 L6 必须包含：

```text
workload
concurrency
dataset size
region/runtime
measurement window
percentiles where applicable
threshold
result
```

## 11. Reliability evidence

可靠性类 L6 应覆盖：

```text
timeout
retry
duplicate
out-of-order
DLQ
replay
dependency outage
recovery
```

## 12. Security / Privacy evidence

必须防止：

```text
cross-scope access
secret leakage
sensitive-field exposure
authorization bypass
unsafe export
```

证据中不得泄露真实 secret 或不必要的个人敏感数据。

## 13. Evidence Registry integration

所有正式 L6 证据必须能够进入 176 Evidence Registry：

```text
Claim
→ Evidence
→ Freshness / Integrity
→ Traceability
→ Decision
```

## 14. Acceptance closure

L6 只有在：

```text
verification executed
result recorded
evidence linked
parent L5 satisfied
no blocking dependency
```

之后才能标记 PASS。

## 15. STOP conditions

- claim 不可判定；
- test 无法复现；
- evidence 缺失；
- evidence 与 commit 不匹配；
- 只有人工口头确认；
- FAIL 被覆盖为 PASS；
- security/privacy 高风险能力没有证据；
- L6 无父级 L5；
- 出现 orphan L6。

## 16. Final engineering hierarchy

```text
L1 = Domain
L2 = Capability
L3 = Atomic Capability
L4 = Implementation Responsibility
L5 = Execution Specification
L6 = Verification / Evidence Atomic Unit
```

L6 不是产品功能层级，而是工程质量闭环层级。

## 17. Final admission

```text
L4
→ L5
→ L6
→ Test
→ Evidence
→ Contract / CL
→ CI
→ Acceptance
```

本文件不执行 CL/CI，也不授权生产实现。
