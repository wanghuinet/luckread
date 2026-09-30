# LuckRead L5-L6 IP License Lifecycle / Usage / Compliance / Renewal / Revocation Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 211 IP License Lifecycle / Usage / Compliance / Renewal / Revocation Contract 实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

原则：

```text
L4 Product Contract
→ L5 Execution Unit
→ L6 Verification Atomic Unit
→ Evidence
```

本文件不新增产品能力，不创造新的 Rights、Risk、Commerce、Agreement、License 或 Ledger 权威，也不授权代码实现。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| License Lifecycle | L5-IP-212-LIFECYCLE | 001-003 | PENDING |
| Effective Date | L5-IP-212-EFFECTIVE | 004-006 | PENDING |
| Current Rights Projection | L5-IP-212-CURRENTSCOPE | 007-009 | PENDING |
| Usage Scope | L5-IP-212-USAGESCOPE | 010-012 | PENDING |
| Usage Authorization | L5-IP-212-USAGECHECK | 013-015 | PENDING |
| Pre-Use Approval | L5-IP-212-PREAPPROVAL | 016-018 | PENDING |
| Usage Evidence | L5-IP-212-USAGEEVIDENCE | 019-021 | PENDING |
| Over-Scope Detection | L5-IP-212-OVERSCOPE | 022-025 | PENDING |
| Compliance Monitoring | L5-IP-212-COMPLIANCE | 026-028 | PENDING |
| Compliance Decision | L5-IP-212-COMPLIANCE-DECISION | 029-031 | PENDING |
| Cure / Remediation | L5-IP-212-CURE | 032-034 | PENDING |
| Suspension | L5-IP-212-SUSPEND | 035-037 | PENDING |
| Revocation | L5-IP-212-REVOKE | 038-040 | PENDING |
| Revocation Propagation | L5-IP-212-REVOKE-PROP | 041-043 | PENDING |
| Expiration | L5-IP-212-EXPIRE | 044-046 | PENDING |
| Grace Period | L5-IP-212-GRACE | 047-049 | PENDING |
| Renewal | L5-IP-212-RENEW | 050-053 | PENDING |
| Expansion | L5-IP-212-EXPAND | 054-057 | PENDING |
| Amendment | L5-IP-212-AMEND | 058-060 | PENDING |
| Reporting | L5-IP-212-REPORT | 061-063 | PENDING |
| Royalty / Revenue Share | L5-IP-212-ROYALTY | 064-066 | PENDING |
| Audit Rights | L5-IP-212-AUDITRIGHTS | 067-068 | PENDING |
| Usage Dashboard | L5-IP-212-DASHBOARD | 069-071 | PENDING |
| Expiry Notifications | L5-IP-212-NOTIFY | 072-074 | PENDING |
| Renewal Recommendation | L5-IP-212-RECOMMEND | 075-076 | PENDING |
| Public Verification | L5-IP-212-PUBLICVERIFY | 077-079 | PENDING |
| Certificate Lifecycle | L5-IP-212-CERTIFICATE | 080-082 | PENDING |
| Evidence Chain | L5-IP-212-EVIDENCE | 083-085 | PENDING |
| Operational Alerts | L5-IP-212-ALERTS | 086-088 | PENDING |
| Data Retention | L5-IP-212-RETENTION | 089-090 | PENDING |
| Security / Privacy | L5-IP-212-PRIVACY | 091-093 | PENDING |
| Audit | L5-IP-212-AUDIT | 094-096 | PENDING |

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

## 4. L5-IP-212-LIFECYCLE

维护 License 生命周期：

```text
PENDING
→ ACTIVE
→ EXPIRING
→ EXPIRED
```

控制状态：

```text
SUSPENDED
REVOKED
TERMINATED
AMENDED
```

状态历史必须 append-only。

## 5. L5-IP-212-EFFECTIVE

License 进入 ACTIVE 前必须存在：

```text
effectiveFrom
effectiveTo
activationConditions
activationEvidenceRefs
```

签约或付款单独完成不产生 Active 结论。

## 6. L5-IP-212-CURRENTSCOPE

当前使用范围必须来自 License Authority 的当前有效投影：

```text
License
→ Current Effective Scope
→ Usage Decision
```

历史 Scope Snapshot 仅用于审计。

## 7. L5-IP-212-USAGESCOPE

统一维度：

```text
rights
usage
media
channels
territory
language
term
exclusivity
derivative
sublicense
```

实际使用必须逐维落入有效 Scope。

## 8. L5-IP-212-USAGECHECK

使用前执行：

