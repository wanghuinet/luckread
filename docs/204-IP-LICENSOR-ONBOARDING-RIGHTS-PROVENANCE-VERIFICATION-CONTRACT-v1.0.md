# LuckRead IP Licensor Onboarding / Rights Provenance / Verification Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 `ip.luckread.com` 的供给侧准入体系：任何 IP、权利人、代理人、MCN、机构或其他授权方在成为可交易 Licensor 前，必须完成身份、权利来源、授权链、可授权范围、冲突状态和证据完整性的验证。

核心链路：

```text
申请入驻
→ 主体验证
→ IP 身份建立
→ Rights Provenance
→ Chain of Title
→ 授权资格验证
→ 可交易范围计算
→ 冲突检测
→ 风险/合规检查
→ Licensor 状态发布
→ License SKU 上架
```

本合同不创造新的 Rights Authority；Rights 仍是最终权利事实权威。

## 2. 北极星原则

平台必须回答：

```text
谁在卖
为什么有资格卖
卖的是哪一项权利
这项权利从哪里来
授权到哪里
授权到什么时候
是否已有冲突
是否允许继续出售
买方签约后凭什么证明
```

任何无法形成可追溯证据链的高价值授权，不得自动进入标准交易路径。

## 3. Licensor 主体模型

支持：

```text
INDIVIDUAL_RIGHTS_HOLDER
CORPORATE_RIGHTS_HOLDER
AUTHORIZED_AGENT
MCN_ORGANIZATION
PUBLISHER
STUDIO
PLATFORM
DISTRIBUTOR
LICENSE_OPERATOR
CO_LICENSOR
```

每个 Licensor 至少具有：

```text
licensorId
subjectId
organizationId
role
verificationStatus
rightsAuthorityRef
riskStatus
scopeStatus
createdAt
updatedAt
```

Licensor Profile 只是交易身份与展示层，不得替代主体、权利或账务权威。

## 4. 主体验证

根据主体类型执行适当验证：

```text
Identity Verification
Organization Verification
Role Verification
Authority Evidence
Contact Verification
Compliance Status
```

验证结果至少区分：

```text
PENDING
BASIC_VERIFIED
FULLY_VERIFIED
RESTRICTED
SUSPENDED
REJECTED
```

不能将“已注册用户”直接等同于“有权授权的 Licensor”。

## 5. IP Identity Onboarding

每个 IP 必须建立稳定身份：

```text
ipId
canonicalName
aliases
ipType
originRef
creatorRefs
ownerRefs
rightsProfileRefs
territories
languages
status
```

同名 IP 不得因为营销页面不同而产生多个事实 IP 主体。

## 6. Rights Provenance

必须记录权利来源链：

```text
Origin
→ Creator
→ Original Owner
→ Assignment / Transfer
→ Organization Control
→ License
→ Sublicense
→ Current Authority
```

每一步必须能引用证据。

推荐 Evidence 类型：

```text
CREATION_RECORD
OWNERSHIP_RECORD
ASSIGNMENT
TRANSFER
AGENCY_APPOINTMENT
LICENSE_AGREEMENT
SUBLICENSE_AGREEMENT
COURT_OR_ADMINISTRATIVE_RECORD
PLATFORM_VERIFICATION
```

## 7. Chain of Title

对于需要证明权属连续性的 IP，必须维护可审计 Chain of Title。

最小模型：

```text
fromParty
→ toParty
→ rightScope
→ effectiveFrom
→ effectiveTo
→ territory
→ sourceDocument
→ documentHash
→ verificationStatus
```

Chain 不得被后续编辑覆盖历史版本，只允许新增、更正或撤销记录。

## 8. Authorization Basis

Licensor 必须明确其授权资格属于：

```text
OWNERSHIP
EXCLUSIVE_RIGHTS
NON_EXCLUSIVE_RIGHTS
AGENCY_AUTHORITY
DISTRIBUTION_AUTHORITY
SUBLICENSING_AUTHORITY
CONTRACTUAL_AUTHORITY
```

任何授权资格必须映射到 Rights Authority 的正式权利记录。

## 9. Scope of Authority

平台需要计算 Licensor 当前可交易范围：

```text
rights
× usage
× media
× channels
× territory
× language
× term
× exclusivity
× derivative
× sublicense
```

最终结果：

```text
SELLABLE_SCOPE
RESTRICTED_SCOPE
BLOCKED_SCOPE
```

不能由运营人员通过文本备注绕过机器 scope。

## 10. Rights-to-Sell Check

SKU 上架之前必须执行：

