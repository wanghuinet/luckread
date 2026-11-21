# LuckRead IP License Marketplace / Transaction / E-Signature Addendum v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本 Addendum 将 IP Center、Rights / Licensing 与 Marketplace 的 IP 授权能力正式扩展为可交易的标准化 IP License Marketplace。

目标体验参考成熟 IP 授权交易平台，包括但不限于：

```text
发现 IP
→ 查看授权商品
→ 查看明确价格 / 价格区间
→ 在线下单或发起议价
→ 权利与资格校验
→ 在线签署协议
→ 支付 / 履约
→ License 生效
→ 自动签发电子授权书
→ 下载 / 验证
```

LuckRead 不复制任何第三方平台的实现或专有业务规则，仅吸收成熟 IP 授权市场的产品模式。

## 2. 核心原则

### 2.1 IP Center 是交易体验入口

`ip.luckread.com` MUST 提供：

- IP 授权商品发现
- 授权条件查看
- 价格展示
- 在线议价
- 询价
- 下单
- 合同签署
- 订单跟踪
- 授权书下载
- 授权真伪验证

IP Center 不成为 Rights、Commerce、Wallet、Ledger 的第二业务权威。

### 2.2 Rights 是权利权威

授权资格、权利范围、地域、期限、独家性、衍生权、商业使用边界等最终事实 MUST 由 Rights / Licensing Authority 决定。

Marketplace 不得自行创造、扩大或解释授权权利。

### 2.3 交易与权利分离

```text
Marketplace
    = Offer / Quote / Order / Negotiation / Transaction Workflow

Rights
    = Ownership / Control / License Scope / Entitlement

Commerce
    = Order / Payment / Refund / Fulfillment Reference

Ledger
    = Financial Accounting / Settlement Authority
```

## 3. IP 授权商品模型

IP 权利持有人或授权代表 MAY 创建标准化 IP License Product。

最小字段：

```text
id
ipId
rightsProfileId
offerType
name
description
licenseType
usageType
territory
channels
mediaTypes
derivativePolicy
exclusivity
termStart
termEnd
priceModel
currency
priceMinor
priceFromMinor
priceToMinor
negotiable
minPriceMinor
quoteRequired
availability
eligibilityRules
contractTemplateId
version
status
createdAt
updatedAt
```

## 4. 明码标价

授权商品 MUST 支持公开明确价格。

至少支持：

```text
FIXED_PRICE
STARTING_PRICE
PRICE_RANGE
NEGOTIABLE
QUOTE_REQUIRED
OFFLINE_NEGOTIATION
```

### 4.1 固定价格

```text
授权费：¥100,000
期限：12个月
地区：中国大陆
用途：商业广告
渠道：短视频
```

符合购买资格且没有额外审批要求时，可以直接进入订单流程。

### 4.2 起售价

```text
起售价：¥50,000 起
```

用户不得将起售价误认为最终成交价；订单必须记录最终价格版本。

### 4.3 价格区间

```text
¥50,000 – ¥200,000
```

最终报价 MUST 形成不可变版本并绑定订单 / 合同。

### 4.4 可议价

```text
标价：¥100,000
可议价：是
```

支持买方发起报价、卖方反报价、多轮报价和报价有效期。

## 5. 线下商议

IP 授权 MUST 支持线上线下混合交易。

用户 MAY 选择：

```text
立即购买
询价
申请议价
预约商务洽谈
线下商议后回平台签约
```

线下沟通结果不能只保存在聊天记录中，最终成交条件 MUST 回填为结构化 Quote / Order / Agreement 数据。

### 5.1 线下商议状态

```text
OFFLINE_NEGOTIATION_REQUESTED
→ NEGOTIATING_OFFLINE
→ TERMS_SUBMITTED
→ TERMS_CONFIRMED
→ ONLINE_SIGNATURE_PENDING
```

平台 MUST 保留：

- 商议参与方
- 商议发起时间
- 商议引用
- 最终商业条件
- 价格版本
- 权利版本
- 合同版本
- 确认人
- 审计证据

## 6. 授权商品详情页

`ip.luckread.com` 的 IP License Product 页面 MUST 至少展示：

```text
IP 名称
授权商品名称
权利人 / 授权方
授权类型
可使用范围
地区
期限
渠道
媒介
独家 / 非独家
是否允许衍生
价格
是否支持议价
是否支持线下洽谈
申请条件
合同摘要
```

必须显式区分：

```text
商品价格
与
最终成交价格
```

以及：

```text
公开授权条件
与
实际合同条件
```

## 7. 授权交易生命周期

标准交易：

```text
DRAFT
→ PUBLISHED
→ AVAILABLE
→ CHECKING
→ ORDER_CREATED
→ RIGHTS_CHECKED
→ CONTRACT_PREPARED
→ SIGNATURE_PENDING
→ SIGNED
→ PAYMENT_PENDING / PAID
→ LICENSE_ISSUED
→ FULFILLMENT_ACTIVE
→ EXPIRED / COMPLETED
```

异常状态：

