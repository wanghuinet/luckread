# LuckRead IP License Lifecycle / Usage / Compliance / Renewal / Revocation Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 IP License 生效后的持续生命周期，确保授权不是“签约结束即结束”，而是形成从生效、实际使用、履约、合规、监测、续期、扩权、变更、暂停、撤销到最终结束的完整可审计生命周期。

核心链路：

```text
Active License
→ Usage Authorization
→ Fulfillment
→ Compliance Monitoring
→ Usage / Royalty Reporting
→ Renewal / Expansion / Amendment
→ Expiry / Suspension / Revocation
→ Closure / Archive
```

本合同不创造新的 Rights、Risk、Commerce、Agreement、License 或 Ledger Authority。

## 2. 北极星原则

授权资产必须始终能够回答：

```text
现在是否有效
谁可以使用
可以使用什么
在哪里使用
什么时候到期
有哪些限制
是否需要事前审批
已经用了多少
是否存在超范围使用
是否需要续期
是否被暂停或撤销
凭什么证明
```

## 3. License Lifecycle State

标准状态：

```text
PENDING
ACTIVE
EXPIRING
EXPIRED
```

控制状态：

```text
SUSPENDED
REVOKED
TERMINATED
AMENDED
```

状态历史必须 append-only。

## 4. Effective Date

License 只有在所有激活条件满足后才能进入 `ACTIVE`。

必须记录：

```text
effectiveFrom
effectiveTo
activationConditions
activationEvidenceRefs
```

不得依据付款完成或签约完成单独推定生效。

## 5. Current Rights Projection

License 当前可使用范围必须由正式 License Authority 投影产生：

```text
License
→ Current Effective Scope
→ Usage Decision
```

历史快照用于审计，不得直接替代当前权利状态。

## 6. Usage Scope

最小授权范围：

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

任何实际使用都必须落在有效 Scope 内。

## 7. Usage Authorization Check

实际使用前可执行：

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

`REVIEW` 不得被客户端解释为允许使用。

## 8. Pre-Use Approval

支持：

```text
Brand Approval
Character Approval
Packaging Approval
Content Approval
Campaign Approval
Territory Approval
```

每次审批绑定：

```text
licenseId
scopeVersion
assetVersion
approvalPolicyVersion
approvalDecision
```

## 9. Usage Evidence

平台可记录实际使用证据：

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

Usage Evidence 是履约/合规证据，不自动创造 License 权利。

## 10. Over-Scope Detection

必须检测：

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

CONFIRMED_OVER_SCOPE 必须触发正式处理。

## 11. Compliance Monitoring

高价值授权可以配置持续监测：

```text
Usage Compliance
Brand Compliance
Content Compliance
Territory Compliance
Term Compliance
Approval Compliance
Reporting Compliance
```

监测规则必须版本化。

## 12. Compliance Decision

统一结果：

```text
PASS
PASS_WITH_CONDITIONS
REVIEW
BLOCK
```

Risk / Compliance 的结果不得直接重写 License 权利事实。

## 13. Cure / Remediation

发现问题后可进入：

```text
NOTICE
→ CURE_PERIOD
→ REMEDIATION
→ RECHECK
→ RESOLVED / ESCALATED
```

补救过程必须记录责任主体、截止时间和证据。

## 14. Suspension

License 可因正式规则进入 `SUSPENDED`：

```text
Rights Issue
Compliance Breach
Risk Decision
Agreement Breach
Payment Condition
Court / Administrative Decision
```

SUSPENDED 时公开验证应体现非有效状态。

## 15. Revocation

撤销来源包括：

```text
Rights Revocation
Agreement Termination
Authority Withdrawal
Material Breach
Legal / Administrative Decision
```

REVOKED 是正式状态，不能仅由交易中心 UI 标记。

## 16. Revocation Propagation

撤销必须影响：

```text
Current License
Usage Authorization
Open Fulfillment
Authorization Certificate
Public Verification
Renewal Offers
Expansion Offers
```

历史交易事实不得删除。

## 17. Expiration

到期必须能够自动进入：

```text
EXPIRING
→ EXPIRED
```

到期后新的 Usage Authorization 默认 `BLOCKED`。

## 18. Grace Period

如业务允许宽限期，必须显式定义：

```text
gracePeriodStart
gracePeriodEnd
gracePolicyVersion
allowedActions
```

宽限期不能被解释为自动延长 License Term。

## 19. Renewal

续期前必须重新检查：

```text
Rights
Buyer Eligibility
Risk
Conflict
Price
Agreement
Compliance
```

续期生成新的有效版本或生命周期实例，不覆盖历史记录。

## 20. Expansion

扩权支持：

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

扩权必须经过新的准入与权利验证。

## 21. Amendment

有效 License 发生实质变更时必须关联：

```text
Original Agreement
→ Amendment
→ New Scope / Terms
→ License Revision
```

历史 Scope Snapshot 保持不可变。

## 22. Reporting

支持：

```text
Usage Report
Sales Report
Campaign Report
Territory Report
Channel Report
Royalty Report Reference
```