```text
License Status
+
Current Scope
+
Requested Usage
+
Territory
+
Channel
+
Time Window
+
Required Approval
→
USAGE_ALLOWED / REVIEW / BLOCKED
```

REVIEW 不得被解释为允许。

## 9. L5-IP-212-PREAPPROVAL

支持：

```text
Brand
Character
Packaging
Content
Campaign
Territory
```

每次批准必须绑定：

```text
licenseId
scopeVersion
assetVersion
approvalPolicyVersion
approvalDecision
```

## 10. L5-IP-212-USAGEEVIDENCE

使用证据至少支持：

```text
assetRef
campaignRef
productRef
contentRef
channelRef
territoryRef
usedAt
usageType
evidenceRef
```

Usage Evidence 不自动创造 License 权利。

## 11. L5-IP-212-OVERSCOPE

检测：

```text
Territory Overrun
Term Overrun
Channel Overrun
Media Overrun
Industry Overrun
Product Category Overrun
Exclusivity Violation
Derivative Violation
Sublicense Violation
```

结果：

```text
IN_SCOPE
POTENTIAL_OVER_SCOPE
CONFIRMED_OVER_SCOPE
```

CONFIRMED_OVER_SCOPE 必须进入正式处理。

## 12. L5-IP-212-COMPLIANCE

可配置持续监测：

```text
Usage
Brand
Content
Territory
Term
Approval
Reporting
```

规则必须版本化。

## 13. L5-IP-212-COMPLIANCE-DECISION

统一结果：

```text
PASS
PASS_WITH_CONDITIONS
REVIEW
BLOCK
```

Compliance Decision 不重写 License 权利事实。

## 14. L5-IP-212-CURE

发现问题后：

```text
NOTICE
→ CURE_PERIOD
→ REMEDIATION
→ RECHECK
→ RESOLVED / ESCALATED
```

必须保存责任主体、截止时间、整改证据。

## 15. L5-IP-212-SUSPEND

正式触发来源：

```text
Rights Issue
Compliance Breach
Risk Decision
Agreement Breach
Payment Condition
Legal / Administrative Decision
```

SUSPENDED 必须影响授权使用判断与公开验证。

## 16. L5-IP-212-REVOKE

撤销必须引用正式来源：

```text
Rights Revocation
Agreement Termination
Authority Withdrawal
Material Breach
Legal / Administrative Decision
```

禁止由 Trading UI 单独制造 REVOKED。

## 17. L5-IP-212-REVOKE-PROP

撤销传播：

```text
Current License
→ Usage Authorization
→ Fulfillment
→ Certificate
→ Public Verification
→ Renewal Offers
→ Expansion Offers
```

历史交易事实不得删除。

## 18. L5-IP-212-EXPIRE

自动生命周期：

```text
EXPIRING
→ EXPIRED
```

EXPIRED 后新的 Usage Authorization 默认 BLOCKED。

## 19. L5-IP-212-GRACE

宽限期必须显式保存：

```text
gracePeriodStart
gracePeriodEnd
gracePolicyVersion
allowedActions
```

宽限期不是 Term 自动延长。

## 20. L5-IP-212-RENEW

续期前重新检查：

```text
Rights
Buyer Eligibility
Risk
Conflict
Price
Agreement
Compliance
```

续期产生新的生命周期版本。

## 21. L5-IP-212-EXPAND

扩权：

```text
Territory
Channel
Media
Industry
Product Category
Term
Exclusivity
Derivative
Sublicense
```

必须进行新的 Scope Validation 与 Trade Admission。

## 22. L5-IP-212-AMEND

有效授权变更：

```text
Original Agreement
→ Amendment
→ New Scope / Terms
→ License Revision
```

历史 Scope 不可覆盖。

## 23. L5-IP-212-REPORT

支持：

```text
Usage Report
Sales Report
Campaign Report
Territory Report
Channel Report
Royalty Report Reference
```

报告按周期版本化。

## 24. L5-IP-212-ROYALTY

记录：

```text
reportingPeriod
basis
reportedAmount
royaltyRateReference
revenueShareReference
settlementReference
```

最终结算事实由 Commerce / Ledger Authority 管理。

## 25. L5-IP-212-AUDITRIGHTS

审计权配置：

```text
reportingFrequency
auditedPeriod
auditorReference
auditableFields
auditRequestProcess
```

## 26. L5-IP-212-DASHBOARD

Licensee 当前视图：

```text
Active Rights
Used Scope
Remaining Term
Upcoming Expiry
Usage Alerts
Compliance Issues
Reports
Renewal Options
Expansion Options
```

