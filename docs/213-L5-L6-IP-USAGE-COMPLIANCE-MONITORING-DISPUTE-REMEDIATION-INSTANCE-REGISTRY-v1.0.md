# LuckRead L5-L6 IP Usage / Compliance Monitoring / Dispute / Remediation Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 211 License Lifecycle 与相关 Rights / Risk / Moderation / Evidence 要求中的持续使用监测、超范围检测、合规审查、整改、暂停、撤销、争议与证据闭环实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

原则：

```text
Active License
→ Usage Check
→ Evidence
→ Compliance Monitoring
→ Exception Detection
→ Review / Cure
→ Decision
→ Remediation / Suspension / Revocation
→ Verification / Audit
```

本文件不创造新的 License、Rights、Risk、Commerce、Agreement 或 Evidence Authority。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Usage Check | L5-IP-213-USAGECHECK | 001-003 | PENDING |
| Usage Evidence | L5-IP-213-EVIDENCE | 004-006 | PENDING |
| Compliance Rule | L5-IP-213-RULE | 007-009 | PENDING |
| Compliance Schedule | L5-IP-213-SCHEDULE | 010-011 | PENDING |
| Over-Scope Detection | L5-IP-213-OVERSCOPE | 012-015 | PENDING |
| Exception Classification | L5-IP-213-EXCEPTION | 016-018 | PENDING |
| Review Queue | L5-IP-213-REVIEW | 019-021 | PENDING |
| Cure / Remediation | L5-IP-213-CURE | 022-025 | PENDING |
| Compliance Decision | L5-IP-213-DECISION | 026-028 | PENDING |
| Suspension Decision | L5-IP-213-SUSPEND | 029-031 | PENDING |
| Revocation Impact | L5-IP-213-REVOKE | 032-034 | PENDING |
| Usage Restriction | L5-IP-213-RESTRICT | 035-037 | PENDING |
| Dispute Intake | L5-IP-213-DISPUTE | 038-040 | PENDING |
| Evidence / Case Bundle | L5-IP-213-CASE | 041-043 | PENDING |
| Appeal | L5-IP-213-APPEAL | 044-046 | PENDING |
| Resolution | L5-IP-213-RESOLUTION | 047-049 | PENDING |
| Closure | L5-IP-213-CLOSURE | 050-052 | PENDING |
| Monitoring Dashboard | L5-IP-213-DASHBOARD | 053-054 | PENDING |
| Alerts | L5-IP-213-ALERTS | 055-057 | PENDING |
| Audit | L5-IP-213-AUDIT | 058-060 | PENDING |
| Event Publication | L5-IP-213-EVENT | 061-063 | PENDING |

## 3. Common L5 Execution Contract

每个 L5 Unit MUST 明确：

```text
Intent
Input
Output
Preconditions
Validation
Authority
Decision Rule
Scope
State Transition
Data Boundary
Concurrency / Version
Idempotency
Transaction Boundary
Events
Async Behavior
Cache Behavior
Error Taxonomy
Recovery
Audit
Observability
Cost
Test Plan
Evidence Requirement
```

## 4. L5-IP-213-USAGECHECK

实际使用前检查：

```text
Current License
× Current Scope
× Requested Usage
× Territory
× Channel
× Time Window
× Required Approval
→ ALLOWED / REVIEW / BLOCKED
```

必须读取当前有效 License 状态与 Scope。

## 5. L5-IP-213-EVIDENCE

使用证据至少关联：

```text
licenseId
usageEventRef
assetRef
productRef
contentRef
territoryRef
channelRef
usedAt
usageType
evidenceRef
```

Evidence 只能证明使用事实，不能自行扩大 License。

## 6. L5-IP-213-RULE

Compliance Rule 必须版本化：

```text
ruleId
ruleVersion
scope
industry
territory
usageTypes
severity
requiredAction
effectiveFrom
effectiveTo
```

规则变更必须能追溯影响范围。

