# LuckRead World-Class IP License SKU / Industry Template / Pricing Matrix / Enterprise Deal Desk Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 LuckRead IP Trading Center 的规模化商品化层，使 IP 权利能够从“复杂、非标准、人工沟通”转化为“可发现、可比较、可报价、可交易、可签约、可履约”的标准化 License SKU。

核心目标：

```text
复杂 IP 权利
→ 标准化 License Package
→ License SKU
→ Industry Template
→ Pricing Matrix
→ Buyer Intent Match
→ Standard / Enterprise Deal
→ Agreement
→ License
→ Authorization
```

本合同不改变 IP、Rights、Commerce、Ledger、Agreement 的权威边界。

## 2. 北极星原则

世界级 IP 交易市场必须让买方能够在交易前理解：

```text
买的是什么
为什么能买
谁可以授权
在哪里使用
可以使用什么媒介
可以使用多久
是否独家
是否允许改编
是否允许转授权
价格怎么算
最终需要签什么
签完获得什么证明
```

任何无法被结构化解释的高价值授权，应进入 Enterprise Deal Desk，而不是用模糊商品描述强行标准化。

## 3. License SKU 模型

IP Trading Center MUST 将可交易授权包装为独立 SKU，而不是直接出售“IP 本身”。

最小结构：

```text
licenseSkuId
ipId
rightsProfileId
licensePackageId
skuCode
name
displayName
category
industry
grantScope
territory
language
mediaTypes
channels
term
exclusivity
derivativePolicy
sublicensePolicy
approvalPolicy
eligibilityPolicy
priceModel
pricingMatrixId
contractTemplateId
version
status
```

SKU 是交易商品标识，不是权利权威；最终权利仍由 Rights Authority 决定。

## 4. SKU 标准层级

```text
IP
 └── Rights Profile
      └── License Family
           └── License Package
                └── License SKU
                     └── Price Variant
```

示例：

```text
IP：某动漫IP

License Family：商品授权

License Package：服装类

SKU：
CN / Apparel / Non-exclusive / 12M
CN / Apparel / Exclusive / 12M
Global / Apparel / Non-exclusive / 24M
```

## 5. 标准 License Family

首期至少支持：

```text
CONTENT_USE
ADVERTISING_USE
SOCIAL_MEDIA_USE
PRODUCT_LICENSING
PACKAGING_LICENSING
APPAREL_LICENSING
TOY_LICENSING
PUBLISHING
BOOK
COMIC
ANIMATION
VIDEO
FILM_TV
GAME_ADAPTATION
DIGITAL_GOODS
LIVE_EVENT
EXHIBITION
MERCHANDISE
DISTRIBUTION
TRANSLATION
REMAKE_ADAPTATION
BRAND_COLLABORATION
```

平台允许新增 License Family，但必须经过合同、权利、价格和验证治理。

## 6. 行业授权模板

授权市场 MUST 支持行业模板，使不同产业可以使用不同的授权参数，而不是所有 SKU 共用一套字段。

首期模板至少覆盖：

| 行业 | 核心维度 |
|---|---|
| 食品饮料 | 包装、SKU数量、渠道、地区、期限、广告使用 |
| 服装 | 类目、款式、数量、销售地区、独家性 |
| 玩具 | 产品类型、年龄段、数量、渠道、地区 |
| 文化出版 | 图书/漫画、语言、发行地区、印数 |
| 游戏 | 平台、地区、角色/世界观、改编范围、期限 |
| 影视 | 作品类型、改编权、地区、窗口、独家性 |
| 动画 | 改编范围、地区、窗口、发行权 |
| 广告 | 媒介、投放地区、投放周期、素材用途 |
| 电商 | 平台、商品、页面、推广、地区 |
| 线下活动 | 场地、活动类型、城市、日期、品牌露出 |
| 数字内容 | 数字载体、平台、地区、期限、分发范围 |

## 7. Industry Template Contract

每个模板 MUST 定义：

```text
templateId
industry
version
requiredFields
optionalFields
forbiddenCombinations
rightsDependencies
pricingInputs
contractClauses
complianceRules
approvalRules
validationRules
status
```