Dashboard 是 Projection，不是 License Authority。

## 27. L5-IP-212-NOTIFY

支持策略化通知：

```text
90d
60d
30d
7d
1d
Expired
```

通知策略必须版本化。

## 28. L5-IP-212-RECOMMEND

推荐可以基于：

```text
Usage
Expiry
Historical Relationship
Price
Demand
```

但：

```text
Recommendation ≠ Renewal
```

## 29. L5-IP-212-PUBLICVERIFY

公开验证必须实时映射：

```text
ACTIVE
EXPIRED
SUSPENDED
REVOKED
INVALID
```

禁止继续返回过期旧状态。

## 30. L5-IP-212-CERTIFICATE

证书生命周期：

```text
ISSUED
ACTIVE
EXPIRED
SUSPENDED
REVOKED
SUPERSEDED
```

Amendment / Renewal 必须明确新证书与旧证书关系。

## 31. L5-IP-212-EVIDENCE

生命周期证据链：

```text
License
→ Usage Decision
→ Approval
→ Asset / Product Usage
→ Compliance Result
→ Report
→ Renewal / Amendment
→ Expiry / Revocation
```

关键节点必须绑定 Evidence Registry。

## 32. L5-IP-212-ALERTS

至少包括：

```text
EXPIRING
USAGE_OVER_SCOPE
COMPLIANCE_REVIEW
REPORT_DUE
RENEWAL_DUE
RIGHTS_CHANGED
RISK_CHANGED
REVOCATION_EVENT
```

Alert 不等同正式 License 状态变更。

## 33. L5-IP-212-RETENTION

必要历史记录包括：

```text
Agreement
License
Certificate
Usage Evidence
Approval
Compliance
Reports
Revocation
```

具体保留期遵循 Data Lifecycle / Privacy Contract。

## 34. L5-IP-212-PRIVACY

敏感数据至少包括：

```text
Product Launch
Campaign Data
Usage Volume
Sales
Royalty
Customer Information
Internal Review
```

访问分级并最小暴露。

## 35. L5-IP-212-AUDIT

审计：

```text
License State
Scope
Usage Check
Approval
Compliance
Over-Scope
Suspension
Revocation
Renewal
Expansion
Amendment
Certificate
```

关键决策必须具有 actor、timestamp、before/after、reason、evidenceRef。

## 36. L6 Verification Atomic Units

### L6-IP-212-001
License 生命周期状态必须符合定义状态机。

### L6-IP-212-002
生命周期状态历史不得原地覆盖。

### L6-IP-212-003
状态变更必须可追溯至正式事件或决策。

### L6-IP-212-004
ACTIVE License 必须具有有效 effectiveFrom/effectiveTo 语义。

### L6-IP-212-005
ACTIVE 结论必须存在 activation evidence。

### L6-IP-212-006
签约或付款单独完成不能生成 Active License。

### L6-IP-212-007
Current Effective Scope 必须来自当前 License Authority 投影。

### L6-IP-212-008
历史 Scope Snapshot 不能作为当前权利状态的唯一来源。

### L6-IP-212-009
Current Scope 能够逐维解释授权边界。

### L6-IP-212-010
Usage Scope 必须包含完整核心授权维度。

### L6-IP-212-011
实际使用能够与 Current Scope 进行确定性比较。

### L6-IP-212-012
超出任一关键维度时不能判定为 IN_SCOPE。

### L6-IP-212-013
Usage Check 必须返回 ALLOWED、REVIEW 或 BLOCKED。

### L6-IP-212-014
REVIEW 不得被客户端解释为 ALLOWED。

### L6-IP-212-015
Usage Authorization 必须读取当前 License 状态。

### L6-IP-212-016
事前审批必须绑定 License Scope Version。

### L6-IP-212-017
审批记录必须绑定对应 Asset Version。

### L6-IP-212-018
必需审批缺失时不能进入 ALLOWED。

### L6-IP-212-019
Usage Evidence 必须具有来源引用。

### L6-IP-212-020
Usage Evidence 不得单独创造 License 权利。

### L6-IP-212-021
实际使用事件能够关联到授权主体。

### L6-IP-212-022
Territory Overrun 能被识别。

### L6-IP-212-023
Term Overrun 能被识别。

### L6-IP-212-024
Channel / Media / Industry / Product Category Overrun 能被识别。

### L6-IP-212-025
CONFIRMED_OVER_SCOPE 必须进入正式处理路径。

### L6-IP-212-026
持续 Compliance Monitor 使用明确 Policy Version。

### L6-IP-212-027
Compliance Decision 采用统一结果词汇。

