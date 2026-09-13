# LuckRead Earnings / Wallet Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：68 Wallet / Ledger / Settlement + 65 Commerce + 66 Advertising + 67 Creator IP Marketplace**

## 1. 定位

Earnings / Wallet Center 是用户、Creator、MCN、Merchant 等主体查看收益、可用余额、待结算、结算、提现、退款/冲正、冻结与财务记录的统一体验中心。

Ledger 是不可变金融事实权威；Wallet 是余额投影视图；Settlement 是结算闭环。本中心不直接修改余额，也不创建第二金融权威。

## 2. Benchmark / Superiority

借鉴 YouTube Earn、创作者订阅/收益工作台及国内创作者商业化工具的成熟模式，目标是让“这笔钱从哪里来、为什么能拿、何时到账、哪里受限、下一步做什么”始终清晰可追溯。

## 3. Information Architecture

```text
Earnings / Wallet Center
├── Overview
├── Earnings Sources
├── Pending Earnings
├── Available Balance
├── Holds / Reserves
├── Statements / Transactions
├── Settlements
├── Payouts
├── Refunds / Reversals / Adjustments
├── Taxes / Compliance Entry
├── Disputes / Financial Review
├── Security / Permissions
└── Audit / Export
```

## 4. Core Journeys

### 4.1 Earnings explanation
`Source Event → Validated Revenue → Pending → Available → Settlement → Payout`

### 4.2 Payout
`Eligible Balance → Request → Risk/Policy Check → Processing → Provider Result → Final State`

### 4.3 Dispute / adjustment
`Issue → Evidence → Review → Decision → New Financial Entry → Updated Projection`

## 5. Experience Requirements

- 首页必须清楚区分 available、pending、held、settled、paid；
- 每笔收益都应能追溯到来源类型和可展示的解释；
- 结算周期、预计时间和失败原因必须人类可理解；
- 提现失败必须给出可操作恢复路径；
- 资金冻结必须显示政策允许展示的状态、影响范围和申诉/复核入口；
- 大量流水使用 cursor pagination、筛选、导出和时间范围；
- 金额、币种和汇率展示必须明确，不允许隐式换算。

## 6. Authority Boundary

```text
Revenue Evidence / Attribution → corresponding business domains
Financial Validation / Ledger Fact → 68
Wallet Projection → 68
Settlement → 68
Payment Execution → external provider boundary
Creator / Merchant / User Identity → respective domains
Risk / Moderation / Rights → respective domains
```

## 7. API / Event Surface

体验层调用稳定金融 API，不直接写 Wallet balance 或 Ledger Entry。典型读取：earnings summary、wallet projection、settlement、payout status、transaction provenance。

金融 mutation 必须遵循幂等、版本保护、最小权限、风险检查和审计。

## 8. Reliability / Security

必须处理重复提现、provider callback 重复、结算重算、退款/冲正竞争、余额投影失效、对账异常与网络中断。

敏感金融数据最小化展示；禁止前端决定可提现余额；缓存不得凌驾于金融权威状态。

## 9. Acceptance / Superiority Gate

验证：收益可解释性、余额状态清晰度、提现操作效率、失败恢复率、来源追溯能力、权限隔离、金融审计完整性及跨设备连续性，并通过 139 Superiority Gate。

**STOP：** UI 修改余额、删除 Ledger、原始广告/互动事件直接变余额、重复 payout、隐式汇率、敏感金融越权、无法追溯资金来源、低于行业基线。