```text
REJECTED
CANCELLED
REFUNDED
DISPUTED
SUSPENDED
RIGHTS_REVOKED
```

具体状态必须与 Commerce / Rights / Agreement 状态保持可追踪映射。

## 8. 下单

固定价且资格满足的授权商品 MUST 支持直接下单。

下单必须生成：

```text
orderId
buyerId
sellerId
ipId
offerId
offerVersion
priceSnapshot
rightsSnapshot
territorySnapshot
termSnapshot
contractTemplateSnapshot
correlationId
idempotencyKey
```

所有关键条件必须快照化，防止商品后续修改影响既有订单。

## 9. 权利资格校验

下单后、签约前、授权签发前均可按策略再次执行 Rights Check。

至少检查：

- buyer eligibility
- seller authority
- IP ownership / control
- license availability
- territory
- term
- exclusivity conflict
- usage restrictions
- derivative restrictions
- policy restrictions
- existing conflicting licenses
- revocation / suspension status

任何 P0 权利失败 MUST 阻止授权书签发。

## 10. 在线合同生成

平台 MUST 支持从结构化授权条件生成合同草案。

合同 MUST 引用：

```text
IP
Rights / Entitlement
Offer
Order
Buyer
Licensor
License Scope
Territory
Term
Price
Payment Terms
Termination
Revocation
Dispute Terms
Governing Terms
Version
```

合同模板必须版本化。

生成后的 Agreement Snapshot 不得随着模板后续更新而改变。

## 11. 在线签署

平台 MUST 支持在线电子签署能力，并通过可替换的 E-Sign Provider Adapter 对接第三方电子签约服务或合规签名能力。

平台不得把某一家电子签名供应商的 API 模型写死到业务域。

签署状态至少支持：

```text
DRAFT
→ SENT
→ VIEWED
→ SIGNING
→ PARTIALLY_SIGNED
→ FULLY_SIGNED
→ VOIDED
→ EXPIRED
```

签署证据 MUST 具备：

- agreementId
- agreementVersion
- signer reference
- signing timestamp
- provider reference
- signature status
- document hash
- evidence reference
- audit reference

需要时必须能够保存完整签署证据包，而不是只保存一个“已签署”布尔值。

## 12. 授权协议生效

授权不得仅因为用户点击购买而生效。

必须满足平台配置的全部生效条件，例如：

```text
Rights Check = PASS
AND
Agreement = FULLY_SIGNED
AND
Payment Condition = SATISFIED
AND
No Blocking Risk / Moderation State
```

具体条件由 Rights / Commerce / Policy Authority 决定。

## 13. 电子授权书

当授权协议满足签发条件后，平台 MUST 自动生成电子授权书。

授权书至少包含：

```text
authorizationId
licenseId
agreementId
IP identity
licensor
licensee
licensed rights
territory
term
usage scope
exclusivity
issuance time
effective time
expiry time
authorization number
verification reference
document version
document hash
```

## 14. 授权书下载

用户必须能够在 `ip.luckread.com` 下载授权书。

至少支持：

```text
PDF
```

必要时可支持：

```text
structured JSON proof
print-friendly version
```

授权书下载文件 MUST 与已签署 Agreement / License 绑定，不得重新生成出不同内容而无法追溯。

## 15. 授权书真伪验证

每份授权书 SHOULD 带有：

```text
Authorization Number
Verification URL
QR Code
Document Hash
```

第三方可通过公开验证入口验证：

```text
有效 / 已撤销 / 已过期 / 无效
授权范围摘要
地区
期限
授权主体
```

公开验证接口不得泄露合同中未授权公开的商业敏感信息。

推荐入口：

```text
ip.luckread.com/verify/{authorizationNumber}
```

## 16. 授权书撤销

Rights Revocation MUST 触发授权状态传播。

```text
RIGHTS_REVOKED
→ License SUSPENDED / REVOKED
→ Authorization Status Updated
→ Verification Endpoint Updated
→ Relevant Consumers Notified
```

缓存不得导致已经撤销的授权继续显示为有效。

## 17. 退款与取消

取消 / 退款由 Commerce Authority 管理，Rights Authority 管理对应授权状态影响。

不得出现：

```text
订单已退款
但授权仍被永久显示为有效
```

或者：

```text
授权已撤销
但订单状态仍假定拥有有效权利
```

两者必须通过结构化状态和事件建立可追踪关联。

## 18. 交易证据链

每一次 IP 授权交易 MUST 可以形成完整证据链：

```text
IP
→ Rights
→ Offer
→ Price Version
→ Quote / Negotiation
→ Order
→ Rights Check
→ Agreement
→ E-Sign Evidence
→ Payment / Commerce Reference
→ License
→ Authorization Certificate
→ Download / Verification
→ Revocation / Expiry
```

## 19. API

代表性 API：

