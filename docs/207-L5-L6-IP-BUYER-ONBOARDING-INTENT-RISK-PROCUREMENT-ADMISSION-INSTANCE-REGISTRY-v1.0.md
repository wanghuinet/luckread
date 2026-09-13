# LuckRead L5-L6 IP Buyer Onboarding / Intent / Risk / Procurement Admission Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 206 买方交易准入合同实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

原则：

```text
L4 Product Contract
→ L5 Execution Unit
→ L6 Verification Atomic Unit
→ Evidence
```

本文件不新增产品能力，不创造新的 Buyer / Rights / Risk / Commerce / Ledger / Agreement 权威，也不授权代码实现。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Buyer Onboarding | L5-IP-207-ONBOARD | 001-003 | PENDING |
| Buyer Verification | L5-IP-207-VERIFY | 004-006 | PENDING |
| Buyer Profile | L5-IP-207-PROFILE | 007-008 | PENDING |
| Buyer Intent | L5-IP-207-INTENT | 009-012 | PENDING |
| Intent Versioning | L5-IP-207-INTENT-VERSION | 013-014 | PENDING |
| Usage Scenario | L5-IP-207-SCENARIO | 015-016 | PENDING |
| Rights Fit | L5-IP-207-RIGHTSFIT | 017-019 | PENDING |
| Buyer Eligibility | L5-IP-207-ELIGIBILITY | 020-022 | PENDING |
| Risk Precheck | L5-IP-207-RISK | 023-026 | PENDING |
| Compliance Profile | L5-IP-207-COMPLIANCE | 027-028 | PENDING |
| Budget | L5-IP-207-BUDGET | 029-030 | PENDING |
| Procurement Workflow | L5-IP-207-PROCUREMENT | 031-034 | PENDING |
| Approval Policy | L5-IP-207-APPROVAL | 035-037 | PENDING |
| Procurement References | L5-IP-207-REFERENCE | 038-039 | PENDING |
| Shortlist | L5-IP-207-SHORTLIST | 040-041 | PENDING |
| Quote Request | L5-IP-207-QUOTE | 042-045 | PENDING |
| Partial Fit Resolution | L5-IP-207-PARTIALFIT | 046-047 | PENDING |
| Buyer Match | L5-IP-207-MATCH | 048-049 | PENDING |
| Total Cost View | L5-IP-207-TOTALCOST | 050-051 | PENDING |
| Enterprise Workspace | L5-IP-207-WORKSPACE | 052-053 | PENDING |
| License Vault Integration | L5-IP-207-VAULT | 054-055 | PENDING |
| Buyer Risk Change | L5-IP-207-RISKCHANGE | 056-057 | PENDING |
| Buyer Suspension | L5-IP-207-SUSPEND | 058-059 | PENDING |
| Fraud / Abuse | L5-IP-207-FRAUD | 060-061 | PENDING |
| Dispute / Appeal | L5-IP-207-APPEAL | 062-063 | PENDING |
| Procurement Deadline | L5-IP-207-DEADLINE | 064-065 | PENDING |
| Security / Privacy | L5-IP-207-PRIVACY | 066-067 | PENDING |
| Audit | L5-IP-207-AUDIT | 068-069 | PENDING |

## 3. L5 Common Execution Contract

每个 L5 Unit MUST 明确：

