# LuckRead IP Buyer Onboarding / Buyer Intent / Risk Precheck / Procurement Admission Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 `ip.luckread.com` 的买方交易准入层，将“我要找什么 IP、用于什么业务、预算多少、谁批准、是否具备使用资格”转换为可验证、可比较、可采购的结构化交易意图。

核心链路：

```text
Buyer Onboarding
→ Buyer Profile
→ Business Intent
→ Usage Scenario
→ Eligibility Precheck
→ Rights Fit
→ Risk / Compliance Precheck
→ Budget / Procurement Gate
→ Shortlist / Quote
→ Deal / Order
```

本合同不创造新的 Rights、Risk、Commerce、Ledger 或 Agreement 权威。

## 2. 北极星原则

交易前必须能够回答：

```text
谁在采购
代表谁采购
要买什么权利
为什么需要
在哪里使用
如何使用
使用多久
预算多少
需要哪些内部审批
是否存在行业/地区限制
是否具备签约资格
```

系统必须区分：

```text
Buyer Identity
Buyer Intent
Buyer Eligibility
Transaction Eligibility
```

不能因为用户提交了需求，就认为其已经具备采购或使用资格。

## 3. Buyer Subject Model

支持：

```text
INDIVIDUAL
CREATOR
BRAND
MERCHANT
AGENCY
MCN
ENTERPRISE
PUBLISHER
STUDIO
DISTRIBUTOR
PLATFORM
NON_PROFIT
GOVERNMENT_OR_PUBLIC_ENTITY
```

最小字段：

```text
buyerId
subjectId
organizationId?
role
verificationStatus
riskStatus
procurementStatus
createdAt
updatedAt
```

Buyer Profile 只是交易身份层，不取代用户、组织、财务或风险权威。

## 4. Buyer Verification

根据主体类型执行适当验证：

```text
Identity
Organization
Role / Employment
Business Purpose
Contact
Payment Capability Reference
Compliance
```

状态：

```text
PENDING
BASIC_VERIFIED
BUSINESS_VERIFIED
RESTRICTED
SUSPENDED
REJECTED
```

## 5. Buyer Intent

买方可以使用自然语言表达需求：

```text
我要一个动漫IP，用于食品包装，中国大陆，12个月，非独家，预算30万元以内。
```

系统必须转换为结构化 Intent：

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

自然语言只作为输入，不直接成为交易事实。

## 6. Intent Versioning

每次修改需求必须产生新版本：

```text
intentId
intentVersion
createdAt
changedBy
changeReason
previousVersionRef
```

已用于报价或 Deal 的旧 Intent 不得被原地覆盖。

## 7. Usage Scenario

必须支持标准业务场景：

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

场景必须映射到 License Family / Industry Template，而不是靠营销标签匹配。

## 8. Rights Fit Precheck

买方意图进入交易前执行：

```text
Intent
×
SKU Scope
×
Rights Availability
→
RIGHTS_FIT
```

结果：

```text
EXACT_FIT
PARTIAL_FIT
NO_FIT
MANUAL_REVIEW
```

`PARTIAL_FIT` 不得直接转化为可签约权利。

## 9. Buyer Eligibility

必须检查：

