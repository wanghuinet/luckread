# LuckRead Order Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：65 Commerce + 124 Commerce Order / Fulfillment Operations**

## 1. 定位

Order Center 是用户、商家及授权运营角色的订单体验与任务工作台，统一呈现订单、订单明细、支付结果、数字权益、物流履约、售后、退款、争议与异常恢复。

Order Center 只负责体验与操作编排，不创建第二 Order、Payment、Fulfillment、Ledger 或 Entitlement 权威。

## 2. Benchmark / Superiority

借鉴国内内容电商与国际内容平台的订单/购买体验，目标不是菜单完整，而是做到：状态最清晰、关键动作最短、异常最可恢复、跨内容类型最一致、跨设备最连续。

## 3. Information Architecture

```text
Order Center
├── Overview
├── All Orders
├── Unpaid / Pending
├── Processing / Fulfilling
├── Completed
├── Digital Purchases / Entitlements
├── Shipping / Tracking
├── Returns / After-sales
├── Refunds
├── Disputes
├── Favorites / Reorder where supported
├── Notifications / Tasks
└── Privacy / Settings
```

## 4. Core Journeys

### 4.1 Order discovery
`Content / Product → Purchase Context → Order → Status → Detail`

### 4.2 Physical fulfillment
`Order → Confirmed → Fulfilling → Shipped → Delivered`

### 4.3 Digital entitlement
`Order → Paid → Entitlement Granted → Access`

### 4.4 After-sales
`Order → Return/Refund Request → Review → Resolution → Financial Result`

### 4.5 Exception recovery
`Failure → Explain cause → Next action → Retry/Resume/Appeal → Final state`

## 5. Experience Requirements

- 每个订单必须有单一、可理解的当前状态；
- 状态必须同时表达“发生了什么、下一步是什么”；
- 订单详情必须按订单/商品/履约上下文组织，而不是要求用户跨页面拼接；
- 退款、取消、售后必须明确影响范围；
- 数字内容购买后必须清晰显示获得的权益及进入内容的路径；
- 批量运营场景必须支持筛选、批量处理、结果摘要和失败重试；
- 网络中断后不得丢失用户已完成步骤；
- 移动端与桌面端保持同一订单上下文。

## 6. Authority Boundary

```text
Order / Payment / Entitlement → 65
Order Execution / Fulfillment / Return → 124
Financial Fact → 68
Rights → 64
Risk → 62
User Identity → User Domain
Merchant Identity → 116
```

## 7. API / Event Surface

中心仅调用稳定领域 API，不直接读取 D1 表或 Payload internals。典型读取：order summary、line status、payment status、entitlement status、fulfillment status、after-sales summary。

所有状态变更必须使用领域命令、幂等键、requestId、correlationId 和稳定错误模型。

## 8. Reliability / Privacy

必须处理重复支付回调、重复取消、退款竞争、履约延迟、物流回调重复、数字权益授予延迟、权限变化和部分下游失败。

地址、联系方式、支付相关信息和售后证据必须最小化展示与审计访问。

## 9. Acceptance / Superiority Gate

验证：关键订单任务完成步数、状态理解正确率、售后完成效率、异常恢复率、数字权益获取成功率、权限隔离、跨设备连续性，并通过 139 Superiority Gate。

**STOP：** 第二订单权威、缓存直接改变订单状态、重复副作用、资金事实绕过 Ledger、无恢复路径、敏感订单信息泄漏、低于行业基线。