报告版本化并绑定周期。

## 23. Royalty / Revenue Share

支持记录：

```text
reportingPeriod
basis
reportedAmount
royaltyRateReference
revenueShareReference
settlementReference
```

实际结算由 Commerce / Ledger Authority 决定。

## 24. Audit Rights Reference

复杂授权可以定义：

```text
reportingFrequency
auditedPeriod
auditorReference
auditableFields
auditRequestProcess
```

不得将审计引用直接写成财务最终事实。

## 25. Usage Dashboard

Licensee 应能查看：

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

Dashboard 是当前状态投影，不是新的 License Authority。

## 26. Expiry Notifications

应支持：

```text
90d
60d
30d
7d
1d
Expired
```

通知时间可由 Policy Version 控制。

## 27. Renewal Recommendation Boundary

系统可以根据：

```text
Usage
Expiry
Historical Relationship
Price
Demand
```

推荐续期，但：

```text
Recommendation ≠ Renewal
```

续期必须完成正式 Rights / Eligibility / Agreement 流程。

## 28. Public Verification

公开授权验证必须实时反映：

```text
ACTIVE
EXPIRED
SUSPENDED
REVOKED
INVALID
```

不得继续显示旧的 `VALID` 状态。

## 29. Certificate Lifecycle

授权书与 License 生命周期绑定：

```text
ISSUED
ACTIVE
EXPIRED
SUSPENDED
REVOKED
SUPERSEDED
```

发生 Amendment / Renewal 时，需要明确是否签发新证书或更新验证投影。

## 30. Evidence Chain

完整生命周期证据链：

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

## 31. Operational Alerts

至少支持：

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

告警不能直接改变正式 License 状态，除非对应 Authority 已作出正式决策。

## 32. Data Retention

交易与授权历史必须保留必要审计信息：

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

具体保留期限遵循平台 Data Lifecycle / Privacy 合同。

## 33. Security / Privacy

Usage / Compliance 数据可能属于商业敏感信息：

```text
Product Launch
Campaign Data
Usage Volume
Sales
Royalty
Customer Information
Internal Review
```

必须最小权限与最小暴露。

## 34. API Surface

建议：

```text
GET  /v1/ip/licenses/{id}
POST /v1/ip/licenses/{id}/usage-check
POST /v1/ip/licenses/{id}/usage-evidence
POST /v1/ip/licenses/{id}/compliance-review
POST /v1/ip/licenses/{id}/reports
POST /v1/ip/licenses/{id}/renew
POST /v1/ip/licenses/{id}/expand
POST /v1/ip/licenses/{id}/amend
POST /v1/ip/licenses/{id}/suspend
POST /v1/ip/licenses/{id}/revoke
GET  /v1/ip/licenses/{id}/timeline
GET  /v1/ip/licenses/{id}/certificate
```

## 35. Event Contract

至少支持：

```text
license.activated
license.expiring
license.expired
license.usage.checked
license.usage.flagged
license.compliance.reviewed
license.report.submitted
license.renewal.due
license.renewed
license.expanded
license.amended
license.suspended
license.revoked
certificate.status_changed
```

## 36. Machine Invariants

```text
I1: ACTIVE License ⇒ activation conditions satisfied
I2: Usage Allowed ⇒ current License scope contains requested usage
I3: REVIEW ≠ ALLOWED
I4: CONFIRMED_OVER_SCOPE ⇒ formal remediation/review required
I5: EXPIRED License ⇒ new usage blocked unless valid replacement exists
I6: SUSPENDED / REVOKED License ⇒ public verification not VALID
I7: Renewal requires current rights recheck
I8: Expansion requires new scope validation
I9: Amendment cannot overwrite historical scope
I10: Certificate status follows License lifecycle
I11: Recommendation ≠ Renewal
I12: Compliance decision ≠ Rights ownership
I13: Historical lifecycle records are append-only
I14: Material rights change triggers affected usage / transaction review
I15: Every critical lifecycle decision can trace to Evidence
```

## 37. Cross-Contract Dependencies

```text
209 / 210 Trade Execution
 ↓
License Authority
 ↓
211 Lifecycle / Usage / Compliance
 ↓
64 Rights
62 Risk / Trust
63 Moderation / Appeals
68 Wallet / Ledger
160 Data Lifecycle
163 Events
176 Evidence Registry
200 Authorization
```

## 38. Acceptance Gates

```text
[ ] License lifecycle state machine complete
[ ] Current scope projection defined
[ ] Usage authorization check defined
[ ] Approval lifecycle defined
[ ] Over-scope detection defined
[ ] Compliance monitoring defined
[ ] Suspension / revocation defined
[ ] Expiration / grace policy defined
[ ] Renewal defined
[ ] Expansion defined
[ ] Amendment defined
[ ] Usage / royalty reporting defined
[ ] Certificate lifecycle defined
[ ] Public verification defined
[ ] Evidence chain defined
[ ] Security / privacy boundary defined
[ ] Machine invariants defined
```

## 39. Implementation Boundary

本合同只定义产品与架构约束，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