```text
Licensor Verification
+
Rights Authority Check
+
Scope Intersection
+
Conflict Check
+
Risk / Compliance Check
→
Sellable = TRUE / FALSE
```

任何一项关键检查失败，标准 SKU 必须阻止发布。

## 11. Exclusive Rights Conflict

独家权利必须检查已有交易：

```text
Same IP
× Same Right
× Same Territory
× Overlapping Term
× Same Channel / Usage
```

结果：

```text
NO_CONFLICT
POTENTIAL_CONFLICT
CONFIRMED_CONFLICT
MANUAL_REVIEW_REQUIRED
```

CONFIRMED_CONFLICT 不得自动销售。

## 12. License Capacity / Sellable Inventory

对于具有限额的授权资源，必须支持：

```text
capacity
reserved
committed
available
consumed
released
```

例如：一个地区只允许 10 个商业合作 SKU，则系统必须能计算剩余额度。

这不是实物库存，而是可交易授权容量。

## 13. Multi-Licensor / Co-Licensing

一个授权范围可以存在多个合法参与方，但必须明确：

```text
PRIMARY_LICENSOR
CO_LICENSOR
APPROVAL_PARTY
AGENT
DISTRIBUTOR
```

平台不能因为存在多个主体而自动推定任意一方可以独立签约。

## 14. Approval Rights

某些权利需要第三方审批：

```text
Brand Approval
Content Approval
Character Approval
Packaging Approval
Campaign Approval
Territory Approval
```

SKU 必须声明是否包含审批要求。

## 15. Evidence Requirements

高价值 IP 入驻至少形成：

```text
Subject Evidence
IP Identity Evidence
Ownership / Authority Evidence
Scope Evidence
Conflict Evidence
Verification Evidence
```

每条证据至少具有：

```text
evidenceId
type
sourceRef
documentHash
issuedAt
effectiveFrom
effectiveTo
verificationMethod
status
```

## 16. Evidence Confidence

平台不将所有证据视为同等可信。

建议：

```text
SELF_DECLARED
THIRD_PARTY_SUBMITTED
PLATFORM_CHECKED
CONTRACT_VERIFIED
LEGAL_VERIFIED
AUTHORITATIVE_RECORD
```

高价值交易可以要求最低 Evidence Confidence。

## 17. Verification State Machine

IP / Licensor 验证状态：

```text
DRAFT
→ SUBMITTED
→ UNDER_REVIEW
→ VERIFIED
→ PUBLISHED
```

异常：

```text
REJECTED
SUSPENDED
DISPUTED
EXPIRED
REVOKED
```

状态变化必须保留历史。

## 18. Dispute State

任何权属争议必须立即影响交易资格：

```text
NO_DISPUTE
DISPUTE_OPEN
DISPUTE_UNDER_REVIEW
DISPUTE_CONFIRMED
DISPUTE_RESOLVED
```

高风险争议可以将相关 SKU 自动切换为 `SUSPENDED`。

## 19. Revocation

授权资格可以被撤销：

```text
Agency Revoked
License Revoked
Assignment Invalidated
Ownership Changed
Court / Administrative Decision
Contract Expired
```

撤销必须传播到：

```text
Licensor
→ Sellable Scope
→ SKU Availability
→ Open Quotes
→ Orders
→ Licenses
→ Authorization Certificates
```

具体交易后果由 Rights / Commerce / Agreement / License 合同决定。

## 20. Expiration

所有授权资格都必须支持有效期：

```text
validFrom
validTo
```

即使 Licensor 主体仍有效，过期的 Rights Authority 也不得继续产生新的授权交易。

## 21. Change Detection

平台必须检测：

```text
Ownership Changed
Scope Changed
Territory Changed
Term Changed
Exclusivity Changed
Agency Changed
Dispute Opened
Risk Elevated
```

发生变化后重新计算 Sellable Scope。

## 22. SKU Revalidation

下列情况触发 SKU 重新验证：

```text
Rights Change
Licensor Status Change
Conflict Detected
Price Scope Change
Contract Template Change
Industry Policy Change
Compliance Policy Change
```

未重新验证的 SKU 不得继续进入高风险交易路径。

## 23. Buyer Trust Signals

IP 页面可以展示有限的信任信号：

```text
Verified Licensor
Rights Reviewed
Enterprise Verified
Authorization Available
License Verification Available
```

不得公开泄露敏感合同或个人信息。

## 24. Marketplace Ranking Boundary

验证状态可以作为市场质量信号，但推荐系统不得修改权利结论。

