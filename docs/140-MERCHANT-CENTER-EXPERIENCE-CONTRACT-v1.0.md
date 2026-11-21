# LuckRead Merchant Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：116 Merchant / Seller Platform + 124 Commerce Fulfillment**

## 1. 定位
Merchant Center 是商家经营工作台，负责把商家身份、店铺、商品运营、订单、履约、售后、成员协作、经营分析和风险状态组织成统一体验。

Merchant Center 是体验/操作层，不创建第二 Merchant、Commerce、Creator、Ledger、Rights 或 Risk 权威。

## 2. 体验目标

最低目标不是“有商家后台”，而是全面高于主流内容电商与自媒体平台的商家经营体验：更少跳转、更强可见性、更明确状态、更快完成关键任务、更安全、更可恢复。

## 3. Information Architecture

```text
Merchant Center
├── Overview
├── Store
├── Products / SKU
├── Orders
├── Fulfillment
├── Returns / After-sales
├── Customers (scoped)
├── Promotions
├── Content / Creator Collaboration
├── Analytics
├── Finance Entry
├── Team / Roles
├── Risk / Compliance
├── Notifications / Tasks
└── Settings / Audit
```

## 4. Core Journeys

### 4.1 Store onboarding
`Merchant registration → qualification → store setup → verification → ready`

### 4.2 Product
`Create → validate → media → price → availability → publish → monitor`

### 4.3 Order
`Order received → confirm → fulfill → delivered → after-sales`

### 4.4 Exception
`Failure → explain cause → recover/retry → preserve context → final result`

## 5. Experience Requirements

- 首页必须显示待处理任务、订单异常、履约异常、审核状态和经营关键指标；
- 所有长流程必须可恢复，不要求从头开始；
- 批量操作必须提供预览、影响范围、失败明细和可重试项；
- 商家成员只能看到其授权范围；
- 敏感数据默认最小展示；
- 移动端与桌面端保持任务连续性。

## 6. Authority Boundary

```text
Merchant / Store → 116
Product / Offer / Order / Entitlement → 65
Fulfillment / Inventory / After-sales → 124
Money → 68
Creator → 76
Rights → 64
Risk → 62
Analytics → 69
```

## 7. API / Event Surface

体验层通过稳定领域 API 与事件组合，不直接读取 D1 表或 Payload internals。典型读取：merchant summary、store status、product summary、order summary、fulfillment exceptions、analytics summary。

## 8. Reliability

必须支持超时、重复提交、批量部分失败、网络中断、权限变化、订单状态竞争、履约回调重复、恢复任务。

## 9. Acceptance / Superiority Gate

必须验证：关键任务完成步数、状态可理解性、批量效率、异常恢复成功率、权限隔离、跨设备连续性，并通过 139 Global Product & Experience Superiority Contract。

**STOP:** 第二业务权威、越权、隐藏失败、不可恢复操作、内部 schema 泄漏、低于行业基线。