## 7. L5-IP-213-SCHEDULE

支持：

```text
REAL_TIME
DAILY
WEEKLY
MONTHLY
EVENT_DRIVEN
ON_DEMAND
```

高风险授权可以缩短监测周期。

## 8. L5-IP-213-OVERSCOPE

检测：

```text
Territory
Term
Channel
Media
Industry
Product Category
Exclusivity
Derivative
Sublicense
```

结果：

```text
IN_SCOPE
POTENTIAL_OVER_SCOPE
CONFIRMED_OVER_SCOPE
```

CONFIRMED_OVER_SCOPE 必须进入正式处置流程。

## 9. L5-IP-213-EXCEPTION

异常必须分类：

```text
DATA_QUALITY
POTENTIAL_BREACH
CONFIRMED_BREACH
RIGHTS_CONFLICT
APPROVAL_MISSING
REPORTING_MISSING
POLICY_VIOLATION
```

不能用单一 `ERROR` 覆盖所有情况。

## 10. L5-IP-213-REVIEW

Review Queue 至少支持：

```text
RIGHTS_REVIEW
LEGAL_REVIEW
COMPLIANCE_REVIEW
RISK_REVIEW
DEAL_REVIEW
OPERATIONS_REVIEW
```

Review 不等于 Breach Confirmed，也不等于 Allowed。

## 11. L5-IP-213-CURE

整改流程：

```text
NOTICE
→ CURE_PERIOD
→ REMEDIATION
→ RECHECK
→ RESOLVED / ESCALATED
```

必须记录：

```text
owner
dueAt
remediationPlan
actionEvidence
recheckResult
```

## 12. L5-IP-213-DECISION

统一结果：

```text
PASS
PASS_WITH_CONDITIONS
REVIEW
BLOCK
```

决定必须关联：

```text
ruleVersion
scopeVersion
evidenceRefs
policyVersion
actor / decisionSource
```

## 13. L5-IP-213-SUSPEND

正式 Suspension 来源：

```text
Confirmed Breach
Rights Issue
Risk Decision
Agreement Breach
Legal / Administrative Decision
```

自动告警不得直接伪造正式 SUSPENDED 状态。

## 14. L5-IP-213-REVOKE

撤销影响至少包括：

```text
License
Usage Authorization
Open Fulfillment
Certificate
Public Verification
Renewal
Expansion
```

历史记录不得删除。

## 15. L5-IP-213-RESTRICT

在不立即撤销 License 时可定义限制：

```text
BLOCK_NEW_USAGE
BLOCK_SPECIFIC_CHANNEL
BLOCK_SPECIFIC_TERRITORY
REQUIRE_APPROVAL
REQUIRE_REMEDIATION
```

限制必须有明确范围、期限与来源。

## 16. L5-IP-213-DISPUTE

争议对象可以是：

```text
Usage
Scope
Approval
Compliance Decision
Royalty Report
Suspension
Revocation
```

状态：

```text
OPEN
UNDER_REVIEW
MEDIATION
ESCALATED
RESOLVED
REJECTED
```

## 17. L5-IP-213-CASE

每个 Case 必须能够聚合：

```text
licenseId
usageRefs
evidenceRefs
ruleVersions
decisions
messages
approvals
remediationRecords
```

Case 是调查/审计聚合，不替代原始 Authority。

## 18. L5-IP-213-APPEAL

支持对正式决定提出 Appeal：

```text
SUBMITTED
ACCEPTED
UNDER_REVIEW
UPHELD
MODIFIED
REVERSED
REJECTED
```

Appeal 提交本身不改变原状态。

## 19. L5-IP-213-RESOLUTION

正式 Resolution 必须说明：

```text
decision
scope
effectiveFrom
effectiveTo
reason
policyVersion
evidenceRefs
```

必要时触发 License / Certificate / Public Verification 更新。

## 20. L5-IP-213-CLOSURE