行业模板不能自行发明权利语义；必须映射到 Rights 的标准维度。

## 8. Rights-to-SKU Compiler

平台应具备确定性的授权商品编译过程：

```text
Rights Profile
+
Industry Template
+
Business Constraints
+
Territory
+
Term
+
Channel
+
Media
+
Exclusivity
        ↓
License Package
        ↓
License SKU
```

编译结果必须可审计、可版本化、可重复计算。

禁止通过自由文本直接生成不可解释 SKU。

## 9. Pricing Matrix

定价必须支持多维价格矩阵：

```text
Price
= Base Rate
× Scope Factor
× Territory Factor
× Term Factor
× Exclusivity Factor
× Channel Factor
× Media Factor
× Commercial Scale Factor
× Industry Factor
+ Optional Services
```

实际使用的计算模型必须版本化。

Pricing Matrix 是商业定价模型，不是财务账本。

## 10. Pricing Model

支持至少：

```text
FIXED
STARTING_FROM
RANGE
TIERED
UNIT_BASED
VOLUME_BASED
TIME_BASED
ROYALTY
REVENUE_SHARE
HYBRID
NEGOTIABLE
QUOTE_REQUIRED
OFFLINE_NEGOTIATION
```

所有货币使用：

```text
currency
minorUnitAmount
```

禁止浮点金额。

## 11. 价格透明度

每个 SKU 必须明确：

```text
FULL_PRICE
STARTING_PRICE
PRICE_RANGE
ESTIMATED_PRICE
NEGOTIABLE
QUOTE_REQUIRED
OFFLINE_ONLY
```

同时展示影响最终价格的主要变量。

例如：

```text
基础授权费：¥100,000
地区：中国大陆
期限：12个月
媒介：短视频
独家：否
商品数量：≤10 SKU
```

用户可以理解为什么扩大权利会导致价格变化。

## 12. Price Versioning

价格必须具有：

```text
pricingVersion
priceEffectiveFrom
priceEffectiveTo
pricingPolicyVersion
scopeSnapshot
```

订单一旦采用某一价格版本，历史交易不得因为市场价格修改而发生变化。

## 13. Buyer Intent

平台支持买方以业务目标表达需求：

```text
我要一个动漫IP
用于食品包装
中国大陆
12个月
非独家
预算30万元以内
```

系统转换为：

```text
ipType
industry
usage
territory
term
exclusivity
budget
channel
media
```

然后匹配 License SKU。

## 14. Eligibility Matching

匹配必须同时考虑：

```text
Rights Eligibility
Buyer Eligibility
Risk Eligibility
Moderation State
Geography
Industry Policy
Commercial Availability
Existing Conflict
```

Recommendation 只能推荐，不能授予权利。

## 15. SKU Comparison

用户必须能比较授权 SKU：

| 项目 | SKU A | SKU B |
|---|---|---|
| 地区 | 中国大陆 | 全球 |
| 期限 | 12个月 | 36个月 |
| 独家 | 否 | 是 |
| 渠道 | 短视频 | 全渠道 |
| 衍生 | 否 | 是 |
| 转授权 | 否 | 按条件 |
| 价格 | ¥100,000 | ¥600,000 |

比较必须基于结构化权利字段，不能基于营销文案猜测。

## 16. Standard Deal

标准交易适用于：

```text
固定 SKU
资格明确
价格明确
无需特殊审批
合同模板标准
```

完整路径：

```text
SKU
→ Rights Check
→ Order
→ Agreement
→ E-Sign
→ Payment
→ License
→ Authorization
```

## 17. Enterprise Deal

企业级交易适用于：

```text
多地区
多渠道
长期
高金额
独家
多方权利
复杂改编
品牌联名
联合营销
复杂履约
```

必须进入 Deal Desk。

## 18. Deal Desk

Deal Desk 是复杂交易的专业工作区，至少支持：

```text
Deal Intake
Scope Design
Rights Review
Pricing Proposal
Counter Proposal
Legal Review
Business Approval
Risk Review
Offline Meeting
Term Sheet
Agreement Preparation
Signing
Fulfillment
Renewal
```

