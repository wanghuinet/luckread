# LuckRead Advertiser Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：66 Advertising Platform**

## 1. 定位
Advertiser Center 是广告主/品牌/代理商进行投放、创意、预算、监测、归因、账单和团队协作的统一工作台。广告业务事实由 Advertising Platform 持有，金融事实由 Commerce/Ledger 持有。

## 2. 体验目标
必须高于主流广告平台与内容平台广告投放体验：创建快、反馈即时、预算透明、投放状态可解释、异常可恢复、数据可追溯。

## 3. Information Architecture

```text
Advertiser Center
├── Overview
├── Advertiser / Organization
├── Campaigns
├── Ad Groups / Delivery Plans
├── Creatives
├── Placements
├── Audiences / Targeting
├── Budget / Pacing
├── Delivery Monitor
├── Analytics / Attribution
├── Billing Entry
├── Team / Roles
├── Policy / Review
├── Risk Alerts
└── Settings / Audit
```

## 4. Core Journeys
`Create Campaign → Creative → Targeting → Budget → Review → Activate → Monitor → Optimize → Report`

异常必须支持：`Detect → Explain → Fix → Retry/Resume`。

## 5. Experience Requirements
- 投放状态、预算、审核状态必须在单一工作上下文内可见；
- 预算异常必须给出可操作原因，而非仅错误码；
- 创意审核失败必须提供安全可用的修正方向；
- 报告与投放控制必须分离，报告生成不得阻塞投放；
- 批量投放必须可预览、撤销和追踪；
- 敏感定向规则不得泄露内部风险模型。

## 6. Authority
`Advertising → 66`; `Commerce → transaction`; `Ledger → money`; `Risk → trust`; `Moderation → policy decision`; `Creator/Content → source objects`。

## 7. Performance / Reliability
高频 measurement 走异步聚合；关键控制必须幂等；delivery、budget、policy 服务异常时提供安全降级；报表不可阻塞实时投放。

## 8. Acceptance / Superiority Gate
验证 campaign 创建效率、预算可见性、投放控制延迟、失败恢复、报表可解释性、权限隔离和多设备连续性；必须通过 139 Superiority Gate。

**STOP:** 第二广告权威、原始事件直接结算、敏感定向越权、失败不可恢复、内部风险信息泄漏、体验低于行业基线。