```text
Intent
Input
Output
Preconditions
Validation
Authority
Scope
State Transition
Data Boundary
Concurrency / Version
Idempotency
Transaction
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

## 4. L5-IP-207-ONBOARD

建立买方交易准入申请。

Input：

```text
subjectId
organizationId?
role
businessType
contactRef
verificationRefs
```

State：

```text
DRAFT → SUBMITTED
```

相同主体与相同申请版本不得产生重复活动申请。

## 5. L5-IP-207-VERIFY

验证买方主体、组织关系、采购角色与必要联系方式。

规则：

```text
Registered User ≠ Verified Buyer
```

任何 VERIFIED 状态都必须存在对应 Evidence。

## 6. L5-IP-207-PROFILE

建立 Buyer Profile：

```text
buyerId
subjectId
organizationId
role
industry
operatingCountries
verificationStatus
riskStatus
procurementStatus
```

Profile 不成为 Identity / Risk / Commerce 权威。

## 7. L5-IP-207-INTENT

自然语言需求先转换为结构化 Intent：

```text
ipType
industry
usage
media
channels
territory
language
term
exclusivity
derivative
sublicense
budget
volume
deadline
```

自然语言原文保留为输入证据，但不能直接成为授权事实。

## 8. L5-IP-207-INTENT-VERSION

Intent 修改产生新版本：

```text
intentId
intentVersion
previousVersionRef
changedBy
changeReason
createdAt
```

已用于 Quote / Deal 的版本不得原地覆盖。

## 9. L5-IP-207-SCENARIO

业务场景映射：

```text
PRODUCT_PACKAGING
APPAREL
TOY
PUBLISHING
GAME
FILM_TV
ANIMATION
ADVERTISING
SOCIAL_MEDIA
ECOMMERCE
LIVE_EVENT
EXHIBITION
DIGITAL_GOODS
DISTRIBUTION
TRANSLATION
REMAKE
BRAND_COLLABORATION
```

必须映射至 License Family / Industry Template。

## 10. L5-IP-207-RIGHTSFIT

执行：

```text
Intent × SKU Scope × Rights Availability
→ RIGHTS_FIT
```

结果：

```text
EXACT_FIT
PARTIAL_FIT
NO_FIT
MANUAL_REVIEW
```

PARTIAL_FIT 不得生成授权结论。

## 11. L5-IP-207-ELIGIBILITY

检查：

```text
Buyer Verification
Industry Eligibility
Territory Eligibility
Usage Eligibility
Channel Eligibility
Contract Eligibility
Risk Status
```

结果：

```text
ELIGIBLE
CONDITIONALLY_ELIGIBLE
INELIGIBLE
MANUAL_REVIEW
```

## 12. L5-IP-207-RISK

风险预审输入：

```text
buyerRisk
industryRisk
usageRisk
territoryRisk
restrictedGeographyPolicy
contentSafety
fraudSignals
transactionRisk
```

输出：

```text
PASS
PASS_WITH_CONDITIONS
REVIEW
BLOCK
```

Risk Decision 不能修改 Rights Ownership。

## 13. L5-IP-207-COMPLIANCE

企业 Compliance Profile：

```text
legalEntity
industry
operatingCountries
restrictedIndustries
complianceContacts
policyReferences
```

规则必须版本化引用。

## 14. L5-IP-207-BUDGET

预算模型：

```text
budgetMin
budgetMax
currency
budgetPeriod
budgetBasis
approvalLimit
```

金额统一使用整数 minor units。

## 15. L5-IP-207-PROCUREMENT

企业采购状态机：

```text
REQUEST
→ INTERNAL_REVIEW
→ BUDGET_APPROVAL
→ PROCUREMENT_APPROVAL
→ QUOTE_REQUEST
→ NEGOTIATION
→ LEGAL_REVIEW
→ PURCHASE
```

内部采购状态不等同外部 Payment Settlement 状态。

## 16. L5-IP-207-APPROVAL

审批可以包括：

```text
BUSINESS
FINANCE
LEGAL
SECURITY
COMPLIANCE
EXECUTIVE
```

每个审批必须记录：

```text
approver
policyVersion
scope
decision
decidedAt
reason
```

审批不能改变 Rights Scope。

## 17. L5-IP-207-REFERENCE

支持：

```text
purchaseRequestNumber
purchaseOrderReference
costCenter
projectCode
businessOwner
legalOwner
financeOwner
```

作为企业流程引用，不绑定具体 ERP。

## 18. L5-IP-207-SHORTLIST

保存：

```text
IP
SKU
Price Snapshot
Scope Snapshot
```

历史 Shortlist 不因当前商品变化而失去原始上下文。

## 19. L5-IP-207-QUOTE

Quote 至少保存：

```text
quoteId
intentVersion
skuId
scopeSnapshot
pricingVersion
requestedQuantity
requestedTerm
requestedTerritory
expiresAt
status
```

状态：

```text
REQUESTED
PREPARING
ISSUED
COUNTERED
ACCEPTED
REJECTED
EXPIRED
CANCELLED
```

Quote 历史 append-only。

## 20. L5-IP-207-PARTIALFIT

Partial Fit 只能产生：

```text
Alternative SKU
Reduced Scope
Expanded Scope Quote
Different Territory
Different Term
Different Channel
Deal Desk
```

禁止 UI 层将 Partial Fit 显示成完整匹配。

## 21. L5-IP-207-MATCH

推荐可考虑：

```text
Rights Fit
Price Fit
Budget Fit
Industry Fit
Territory Fit
Term Fit
Risk Fit
Licensor Trust
Delivery Capability
```

最终授权不由 Match 产生。

## 22. L5-IP-207-TOTALCOST

成本视图区分：

```text
License Fee
Optional Service Fee
Minimum Guarantee
Royalty Reference
Taxes / Charges Reference
Estimated Total Cost
```

Estimated Total Cost 不得直接当作 Ledger Settlement。

## 23. L5-IP-207-WORKSPACE

企业工作区聚合：

```text
Intents
Shortlist
Quotes
Deals
Agreements
Licenses
Authorization Certificates
Renewals
Disputes
```

聚合层不产生新的交易事实。

## 24. L5-IP-207-VAULT

签约后：

```text
Deal
→ Agreement
→ License
→ Authorization
→ Buyer License Vault
```

必须能解释：

```text
What
Where
Until When
Under Which Agreement
Proof
Restrictions
Renewal
Revocation
```

## 25. L5-IP-207-RISKCHANGE

买方风险改变后：

```text
Risk Changed
→ Open Quote Review
→ Open Deal Review
→ Order Eligibility Review
```

不得静默忽略新风险。

## 26. L5-IP-207-SUSPEND

Buyer 状态：

```text
ACTIVE
RESTRICTED
SUSPENDED
BLOCKED
```

SUSPENDED / BLOCKED 不得创建新的高风险授权交易。

## 27. L5-IP-207-FRAUD

风险检测至少覆盖：

```text
Velocity Abuse
Repeated Quote Abuse
Fake Organization
Identity Inconsistency
Payment Risk
Multiple Account Abuse
```

最终 Risk Decision 仍由 Risk / Trust Authority 提供。

## 28. L5-IP-207-APPEAL

买方可以对：

```text
Eligibility
Risk
Quote
Deal
License Restriction
```

发起 Appeal。

Appeal 本身不改变原结论；只有正式审核结果才能改变状态。

## 29. L5-IP-207-DEADLINE

Intent 可保存：

```text
deadline
priority
businessImpact
```

仅用于服务排序，不允许绕过 Rights / Risk / Eligibility。

## 30. L5-IP-207-PRIVACY

买方商业敏感数据分级：

```text
Public
Buyer Private
Organization Private
Deal Private
Internal Review
Auditor Only
```

默认最小暴露。

## 31. L5-IP-207-AUDIT

关键动作必须记录：

```text
actor
action
timestamp
before
after
reason
evidenceRef
```

重点：Intent 修改、Eligibility、Risk、Approval、Quote、Procurement、Manual Override。

## 32. L6 Verification Atomic Units

### L6-IP-207-001
提交有效 Buyer Onboarding 能产生唯一申请记录。

### L6-IP-207-002
相同幂等键不会产生第二个活动申请。

### L6-IP-207-003
只有具备提交权限的主体可以创建申请。

### L6-IP-207-004
Verified Buyer 必须存在有效验证结果。

### L6-IP-207-005
验证结果必须绑定 Evidence。

### L6-IP-207-006
注册用户不会自动成为 Verified Buyer。

### L6-IP-207-007
Buyer Profile 与主体身份引用可追溯关联。

### L6-IP-207-008
Buyer Profile 不会复制成为 Identity Authority。

### L6-IP-207-009
自然语言 Intent 会被转换为结构化字段。

### L6-IP-207-010
自然语言原文不能直接产生授权事实。

### L6-IP-207-011
Intent 修改会生成新版本。

### L6-IP-207-012
Quote / Deal 使用的 Intent 版本不可被原地覆盖。

### L6-IP-207-013
Intent Version 必须保留 previousVersionRef。

### L6-IP-207-014
Intent 版本变化能够被审计。

### L6-IP-207-015
Usage Scenario 能映射到 License Family / Industry Template。

### L6-IP-207-016
未知或不支持场景不能伪装成标准授权场景。

### L6-IP-207-017
Rights Fit 必须同时考虑 Intent、SKU Scope 和当前 Rights Availability。

### L6-IP-207-018
PARTIAL_FIT 不得生成完整授权结论。

### L6-IP-207-019
NO_FIT 不得进入标准授权路径。

### L6-IP-207-020
Buyer Eligibility 必须检查主体、行业、地区、使用和合同资格。

### L6-IP-207-021
INELIGIBLE Buyer 不得通过标准交易准入。

### L6-IP-207-022
CONDITIONALLY_ELIGIBLE 必须保留条件。

### L6-IP-207-023
Risk Precheck 产生标准化 Risk Decision。

### L6-IP-207-024
BLOCK Risk 不得进入标准高风险交易。

### L6-IP-207-025
Risk Decision 不改变 Rights Ownership。

### L6-IP-207-026
Risk REVIEW 必须进入人工或 Deal Desk 路径。

### L6-IP-207-027
Compliance Profile 使用明确的 policy reference。

### L6-IP-207-028
Compliance policy 变更可追踪。

### L6-IP-207-029
Budget 金额使用整数 minor units。

### L6-IP-207-030
Budget 快照可在 Quote / Deal 上追踪。

### L6-IP-207-031
Procurement 状态符合定义状态机。

### L6-IP-207-032
Internal Approval ≠ Payment Settlement。

### L6-IP-207-033
审批决定必须绑定 policyVersion 和 scope。

### L6-IP-207-034
采购审批不能修改 Rights Scope。

### L6-IP-207-035
每项高风险审批都有明确 approver。

### L6-IP-207-036
审批变更保留历史。

### L6-IP-207-037
Approval manual override 必须可审计。

### L6-IP-207-038
采购引用字段不会被当作财务事实。

### L6-IP-207-039
Purchase Reference 可追溯到企业请求。

### L6-IP-207-040
Shortlist 保存 SKU / Price / Scope Snapshot。

### L6-IP-207-041
Shortlist 历史不会随当前 SKU 变化而静默改变。

### L6-IP-207-042
Quote 包含 Intent Version。

### L6-IP-207-043
Quote 包含 Pricing Version 与 Scope Snapshot。

### L6-IP-207-044
Quote 状态迁移符合定义状态机。

### L6-IP-207-045
Quote 历史 append-only。

### L6-IP-207-046
Partial Fit 只能产生明确的替代或升级路径。

### L6-IP-207-047
Partial Fit 不能被 UI 隐藏成 Exact Fit。

### L6-IP-207-048
Match 排序不会直接生成授权。

### L6-IP-207-049
Recommendation ≠ Authorization。

### L6-IP-207-050
Total Cost View 能区分估算成本与最终结算。

### L6-IP-207-051
Estimated Total Cost 不会写入 Ledger 作为最终金额。

### L6-IP-207-052
Enterprise Workspace 可聚合当前采购资产。

### L6-IP-207-053
Workspace 聚合不产生第二交易权威。

### L6-IP-207-054
签约后的 License 能进入 Buyer License Vault。

### L6-IP-207-055
Vault 可解释有效权利、期限、范围与限制。

### L6-IP-207-056
Buyer Risk Change 会触发未完成交易重新评估。

### L6-IP-207-057
Risk Change 不会静默修改已生效 License 的历史事实。

### L6-IP-207-058
SUSPENDED Buyer 不能创建新的高风险授权交易。

### L6-IP-207-059
BLOCKED Buyer 不能绕过状态创建受限交易。

### L6-IP-207-060
Fraud / Abuse Signals 可进入正式风险决策。

### L6-IP-207-061
Fraud Detection 不直接决定 Rights Ownership。

### L6-IP-207-062
Appeal 不会自动改变原决策。

### L6-IP-207-063
Appeal 决定有独立审核证据。

### L6-IP-207-064
Procurement Deadline 不会绕过交易准入检查。

### L6-IP-207-065
Deadline / Priority 修改能够被审计。

### L6-IP-207-066
Buyer Private / Deal Private 数据按最小权限访问。

### L6-IP-207-067
Public 接口不会泄露内部采购或风险字段。

### L6-IP-207-068
关键准入动作都会写入 Audit。

### L6-IP-207-069
Manual Override 必须绑定 actor、reason、policyVersion 与 evidenceRef。

## 33. Machine Invariants

```text
I1: VERIFIED_BUYER ⇒ valid verification evidence exists
I2: Transaction Intent ⇒ immutable intent version reference
I3: PARTIAL_FIT ⇒ no direct authorization
I4: BLOCKED_RISK ⇒ restricted transaction blocked
I5: INELIGIBLE_BUYER ⇒ new restricted transaction blocked
I6: Quote ⇒ pricingVersion + scopeSnapshot + intentVersion
I7: Procurement approval ≠ Rights modification
I8: Recommendation ≠ Authorization
I9: Estimated Total Cost ≠ Ledger Settlement
I10: Suspended Buyer ⇒ high-risk transaction creation blocked
I11: Manual Override ⇒ actor + reason + evidence
I12: Public output ⇒ excludes restricted procurement/risk data
```

## 34. Cross-Contract Dependencies

```text
206 Buyer Admission Contract
 ↓
207 Buyer Admission Instance Registry
 ↓
203 SKU / Pricing / Deal Desk
 ↓
205 Licensor / Rights Verification
 ↓
200 Transaction / E-Sign / Authorization
 ↓
Rights / Risk / Commerce / Agreement / License
 ↓
176 Evidence Registry
```

## 35. Closure Gates

```text
[ ] All 29 L5 units registered
[ ] All 69 L6 atomic claims registered
[ ] Every L5 has L6 coverage
[ ] Intent versioning defined
[ ] Rights Fit defined
[ ] Eligibility defined
[ ] Risk decision defined
[ ] Procurement approval defined
[ ] Quote snapshot defined
[ ] License Vault mapping defined
[ ] Privacy boundary defined
[ ] Audit defined
[ ] Machine invariants defined
```

## 36. Implementation Boundary

本注册表仅完成 L4 → L5 → L6 实例化，不授权实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