```text
Buyer Verification
Industry Eligibility
Territory Eligibility
Usage Eligibility
Channel Eligibility
Age / Account Restrictions
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

## 10. Risk Precheck

风险预审至少能够检查：

```text
Buyer Risk
Industry Risk
Usage Risk
Territory Risk
Sanctions / Restricted Geography Policy
Content Safety
Fraud Signals
Transaction Risk
```

风险系统只提供 Risk Decision，不改变 Rights Ownership。

## 11. Risk Decision

标准化结果：

```text
PASS
PASS_WITH_CONDITIONS
REVIEW
BLOCK
```

高风险交易必须进入人工审批或 Deal Desk。

## 12. Compliance Profile

企业买方可以维护：

```text
legalEntity
industry
operatingCountries
restrictedIndustries
complianceContacts
policyReferences
```

平台不得假定所有企业具有相同合规规则。

## 13. Budget Model

Buyer Intent 支持：

```text
budgetMin
budgetMax
currency
budgetPeriod
budgetBasis
approvalLimit
```

金额必须采用最小货币单位：

```text
minorUnitAmount
```

禁止浮点金额作为交易依据。

## 14. Procurement Workflow

企业采购支持：

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

内部审批是外部交易准入的前置条件，而非平台财务账本。

## 15. Approval Policy

按交易风险/金额/范围可以触发：

```text
BUSINESS_APPROVAL
FINANCE_APPROVAL
LEGAL_APPROVAL
SECURITY_APPROVAL
COMPLIANCE_APPROVAL
EXECUTIVE_APPROVAL
```

每个审批都必须明确：

```text
approver
policyVersion
scope
decision
decidedAt
reason
```

## 16. Procurement References

支持企业采购信息：

```text
purchaseRequestNumber
purchaseOrderReference
costCenter
projectCode
businessOwner
legalOwner
financeOwner
```

这些字段只作为企业流程引用，不让平台绑死某一 ERP。

## 17. Buyer Shortlist

买方可以建立：

```text
Saved IPs
Saved SKUs
Comparable Offers
Pending Quotes
Active Deals
```

Shortlist 必须保存当时的 SKU / Price / Scope Snapshot。

## 18. Quote Request

买方可以对标准 SKU 发起：

```text
REQUEST_QUOTE
```

Quote 至少包含：

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

Quote 不能改变 Rights Scope。

## 19. Quote Status

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

Quote 历史必须 append-only。

## 20. Partial Fit Resolution

当 Buyer Intent 与 SKU 不完全匹配时，系统可以提出：

```text
Alternative SKU
Reduced Scope
Expanded Scope Quote
Different Territory
Different Term
Different Channel
Deal Desk
```

推荐不能假装“完全符合”。

## 21. Buyer Search / Match

匹配排序允许考虑：

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

但必须保持：

```text
Recommendation ≠ Authorization
```

最终交易仍由 Rights / Eligibility / Risk / Commerce / Agreement 决定。

## 22. Total Cost View

买方查看授权商品时，应能看到：

```text
License Fee
Optional Service Fee
Minimum Guarantee
Royalty Reference
Taxes / Additional Charges Reference
Total Estimated Cost
```

平台不得将“预计总成本”伪装为最终财务结算金额。

## 23. Enterprise Purchase Workspace

企业买方可拥有统一工作区：

```text
My Intents
My Shortlist
My Quotes
My Deals
My Agreements
My Licenses
My Authorization Certificates
Renewals
Disputes
```

形成完整采购资产链。

## 24. Buyer License Vault Integration

签约完成后：

```text
Deal
→ Agreement
→ License
→ Authorization
→ Buyer License Vault
```

Vault 中必须能够看到：

```text
What I Can Use
Where I Can Use
Until When
Under Which Agreement
Proof
Restrictions
Renewal
Revocation State
```

## 25. Buyer Risk Changes

买方风险状态变化后，应重新评估未完成交易：

```text
Buyer Risk Changed
→ Open Quote Review
→ Open Deal Review
→ Order Eligibility Review
```

已生效 License 的后续影响按照 Rights / Agreement / Risk / Commerce 合同处理。

## 26. Buyer Suspension

买方状态：

```text
ACTIVE
RESTRICTED
SUSPENDED
BLOCKED
```

SUSPENDED / BLOCKED Buyer 不得创建新的高风险授权交易。

## 27. Fraud / Abuse Boundary

异常行为可以触发：

```text
Velocity Check
Repeated Quote Abuse
Fake Organization
Payment Risk
Identity Inconsistency
Multiple Account Abuse
```

平台必须使用 Risk / Trust 系统的正式决策，而不是散落在 IP Trading 页面代码中。

## 28. Dispute / Appeal

买方可以对：

```text
Eligibility Decision
Risk Decision
Quote Decision
Deal Decision
License Restriction
```

发起申诉或人工复核。

申诉不会自动改变原决策，只有正式审核结果才能改变状态。

## 29. Procurement Deadline

Intent 可以定义：

```text
deadline
priority
businessImpact
```

用于 Deal Desk 排序和服务等级，不得用于绕过 Rights 或 Risk 检查。

## 30. API Surface

建议接口：

```text
POST /v1/ip/buyers/onboard
GET  /v1/ip/buyers/{id}
POST /v1/ip/buyer-intents
GET  /v1/ip/buyer-intents/{id}
POST /v1/ip/buyer-intents/{id}/precheck
POST /v1/ip/eligibility/check
POST /v1/ip/risk/precheck
POST /v1/ip/quotes
GET  /v1/ip/quotes/{id}
POST /v1/ip/procurement/requests
POST /v1/ip/procurement/approvals
GET  /v1/ip/buyer-workspace
```

## 31. Event Contract

至少支持：

```text
buyer.created
buyer.verified
buyer.restricted
buyer.suspended
buyer.intent.created
buyer.intent.updated
buyer.intent.prechecked
buyer.eligibility.checked
buyer.risk.reviewed
buyer.quote.requested
buyer.quote.issued
buyer.quote.accepted
procurement.requested
procurement.approved
procurement.rejected
```

事件表达事实变化，不直接承担财务结算。

## 32. Data Boundary

Buyer Center / IP Trading 仅保存其职责范围内的数据引用与交易上下文。

不得复制为新的权威：

```text
Identity Authority
Rights Authority
Risk Authority
Commerce Authority
Ledger Authority
Agreement Authority
License Authority
```

## 33. Security / Privacy

买方采购数据可能包含商业敏感信息：

```text
budget
businessPlan
procurementRef
internalApproval
counterparty
negotiationTerms
```

必须默认最小暴露，并区分：

```text
Public
Buyer Private
Organization Private
Deal Private
Internal Review
Auditor Only
```

## 34. Audit

必须记录：

```text
intent changes
eligibility decisions
risk decisions
approval decisions
quote versions
procurement actions
manual overrides
```

任何人工覆盖必须有：

```text
actor
reason
evidenceRef
policyVersion
timestamp
```

## 35. Machine Invariants

```text
I1: VERIFIED_BUYER ⇒ subject verification exists
I2: Intent used for transaction is versioned
I3: Natural-language intent ≠ transaction authority
I4: PARTIAL_FIT ≠ authorized fit
I5: BLOCK risk ⇒ standard high-risk transaction blocked
I6: INELIGIBLE buyer ⇒ new restricted transaction blocked
I7: Quote contains immutable pricing/scope snapshot
I8: Procurement approval cannot modify Rights
I9: Recommendation cannot grant authorization
I10: Buyer restriction propagates to open high-risk transaction review
I11: Budget uses integer minor units
I12: Manual override requires actor + reason + evidence
```

## 36. Cross-Contract Dependencies

```text
206 Buyer Admission
 ↓
205 Licensor / Rights Verification
 ↓
201 IP Trading Center
 ↓
203 SKU / Pricing / Deal Desk
 ↓
200 Transaction / E-Sign / Authorization
 ↓
Rights / Risk / Commerce / Agreement / License
 ↓
176 Evidence Registry
```

## 37. Acceptance Gates

```text
[ ] Buyer identity model complete
[ ] Intent normalization complete
[ ] Usage scenarios mapped
[ ] Rights-fit precheck defined
[ ] Eligibility defined
[ ] Risk precheck defined
[ ] Procurement workflow defined
[ ] Approval policy defined
[ ] Quote versioning defined
[ ] License Vault integration defined
[ ] Security / privacy boundary defined
[ ] Audit defined
[ ] Machine invariants defined
```

## 38. Implementation Boundary

本合同定义产品与架构约束，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