Case 关闭前必须确认：

```text
Decision Final
Required Remediation Complete
Required Evidence Attached
Affected Assets Updated
Notifications Sent
Follow-up Scheduled if required
```

关闭历史不可删除。

## 21. L5-IP-213-DASHBOARD

Licensee / Licensor / authorized internal roles 可分别查看：

```text
Usage Health
Open Alerts
Open Cases
Compliance Score / Status
Upcoming Reviews
Pending Reports
Remediation Due
License Restrictions
```

Dashboard 为 Projection，不是权利事实源。

## 22. L5-IP-213-ALERTS

至少包括：

```text
POTENTIAL_OVER_SCOPE
CONFIRMED_OVER_SCOPE
REPORT_DUE
APPROVAL_MISSING
RIGHTS_CHANGED
RISK_CHANGED
COMPLIANCE_REVIEW
CURE_DUE
REVOCATION_EVENT
```

Alert 只触发流程，不自行修改正式 License 状态。

## 23. L5-IP-213-AUDIT

审计必须覆盖：

```text
Usage Checks
Evidence
Rule Version
Findings
Review
Decision
Remediation
Suspension
Revocation
Dispute
Appeal
Resolution
Closure
```

## 24. L5-IP-213-EVENT

至少发布：

```text
usage.check_requested
usage.checked
usage.evidence.recorded
compliance.finding.created
compliance.review.requested
compliance.decision.made
remediation.requested
remediation.completed
license.restriction.applied
license.suspension.requested
license.revocation.affected
trade.dispute.opened
trade.appeal.submitted
case.resolved
case.closed
```

事件必须可关联 `caseId / licenseId / correlationId`。

## 25. L6 Verification Atomic Units

### L6-IP-213-001
Usage Check 必须读取当前 License 状态。

### L6-IP-213-002
Usage Check 必须使用 Current Scope，而非仅使用旧 Snapshot。

### L6-IP-213-003
REVIEW 不得返回为 ALLOWED。

### L6-IP-213-004
Usage Evidence 必须绑定 License 或明确的 Usage Context。

### L6-IP-213-005
Evidence 缺失时不得伪造完整使用证明。

### L6-IP-213-006
Usage Evidence 不得扩大 License Scope。

### L6-IP-213-007
Compliance Rule 必须具备稳定版本。

### L6-IP-213-008
规则必须具备有效时间范围。

### L6-IP-213-009
规则变更能够定位受影响 License / Case。

### L6-IP-213-010
Monitoring Schedule 必须符合策略。

### L6-IP-213-011
高风险 Scope 可以配置更严格监测频率。

### L6-IP-213-012
Over-Scope 检测必须覆盖 Territory 维度。

### L6-IP-213-013
Over-Scope 检测必须覆盖 Term 维度。

### L6-IP-213-014
Over-Scope 检测必须覆盖 Channel / Media 等维度。

### L6-IP-213-015
CONFIRMED_OVER_SCOPE 必须进入正式处置流程。

### L6-IP-213-016
异常必须使用结构化 Classification。

### L6-IP-213-017
CONFIRMED_BREACH 与 POTENTIAL_BREACH 必须区分。

### L6-IP-213-018
Approval Missing 与 Rights Conflict 必须可独立识别。

### L6-IP-213-019
Review Queue 必须指向明确处理主体。

### L6-IP-213-020
Review 状态不得被解释为最终结论。

### L6-IP-213-021
Cure Period 必须具备 dueAt。

### L6-IP-213-022
整改必须记录责任主体。

### L6-IP-213-023
整改完成必须存在 action evidence。

### L6-IP-213-024
整改完成后必须触发 Recheck。

### L6-IP-213-025
未完成整改不能伪装为 Resolved。

### L6-IP-213-026
Compliance Decision 必须引用 Rule Version。

### L6-IP-213-027
Decision 必须引用 Scope Version。