Deal Desk 不是新的权利或财务权威。

## 19. 多角色协作

Enterprise Deal 支持：

```text
Buyer
Brand
Agency
IP Owner
Rights Team
Legal
Finance
Business Manager
Platform Operator
```

每个参与者必须有最小权限。

## 20. Term Sheet

复杂交易必须支持结构化 Term Sheet：

```text
IP
Parties
Scope
Industry
Territory
Term
Channels
Media
Exclusivity
Derivative
Sublicense
Minimum Guarantee
Royalty
Revenue Share
Approval Rights
Deliverables
Payment Terms
Termination
Renewal
Dispute
```

Term Sheet 一旦确认必须版本化，并成为合同生成输入。

## 21. Minimum Guarantee / Royalty

复杂 IP 交易可以支持：

```text
Minimum Guarantee
Advance
Royalty Rate
Revenue Share
Threshold
Settlement Period
Audit Right Reference
```

但最终财务确认由 Commerce / Ledger Authority 管理。

## 22. Offline Deal Closure

线下商务结果必须回填：

```text
Meeting
→ Negotiation Record
→ Final Terms
→ Quote Version
→ Approval
→ Agreement
```

外部 CRM、邮件、电话或纸面沟通可以作为过程证据，但不能成为平台最终交易事实的唯一来源。

## 23. Legal / Compliance Gate

Enterprise Deal 在签约前必须能够触发：

```text
Rights Review
Compliance Review
Risk Review
Legal Review
Finance Review
```

审批结果必须可审计。

## 24. Contract Clause Assembly

合同系统必须能够根据结构化条款选择适当模板和 Clause：

```text
Industry
+
Rights
+
Territory
+
Term
+
Exclusivity
+
Derivative
+
Pricing
+
Compliance
        ↓
Contract Template Version
        ↓
Agreement Snapshot
```

禁止把业务条款直接拼成无法追踪来源的自由文本。

## 25. Offer Packaging

Licensor 可以创建：

```text
Single SKU
SKU Bundle
Industry Package
Regional Package
Seasonal Package
Campaign Package
Enterprise Package
```

Bundle 不得意外扩大任何底层 License 的权利范围。

## 26. Inventory / Availability

授权商品需要支持：

```text
AVAILABLE
LIMITED
RESERVED
SOLD_OUT
TEMPORARILY_UNAVAILABLE
SUSPENDED
```

Availability 必须与现有冲突授权、地域、期限、独家范围保持一致。

## 27. Exclusive Conflict Detection

当用户申请独家授权时，系统必须检查：

```text
Same IP
× Same Rights
× Same Territory
× Overlapping Term
× Same Channel
```

发现冲突必须阻止自动签约或进入人工处理。

## 28. Renewal / Expansion

SKU 支持后续：

```text
RENEW
EXTEND TERM
EXPAND TERRITORY
ADD CHANNEL
ADD MEDIA
ADD INDUSTRY
ADD PRODUCT CATEGORY
UPGRADE EXCLUSIVITY
ADD DERIVATIVE RIGHTS
```

每项扩展必须产生明确的新权利版本。

## 29. Buyer Procurement Workflow

企业买方可以：

```text
Search
→ Shortlist
→ Compare
→ Internal Approval
→ Request Quote
→ Negotiate
→ Purchase
→ Sign
→ Payment
→ License Vault
```

需要支持采购编号、成本中心、审批引用等企业字段，但不将企业内部财务体系写死。

## 30. License Certificate Issuance

签约和生效条件满足后：

```text
License
→ Authorization Certificate
→ PDF
→ QR Verification
```

证书必须绑定：

```text
licenseId
agreementId
authorizationNumber
documentHash
scope
territory
term
licensor
licensee
```

## 31. License Vault

买方必须拥有统一 License Vault：

```text
Active
Expiring Soon
Expired
Revoked
Suspended
Amended
Renewal Available
Expansion Available
```

License Vault 只保存/聚合权利资产引用，不重新创造 License。

## 32. Post-Trade Fulfillment

