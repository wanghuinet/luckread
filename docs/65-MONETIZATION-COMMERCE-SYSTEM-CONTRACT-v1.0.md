# LuckRead Monetization / Commerce System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Monetization / Commerce 负责付费内容、订阅、会员、商品、订单、权益和商业化流程。它不拥有 Wallet/Ledger 的最终资金账本，也不自行定义版权。

## 2. 核心链路

```text
Offer / Product
→ Pricing / Eligibility
→ Order
→ Payment Adapter
→ Entitlement
→ Fulfillment
→ Refund / Cancel
→ Ledger / Settlement
```

## 3. 能力

- paid content
- subscriptions/membership
- creator monetization
- digital goods
- physical/commerce boundary
- coupons/promotions
- orders
- payment adapter
- entitlement
- refund/cancel
- creator revenue attribution
- commerce analytics

## 4. Authority

Product/Offer/Order/Entitlement 属于 Commerce；Payment provider 负责外部支付事实；Wallet/Ledger 负责内部资金权威；Rights 负责使用权；Creator Revenue/Settlement 负责归因与结算。

## 5. Commerce OSS Integration Boundary

LuckRead 不重复实现通用 Commerce engine 能力。对于需要商品、购物车、订单、库存、促销、履约等成熟电商能力的场景，可通过 Adapter 评估 **Medusa**。Medusa 官方提供模块化 Commerce 能力，包括 Product、Order、Customer、Cart、Inventory、Payment、Pricing、Promotion 等，因此适合作为可选 Commerce implementation，而不是 LuckRead 的全平台事实权威。

推荐边界：

```text
LuckRead Commerce Contract
→ Commerce Adapter
→ Medusa (optional)
→ Payment / Fulfillment Providers
→ Commerce Events
→ LuckRead Commerce / Ledger / Analytics boundaries
```

规则：

- Medusa 不成为 User、Creator、IP、Rights、Wallet、Ledger 的权威；
- LuckRead API DTO 不直接暴露 Medusa internal schema；
- 订单、权益和商业状态必须遵守本合同的状态机与幂等要求；
- 金融事实仍进入 Wallet/Ledger Contract；
- 版权/内容使用权仍由 Rights Domain 管理；
- Medusa 不得直接修改 Ledger balance；
- Commerce Adapter 可替换，避免业务域锁定；
- v1 如果只需要数字内容/会员，可优先使用 Payload + D1 + R2 + Queue，不强制引入 Medusa。

因此：**Medusa 是后置可插拔能力，不是 Cloudflare v1 必选依赖。**

## 6. API

`/v1/products`、`/v1/offers`、`/v1/orders`、`/v1/entitlements`、`/v1/subscriptions`、`/v1/refunds`。

订单创建、确认、退款、回调必须 idempotent；所有金额必须使用明确 currency/minor unit，不允许浮点金额。

## 7. Payment Boundary

平台不得把支付 provider 的 callback 直接当作内部最终账本；必须经过签名验证、幂等、状态机和 reconciliation。

## 8. Entitlement

权益必须独立建模并支持 grant、active、expired、revoked、refunded 等状态。内容播放/阅读/下载/会员功能必须通过 entitlement check。

## 9. Risk / Rights

高价值订单必须经过 Risk；付费内容必须经过 Rights；退款、拒付、撤销必须能反向影响 entitlement。

## 10. Reliability

支持重复支付通知、超时、pending、provider outage、退款延迟、reconciliation、死信恢复。任何一次重试不得产生重复订单、重复权益或重复结算。

## 11. Cost / Performance

商品与价格可缓存；支付和订单状态变更走权威事务路径；统计、通知、creator fanout 异步；禁止每次页面展示创建订单或写账。

## 12. Acceptance

P0 验证商品、定价、订单、支付 callback、幂等、权益、订阅、退款、拒付、风险、版权、creator revenue attribution、reconciliation、故障恢复；若启用 Medusa，还必须验证 Adapter schema isolation、状态机一致性和故障切换。

## 13. STOP

- Commerce 自建最终资金账本
- 浮点金额
- callback 无签名/幂等验证
- 重试产生重复订单
- entitlement 与退款状态脱节
- 付费内容绕过 Rights
- 高价值交易绕过 Risk
- 无 reconciliation
- Medusa 成为 User/Creator/IP/Rights/Wallet/Ledger 权威
- Medusa internal schema 直接暴露给 APP API

## 14. READY

Data/API/Event/State Machine/Payment/Risk/Rights/Permission/Security/Test/Recovery/Performance/Observability/CI/User Acceptance 完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