```text
GET    /v1/ip-license-offers
GET    /v1/ip-license-offers/{id}
POST   /v1/ip-license-offers/{id}/inquiries
POST   /v1/ip-license-offers/{id}/quotes
POST   /v1/ip-license-offers/{id}/orders
GET    /v1/ip-license-orders/{id}
POST   /v1/ip-license-orders/{id}/rights-check
POST   /v1/ip-license-orders/{id}/prepare-agreement
POST   /v1/ip-license-orders/{id}/sign
GET    /v1/ip-license-orders/{id}/agreement
GET    /v1/licenses/{id}
GET    /v1/authorizations/{id}
GET    /v1/authorizations/{id}/download
GET    /v1/authorizations/{id}/verify
POST   /v1/ip-license-orders/{id}/cancel
POST   /v1/ip-license-orders/{id}/dispute
```

所有 mutation MUST 支持 authorization、idempotency、version checks、audit、stable errors。

## 20. Event

代表性事件：

```text
ip.license.offer.published
ip.license.inquiry.created
ip.license.quote.created
ip.license.quote.accepted
ip.license.order.created
ip.license.rights.checked
ip.license.agreement.prepared
ip.license.signature.started
ip.license.agreement.signed
ip.license.payment.satisfied
ip.license.issued
ip.authorization.issued
ip.authorization.downloaded
ip.authorization.verified
ip.license.revoked
ip.license.expired
ip.license.disputed
```

事件必须包含稳定 eventId、entityId、eventVersion、timestamp、correlationId，并可安全重复消费。

## 21. 安全与防伪

授权交易必须防止：

- 重复下单
- 重复签署
- 重复签发授权书
- 伪造授权编号
- 修改已签署文档内容
- 下载未生效授权书
- 越权查看合同
- 越权获取私人价格
- 使用已撤销 / 过期授权
- 通过缓存绕过 Rights Revocation

文档 hash 与授权编号必须可验证。

## 22. 隐私

以下数据默认属于受控数据：

- 合同全文
- 私下报价
- 议价记录
- 商业联系方式
- 内部权利证据
- 签署证据包
- 支付明细

公开 IP 页面只能展示授权方允许公开的信息。

## 23. 财务边界

Marketplace / IP Center 可以展示价格、报价、订单金额和交易状态引用，但：

```text
Commerce = Order / Payment / Refund Authority
Ledger = Final Financial Authority
```

Marketplace 不得直接修改最终余额或生成独立财务账本。

金额必须使用明确 currency + minor-unit 表示，禁止浮点金额。

## 24. 线下成交后回平台

平台 MUST 支持以下模式：

```text
线下谈判完成
→ 双方确认最终条款
→ 平台生成结构化 Quote
→ 双方确认
→ 在线合同生成
→ 在线签署
→ 支付 / 条件满足
→ 自动签发授权书
```

因此，线下成交不会失去平台证据链，也不会绕过 Rights / Commerce / Audit。

## 25. Center UI

`ip.luckread.com` MUST 提供独立的“授权市场”入口：

```text
IP 中心
├── IP 总览
├── IP 图谱
├── 我的 IP
├── 授权市场
│   ├── 热门 IP
│   ├── 图文授权
│   ├── 视频授权
│   ├── 游戏授权
│   ├── 商品授权
│   ├── 品牌联名
│   ├── 漫画 / 小说改编
│   ├── 影视 / 节目
│   └── 商业授权
├── 我的询价
├── 我的议价
├── 我的订单
├── 我的合同
├── 我的授权书
└── 授权验证
```

## 26. 非目标

本 Addendum 不定义：

- IP ownership authority
- Copyright authority
- Final payment-provider authority
- Final ledger authority
- Electronic-signature provider internals
- Legal advice or jurisdiction-specific legal interpretation

具体电子签约能力 MUST 通过 provider adapter 实现，并按部署地区配置合规能力。

## 27. Acceptance

P0 必须至少验证：

- 固定价格授权
- 起售价授权
- 区间报价
- 可议价授权
- 线下商议后回平台交易
- 订单快照
- 权利校验
- 合同版本化
- 在线签署
- 签署证据
- 支付条件校验
- License 签发
- 授权书 PDF 生成
- 授权书下载
- 授权书公开验证
- 撤销传播
- 过期处理
- 退款关联
- 重复交易防护
- 越权访问防护
- 审计证据链

## 28. STOP Conditions

实现 MUST STOP IF：

- IP Center 自行成为 IP ownership authority
- Marketplace 未经 Rights Check 即签发 License
- 价格变化可以影响既有订单而没有 snapshot
- 已签合同内容可以被后台无痕修改
- 授权书可以在 License 未生效时下载为“有效”
- 授权书无唯一编号或无法验证
- 已撤销授权仍可通过缓存显示有效
- 线下议价结果没有结构化最终条款
- 订单、合同、License、授权书无法关联
- Marketplace 直接修改 Ledger
- 浮点金额进入权威交易记录
- 重复请求可以产生重复订单或重复授权

## 29. Admission Status

**PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

本 Addendum 正式将“明码标价 + 在线询价/议价 + 线下商议 + 在线签约 + License 签发 + 电子授权书下载与验证”纳入 LuckRead IP Center 的产品边界，同时保持 IP、Rights、Commerce、Ledger 的唯一权威边界。