交易中心不能只做到“收钱签字”，还必须支持履约状态：

```text
LICENSE_ACTIVE
→ ASSETS_DELIVERED
→ APPROVAL_IN_PROGRESS
→ USAGE_ACTIVE
→ REPORTING
→ COMPLETED
```

不同产业可以定义行业特有履约节点。

## 33. Reporting / Audit

每个 Deal 必须形成：

```text
Offer
→ Quote
→ Terms
→ Approval
→ Agreement
→ Signature Evidence
→ Payment Reference
→ License
→ Authorization
→ Fulfillment
```

高价值交易必须支持导出审计摘要。

## 34. Marketplace Quality

商品必须具备质量分级：

```text
DRAFT
REVIEWED
VERIFIED
PREMIUM
ENTERPRISE_READY
SUSPENDED
```

质量等级必须有明确证据，不得仅由运营手工标记而无依据。

## 35. Security

必须防止：

```text
价格篡改
SKU范围扩大
重复订单
越权报价
越权查看商业条款
伪造 Deal
伪造授权书
重复授权
使用冲突独家授权
```

所有关键 mutation 必须具备 idempotency、version check、authorization、audit。

## 36. Events

```text
ip.sku.created
ip.sku.published
ip.sku.price.updated
ip.sku.suspended
ip.deal.created
ip.deal.quoted
ip.deal.approved
ip.deal.signed
ip.deal.completed
ip.license.renewal.offered
ip.license.expansion.offered
ip.authorization.issued
```

事件必须支持重复消费。

## 37. Observability

关键指标至少包括：

```text
SKU publication rate
SKU conversion rate
Quote response time
Negotiation duration
Deal win rate
Agreement completion rate
License issuance latency
Authorization issuance success
Renewal rate
Expansion rate
Conflict detection rate
```

不得以业务日志代替可靠审计。

## 38. Acceptance

P0 必须验证：

- SKU 与 Rights Profile 正确绑定
- 价格版本不可篡改
- 行业模板不可绕过权利校验
- Buyer Intent 正确映射授权条件
- SKU 比较不扩大权利
- 独家冲突可检测
- Enterprise Deal 有审批链
- Offline Deal 可回平台闭环
- Term Sheet 可追踪
- Agreement Snapshot 不可漂移
- License Vault 不产生第二权威
- Authorization Certificate 唯一且可验证
- Renewal / Expansion 形成新版本
- 商业金额不会进入非财务权威系统

## 39. STOP Conditions

Implementation MUST STOP if：

- SKU 直接代表 IP 所有权
- 行业模板自行创造权利语义
- Pricing Matrix 直接修改 Ledger
- SKU 可绕过 Rights Check
- 独家 SKU 不检查冲突
- 线下交易无法回平台确认
- Deal Desk 修改历史已签条款
- Contract 不能追溯其结构化来源
- License Vault 成为第二 License Authority
- 授权书可以脱离 License / Agreement 独立生成

## 40. Source Contracts

```text
64   Copyright / Rights / Licensing
65   Monetization / Commerce
67   Creator / IP Marketplace
67A  IP License Marketplace / Transaction / E-Signature
68   Wallet / Ledger / Settlement
71   Platform Operations / Reliability
139  Global Product / Experience Superiority
154  Center Layer Master Matrix
156  Center Layer Unified Admission Gate
157  Center Layer Unified Preflight
176  Evidence Registry
179  L5 Execution Specification
180  L6 Verification Atomic Unit
182  L4-L5-L6 Full Coverage Registry
183  Instance Generation Protocol
200  IP License Transaction / E-Signature Instance Registry
201  World-Class IP Trading Center Master Contract
202  IP Trading Core Instance Registry
```

## 41. Admission Status

```text
PRODUCT-ARCHITECTURE-COMPLETE
CONTRACT-READY
IMPLEMENTATION-PENDING
```

本合同将 LuckRead IP Trading Center 从“授权功能集合”提升为可规模化运营的标准化 IP 权利商品市场，并为标准交易、复杂交易、企业交易、行业模板和价格矩阵提供统一产品语言。