### L6-IP-213-028
关键 Decision 必须绑定 Evidence。

### L6-IP-213-029
自动 Alert 不得直接制造正式 Suspension。

### L6-IP-213-030
Suspension 必须具有正式来源。

### L6-IP-213-031
Suspension 状态必须影响 Usage Authorization。

### L6-IP-213-032
Revocation 影响必须可定位受影响 License。

### L6-IP-213-033
Revocation 不得删除历史交易。

### L6-IP-213-034
Revocation 必须影响公开验证投影。

### L6-IP-213-035
限制必须具有明确 Scope。

### L6-IP-213-036
限制必须具有有效期限或永久策略标识。

### L6-IP-213-037
限制来源必须可追溯。

### L6-IP-213-038
Dispute 创建必须形成唯一 Case。

### L6-IP-213-039
Case 必须能够聚合相关证据。

### L6-IP-213-040
争议不能直接覆盖原始事实。

### L6-IP-213-041
Case Bundle 必须能够重建关键决策上下文。

### L6-IP-213-042
Case Bundle 不得篡改原始 Evidence。

### L6-IP-213-043
Case 必须记录关键时间线。

### L6-IP-213-044
Appeal 提交不得自动改变原 Decision。

### L6-IP-213-045
Appeal 必须记录提交人和时间。

### L6-IP-213-046
Appeal 结果必须能够追踪到原 Decision。

### L6-IP-213-047
Resolution 必须说明最终决定与生效范围。

### L6-IP-213-048
Resolution 必须绑定 policy/evidence context。

### L6-IP-213-049
Case 关闭前必须满足 Closure Conditions。

### L6-IP-213-050
Closure 不得删除 Case History。

### L6-IP-213-051
Dashboard 不得成为 License Authority。

### L6-IP-213-052
Dashboard 显示状态必须可以回溯正式来源。

### L6-IP-213-053
Alert 必须可以关联 License / Case。

### L6-IP-213-054
Alert 不得直接改变 License 正式状态。

### L6-IP-213-055
Audit 必须记录 Usage Check 结果。

### L6-IP-213-056
Audit 必须记录 Compliance Decision。

### L6-IP-213-057
Audit 必须记录 Remediation / Resolution。

### L6-IP-213-058
关键生命周期事件必须携带 correlationId。

### L6-IP-213-059
关键事件必须可检测重复或乱序。

### L6-IP-213-060
最终 Resolution 必须能够回溯完整 Evidence Chain。

### L6-IP-213-061
重复 Usage Check 请求不得产生无法关联的重复正式事实。

### L6-IP-213-062
重复 Remediation Completion 不得重复关闭多个 Case。

### L6-IP-213-063
相同 Appeal 请求必须具备幂等行为。

## 26. Cross-Contract Dependencies

```text
212 License Lifecycle Instances
 ↓
213 Usage / Compliance / Dispute Instances
 ↓
64 Rights
62 Risk / Trust
63 Moderation / Appeals
68 Wallet / Ledger
160 Data Lifecycle
163 Event Semantics
176 Evidence Registry
200 Authorization
211 License Lifecycle
```

## 27. Acceptance Gates

```text
[ ] Usage authorization instantiated
[ ] Evidence instantiated
[ ] Compliance rule versioning instantiated
[ ] Monitoring schedule instantiated
[ ] Over-scope detection instantiated
[ ] Exception taxonomy instantiated
[ ] Review queue instantiated
[ ] Cure/remediation instantiated
[ ] Compliance decision instantiated
[ ] Suspension/revocation instantiated
[ ] Dispute/Case instantiated
[ ] Appeal/Resolution instantiated
[ ] Closure instantiated
[ ] Dashboard/alerts instantiated
[ ] Audit/event coverage instantiated
[ ] Evidence traceability instantiated
[ ] Idempotency instantiated
```

## 28. Implementation Boundary

本注册表只定义 L5/L6 可验证结构，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