### L6-IP-212-028
Compliance BLOCK 不得被 UI 降级为 PASS。

### L6-IP-212-029
Compliance Decision 不改变 Rights Ownership。

### L6-IP-212-030
整改流程保留通知、期限、整改和复核记录。

### L6-IP-212-031
未完成的 blocking cure condition 不得被标记 RESOLVED。

### L6-IP-212-032
正式 Suspension 原因必须可追溯。

### L6-IP-212-033
SUSPENDED License 的新使用请求不能返回 ALLOWED。

### L6-IP-212-034
REVOKED 必须来自正式授权来源或正式终止决策。

### L6-IP-212-035
Trading UI 不能单独制造 REVOKED。

### L6-IP-212-036
Revocation 会识别所有受影响 License。

### L6-IP-212-037
Revocation 会更新受影响 Certificate / Public Verification。

### L6-IP-212-038
历史交易记录不会因 Revocation 被删除。

### L6-IP-212-039
EXPIRING 可以按时间进入 EXPIRED。

### L6-IP-212-040
EXPIRED License 的新使用默认 BLOCKED。

### L6-IP-212-041
宽限期必须具有明确 Policy Version。

### L6-IP-212-042
宽限期不能改变原始 License Term。

### L6-IP-212-043
Renewal 前必须重新执行 Rights / Eligibility / Risk / Conflict / Price / Agreement / Compliance 检查。

### L6-IP-212-044
Renewal 不覆盖原历史 License 记录。

### L6-IP-212-045
Expansion 必须重新执行 Scope Validation。

### L6-IP-212-046
Expansion 不能修改历史 Scope Snapshot。

### L6-IP-212-047
Amendment 必须形成新版本关系。

### L6-IP-212-048
Usage / Sales / Campaign / Territory / Channel Report 必须按周期版本化。

### L6-IP-212-049
Royalty Report 必须保留 reportingPeriod 与 basis。

### L6-IP-212-050
Royalty 报告不直接覆盖 Ledger 事实。

### L6-IP-212-051
Audit Rights 配置可追溯至授权条款。

### L6-IP-212-052
Usage Dashboard 能区分当前权利、已使用范围和剩余期限。

### L6-IP-212-053
Dashboard 不创建新的 License Fact。

### L6-IP-212-054
Expiry Notifications 使用版本化策略。

### L6-IP-212-055
Notification 不等于 License Status Mutation。

### L6-IP-212-056
Renewal Recommendation 不得自动完成 Renewal。

### L6-IP-212-057
Public Verification 能实时识别 ACTIVE / EXPIRED / SUSPENDED / REVOKED / INVALID。

### L6-IP-212-058
Certificate 状态必须能够与 License 生命周期关联。

### L6-IP-212-059
Renewal / Amendment 后能识别旧证书与新证书关系。

### L6-IP-212-060
Evidence Chain 能从 License 回溯到 Usage / Compliance / Renewal / Revocation。

### L6-IP-212-061
关键 Alert 必须来源于明确事件或状态。

### L6-IP-212-062
Alert 不得直接覆盖正式 License State。

### L6-IP-212-063
数据保留策略引用 Data Lifecycle Contract。

### L6-IP-212-064
商业敏感 Usage / Royalty 数据默认最小权限。

### L6-IP-212-065
关键生命周期决策必须记录 actor / timestamp / reason。

### L6-IP-212-066
关键生命周期决策必须绑定 Evidence 或正式 Authority Reference。

## 37. Cross-Contract Dependencies

```text
210 Trade Execution
 ↓
License Authority
 ↓
212 Lifecycle / Usage / Compliance
 ↓
64 Rights
62 Risk / Trust
63 Moderation / Appeals
68 Wallet / Ledger
160 Data Lifecycle
163 Event Semantics
176 Evidence Registry
200 Authorization / Certificate
```

## 38. Acceptance Gates

```text
[ ] Lifecycle state machine instantiated
[ ] Current scope projection instantiated
[ ] Usage authorization instantiated
[ ] Pre-use approval instantiated
[ ] Over-scope detection instantiated
[ ] Compliance / cure instantiated
[ ] Suspension / revocation propagation instantiated
[ ] Expiry / grace instantiated
[ ] Renewal / expansion / amendment instantiated
[ ] Reporting / royalty instantiated
[ ] Certificate lifecycle instantiated
[ ] Public verification instantiated
[ ] Evidence chain instantiated
[ ] Privacy / audit instantiated
[ ] L6 evidence requirement defined
```

## 39. Implementation Boundary

本注册表只定义 L5/L6 可验证结构，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