允许：

```text
Verified > Unverified
Low Risk > High Risk
Complete Profile > Incomplete Profile
```

禁止：

```text
High Recommendation Score ⇒ Authorized
```

## 25. Standard Onboarding

标准 IP 入驻：

```text
Create IP
→ Verify Licensor
→ Submit Rights
→ Verify Scope
→ Conflict Check
→ Publish IP
→ Create SKU
```

## 26. Enterprise Onboarding

企业 IP / 大型版权方支持：

```text
Organization Onboarding
→ Portfolio Import
→ Rights Mapping
→ Historical Rights Import
→ Territory Matrix
→ Existing License Import
→ Conflict Baseline
→ Governance Review
→ Catalog Publish
```

批量导入必须保留原始来源与导入批次。

## 27. Portfolio-Level Governance

大型 Licensor 可以统一管理：

```text
IP Portfolio
Rights Portfolio
License Catalog
Active Contracts
Territory Availability
Exclusive Inventory
Disputes
Renewals
```

但 Portfolio 仍只是管理聚合层。

## 28. Public Verification Boundary

第三方验证只能公开最少必要信息：

```text
authorizationNumber
status
ipIdentity
licensorName
licenseeName / masked reference
scopeSummary
territory
term
issuedAt
```

不得通过公开验证接口泄露合同全文、内部风险信息或敏感证据。

## 29. Verification API

建议接口：

```text
POST /v1/ip/licensors/onboard
POST /v1/ip/licensors/{id}/verify
GET  /v1/ip/licensors/{id}/authority
POST /v1/ip/rights/provenance
GET  /v1/ip/rights/{id}/chain-of-title
POST /v1/ip/licenses/scope-check
POST /v1/ip/licenses/conflict-check
POST /v1/ip/catalog/{sku}/revalidate
GET  /v1/ip/verification/{authorizationNumber}
```

## 30. Event Contract

至少产生：

```text
ip.created
licensor.submitted
licensor.verified
rights.provenance.added
rights.authority.changed
rights.scope.changed
rights.conflict.detected
licensor.suspended
licensor.reinstated
rights.revoked
sku.revalidation.required
sku.suspended
```

事件只表达事实或状态变化，不直接执行跨域财务结算。

## 31. Security / Permission

最小权限角色：

```text
LICENSOR_ADMIN
RIGHTS_OPERATOR
LEGAL_REVIEWER
COMPLIANCE_REVIEWER
DEAL_MANAGER
PLATFORM_OPERATOR
AUDITOR
```

任何角色只能看到其业务所需证据范围。

## 32. Audit

必须记录：

```text
who
what
when
before
→
after
reason
evidenceRef
```

尤其是：验证通过、权利范围修改、冲突解除、争议处理、撤销、恢复交易资格。

## 33. Machine Invariants

以下条件必须机器可验证：

```text
I1: VERIFIED_LICENSOR ⇒ subject verification exists
I2: SELLABLE_SCOPE ⇒ rights authority exists
I3: SKU.PUBLISHED ⇒ rights scope is valid
I4: EXCLUSIVE SKU ⇒ no confirmed overlapping conflict
I5: REVOKED AUTHORITY ⇒ new issuance blocked
I6: DISPUTED HIGH_RISK_RIGHT ⇒ standard sale blocked
I7: Chain of Title history is append-only
I8: Price scope ⊆ authorized scope
I9: License scope ⊆ purchased SKU scope
I10: Public verification never reveals restricted evidence
```

## 34. Cross-Contract Dependencies

```text
204
 ↓
Rights / 64
 ↓
IP Trading / 201
 ↓
SKU / Pricing / Deal Desk / 203
 ↓
Transaction / E-Sign / Authorization / 200
 ↓
Commerce / Wallet / Agreement
 ↓
Evidence Registry / 176
```

204 是供给侧准入与权利可信层，不重新定义下游交易事实。

## 35. Acceptance Gates

文档级准入要求：

```text
[ ] Licensor identity complete
[ ] IP identity complete
[ ] Rights provenance traceable
[ ] Chain of Title model complete
[ ] Scope machine-checkable
[ ] Exclusive conflict check defined
[ ] Capacity defined where applicable
[ ] Dispute / revocation propagation defined
[ ] SKU revalidation defined
[ ] Public verification boundary defined
[ ] Audit defined
[ ] Machine invariants defined
```

代码实现前必须进一步生成对应 L5/L6 Instance Registry。

## 36. Implementation Boundary

本合同只定义产品与架构约束，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
