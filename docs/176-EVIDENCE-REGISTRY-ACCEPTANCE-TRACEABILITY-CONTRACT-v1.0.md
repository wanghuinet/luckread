# LuckRead Evidence Registry / Acceptance Traceability Contract v1.0

**状态：P1/P2 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

将文档中的 PASS/READY/完成声明转化为机器可定位、可验证、不可伪造的证据引用，避免出现“合同写了 PASS，但证据为空或过期”。

## 2. Evidence Object

每条证据至少包含：

```text
evidenceId
type
claimId
subjectType
subjectId
source
sourceRef
commitSha
timestamp
producer
result
validUntil (where applicable)
status
```

## 3. Evidence Types

```text
DOCUMENT
CODE
UNIT_TEST
INTEGRATION_TEST
CL
CI
SMOKE
DEPLOYMENT
OBSERVABILITY
PERFORMANCE
SECURITY
USER_ACCEPTANCE
```

## 4. Claim ↔ Evidence

任何重要状态声明必须可追踪：

```text
Requirement
→ Capability
→ Acceptance
→ Evidence
```

`PASS` 不允许只引用一句文档文字作为唯一证据。

## 5. Evidence Freshness

证据必须能够判断是否仍适用于当前 commit / version。

代码、schema、API、policy 发生 breaking change 后，旧证据不得自动继续证明新版本。

## 6. Evidence Integrity

至少记录：

```text
commitSha
sourceRef
timestamp
producer
result
```

证据内容发生改变时必须生成新 evidenceId，而不是静默覆盖历史证据。

## 7. Traceability

核心链：

```text
L1
→ L2
→ L3
→ L4
→ Data
→ API
→ Event
→ Permission/Security
→ Test
→ Evidence
```

跨 Center：

```text
Center L4
→ Domain L4
→ Acceptance
→ Evidence
```

## 8. CL / CI Evidence

CL/CI 结果必须关联：

```text
checkId
commitSha
workflow/run reference
timestamp
result
failure reason
```

`BLOCKED` / `NOT-APPLICABLE` 必须具备可审计理由。

## 9. User Acceptance Evidence

UA 至少记录：

```text
journeyId
role
environment
scenario
expected
observed
result
timestamp
```

不能用“用户说没问题”作为无法定位的最终证据。

## 10. Superiority Evidence

每个关键竞争优势必须形成：

```text
Baseline
→ LuckRead Target
→ Metric
→ Test / Scenario
→ Result
→ Evidence
```

## 11. Negative Evidence

失败、回归和修复也应保留证据链：

```text
failure evidence
→ repair commit
→ rerun evidence
→ closure
```

不得删除失败历史后伪装为一次性 PASS。

## 12. Evidence Lifecycle

```text
CREATED
→ VERIFIED
→ ACTIVE
→ SUPERSEDED
→ EXPIRED / INVALIDATED
```

历史证据可以保留，但不得被当前准入错误复用。

## 13. Privacy / Security

证据不得为了可审计而复制敏感业务数据。

优先保存：

```text
reference
hash
metadata
redacted artifact
```

原始敏感证据必须受到最小权限保护。

## 14. Reproducibility

允许验证者根据 evidence reference 重现或重新验证关键 claim。

无法重现的证据必须明确标记 limitation，不得强制解释为 PASS。

## 15. Integration

与以下合同形成统一链：

```text
139 Global Superiority
154 Center Matrix
155 Center Traceability
157 Center Preflight
158 Benchmark
156 Center Admission
74 Final Reconciliation
75 Unified Machine Preflight
```

## 16. Acceptance

验证：

1. claim 有 evidence；
2. evidence 指向正确 commit；
3. stale evidence 被识别；
4. CL/CI result 可定位；
5. UA 可定位到 scenario；
6. superiority 可定位 baseline/metric；
7. failure→repair→rerun 可追踪；
8. 敏感证据受控。

## 17. STOP Conditions

- PASS claim 无 evidence；
- evidence 无 commit/source reference；
- 旧证据自动证明新 breaking version；
- BLOCKED 被当 PASS；
- 失败证据被删除后重新声明 PASS；
- 证据泄露敏感数据；
- 无法追踪 L4 到 acceptance/evidence。

## 18. READY Gate

```text
Claim
→ Acceptance
→ Evidence Object
→ Integrity
→ Freshness
→ Traceability
→ Privacy/Security
→ Reproducibility
→ READY
```

## 19. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
