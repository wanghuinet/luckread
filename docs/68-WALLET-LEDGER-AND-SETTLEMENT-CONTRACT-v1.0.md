# LuckRead Wallet / Ledger / Settlement Contract v1.0

**Status: PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：资金事实、钱包账户、结算、对账与资金生命周期的权威边界；不授权直接实现业务代码。**

## 1. Purpose

Wallet / Ledger / Settlement 是 LuckRead 商业化体系中的金融事实层。

核心原则：

```text
Business Event
→ Revenue / Charge Evidence
→ Ledger Fact
→ Balance Projection
→ Settlement
→ Payout / Refund / Adjustment
→ Reconciliation
```

任何 UI、Campaign、Marketplace、Creator Center、MCN、Analytics 或 Dashboard 都不得直接成为最终资金事实来源。

## 2. Authority Boundary

```text
Wallet
= Account / Available-Balance Experience

Ledger
= Immutable Financial Fact Authority

Settlement
= Periodic Reconciliation and Payable/Receivable Closure

Payment Provider
= External Payment Execution Authority
```

禁止：

- UI 直接修改余额；
- Marketplace 直接修改 Ledger；
- Advertising 直接生成最终余额；
- Analytics 直接生成资金事实；
- Cache 作为余额权威；
- 浮点数保存金额；
- 删除已入账 Ledger Entry。

## 3. Financial Objects

核心实体：

```text
Wallet Account
Ledger Entry
Transaction Group
Hold / Reserve
Adjustment
Refund
Chargeback
Settlement
Settlement Line
Payout
Reconciliation Record
Financial Evidence
```

## 4. Wallet Account

Wallet 表示用户、Creator、Organization、MCN 或平台主体的资金账户视图。

核心字段：

```text
id
ownerType
ownerId
currency
status
availableMinor
pendingMinor
heldMinor
version
createdAt
updatedAt
```

金额必须使用整数 minor units，例如 cents。

状态：

```text
ACTIVE
→ FROZEN
→ SUSPENDED
→ CLOSED
```

Wallet Balance 是 Ledger 的派生投影，不得脱离 Ledger 独立修改。

## 5. Ledger Entry

Ledger Entry 是不可变金融事实。

核心字段：

```text
id
transactionId
accountId
entryType
amountMinor
currency
direction
sourceType
sourceId
referenceType
referenceId
idempotencyKey
occurredAt
postedAt
schemaVersion
createdAt
```

Entry 创建后禁止原地修改金额、账户、方向或来源。

纠错必须通过新的 Adjustment / Reversal Entry 实现。

## 6. Double-Entry Principle

金融转移必须满足平衡：

```text
Σ Debit = Σ Credit
```

例如 Creator 收益：

```text
Platform Revenue / Payable Account
        ↓
Creator Payable Account
```

最终资金变化必须可以从完整 Ledger Entry 集合重新计算。

## 7. Transaction Group

一个业务资金动作可以产生多个 Ledger Entry。

```text
Transaction
├── Ledger Entry A
├── Ledger Entry B
└── Ledger Entry C
```

核心字段：

```text
id
transactionType
status
idempotencyKey
sourceEventId
currency
createdAt
postedAt
```

Transaction 只有在全部必要 Entry 成功形成并满足平衡规则后才能进入 `POSTED`。

## 8. Financial State Machine

推荐：

```text
CREATED
→ VALIDATING
→ POSTING
→ POSTED
```

失败：

```text
REJECTED
FAILED
```

已 POSTED 的 Transaction 不允许回退成 CREATED。

## 9. Revenue Recognition Boundary

Revenue Attribution 与 Ledger 必须分离：

```text
Delivery / Attribution Evidence
→ Financial Validation
→ Revenue Transaction
→ Ledger
```

广告曝光、点击、订单、Creator 收益等原始事件不能直接变成可提现余额。

必须经过：

```text
Risk / Trust
→ Event Quality
→ Attribution
→ Financial Validation
→ Posting
```

## 10. Hold / Reserve

支持暂缓可用余额：

```text
AVAILABLE
→ HOLD
→ RELEASE
```

或：

```text
AVAILABLE
→ HOLD
→ CAPTURE
```

典型场景：

- 退款窗口；
- 风险审查；
- 争议期；
- 广告结算；
- Creator 收益审核。

Hold 不得伪造为最终收入。

## 11. Refund / Reversal / Adjustment

原始 Ledger Entry 不删除。

```text
Original Entry
→ Reversal / Refund Entry
→ New Financial State
```

Adjustment 必须包含：

```text
reasonCode
sourceReference
actorReference
auditReference
```

高风险人工 Adjustment 必须双人或策略授权（视金额/风险等级）。

## 12. Chargeback

外部支付争议进入独立状态链：

```text
RECEIVED
→ REVIEWING
→ ACCEPTED / CONTESTED
→ RESOLVED
```

Chargeback 结果必须通过新的 Ledger Transaction 反映，不直接修改历史余额。

## 13. Settlement

Settlement 是结算周期，而不是 Wallet。

核心字段：

```text
id
subjectType
subjectId
periodStart
periodEnd
currency
status
grossMinor
adjustmentMinor
feeMinor
netMinor
statementReference
version
createdAt
updatedAt
```

状态：

```text
OPEN
→ CALCULATING
→ PENDING_RECONCILIATION
→ RECONCILED
→ APPROVED
→ PAYOUT_PENDING
→ PAID
→ CLOSED
```

异常：

```text
DISPUTED
CANCELLED
FAILED
```

## 14. Settlement Line

Settlement 必须可展开到来源。

```text
Settlement
→ Settlement Line
→ Ledger Transaction
→ Source Evidence
```

Settlement Line 至少包含：

```text
id
settlementId
sourceType
sourceId
amountMinor
currency
attributionReference
ledgerReference
version
```

这样可以回答：

```text
这笔钱从哪里来？
为什么属于这个主体？
依据什么规则计算？
最终进入哪条 Ledger？
```

## 15. Payout

Payout 是向外部支付渠道执行资金转移的过程。

核心字段：

```text
id
settlementId
walletId
providerReference
amountMinor
currency
status
requestedAt
completedAt
failureCode
```

状态：

```text
REQUESTED
→ PROCESSING
→ SUCCEEDED
```

失败：

```text
FAILED
RETRYABLE
CANCELLED
```

Payout 成功不能重复记账。

## 16. Reconciliation

对账必须同时覆盖：

```text
Business Source
↔ Ledger
↔ Settlement
↔ Payout Provider
```

对账结果：

```text
MATCHED
MISMATCHED
MISSING
DUPLICATED
PENDING
```

Mismatch 必须进入可审计异常队列，不允许静默修正。

## 17. Idempotency

以下操作必须幂等：

- Revenue posting
- Ledger transaction creation
- Refund
- Adjustment
- Hold
- Release
- Capture
- Settlement calculation
- Payout request
- Provider callback
- Reconciliation result ingestion

推荐键：

```text
sourceEventId + operationType + version
```

外部 Provider callback 必须支持重复投递。

## 18. Currency / Precision

所有金额：

```text
amountMinor: integer
currency: ISO-like currency code
```

禁止：

```text
float
binary floating point
implicit currency
```

跨币种转换必须显式记录：

```text
sourceCurrency
sourceAmount
exchangeRate
rateSource
rateVersion
targetCurrency
targetAmount
```

## 19. Financial Permissions

敏感权限至少分离：

```text
VIEW_FINANCIAL
CREATE_ADJUSTMENT
APPROVE_ADJUSTMENT
APPROVE_SETTLEMENT
REQUEST_PAYOUT
RETRY_PAYOUT
VIEW_RESTRICTED_FINANCIAL_DATA
```

普通业务管理员不得自动获得全部金融权限。

## 20. Audit / Evidence

以下操作必须审计：

- Wallet freeze/unfreeze
- Adjustment
- Refund
- Chargeback resolution
- Settlement approval
- Payout request
- Payout retry
- Manual reconciliation
- Financial permission changes

Audit 应记录：

```text
actorId
action
targetType
targetId
reasonCode
requestId
correlationId
beforeSummary
afterSummary
createdAt
```

不得保存不必要的支付凭据或完整敏感支付信息。

## 21. Privacy / Security

金融数据至少分级：

```text
INTERNAL
SENSITIVE
FINANCIAL
RESTRICTED
```

支付凭据由合规的外部支付系统管理；平台保存 provider token/reference，而不是不必要的完整卡信息。

所有金融 API 必须经过身份、权限、风险和审计检查。

## 22. Cache / Queue

Cache 只能保存派生余额、Dashboard 汇总或短期查询结果。

Queue 可用于：

- revenue processing
- settlement calculation
- reconciliation
- payout callbacks
- notification
- reporting

关键资金 Posting 必须保证最终一致性和可恢复性。

## 23. Rebuildability

以下数据必须可从权威事实重建：

```text
Wallet Balance Projection
Settlement Summary
Financial Dashboard
Creator Earnings View
MCN Revenue View
```

如果 Cache / Snapshot 丢失，不得丢失资金事实。

## 24. Data Lifecycle

```text
Financial Evidence
→ Validated
→ Posted
→ Settled
→ Paid / Refunded / Adjusted
→ Retained
→ Archived
```

Ledger 历史记录不得物理删除以“修正错误”。

Legal / financial retention requirements 优先于普通产品删除策略。

## 25. API Contract

代表性 API：

```text
GET  /v1/wallets/{id}
GET  /v1/wallets/{id}/transactions
POST /v1/wallets/{id}/holds
POST /v1/wallets/{id}/holds/{holdId}/release
GET  /v1/ledger/transactions/{id}
POST /v1/ledger/transactions
POST /v1/ledger/refunds
POST /v1/ledger/adjustments
GET  /v1/settlements
GET  /v1/settlements/{id}
POST /v1/settlements/{id}/calculate
POST /v1/settlements/{id}/approve
POST /v1/payouts
GET  /v1/payouts/{id}
POST /v1/reconciliation/runs
GET  /v1/reconciliation/runs/{id}
```

高风险金融 API 必须使用幂等键、版本检查、权限检查和审计。

## 26. Event Contract

代表性事件：

```text
financial.transaction.created
financial.transaction.posted
financial.transaction.reversed
financial.hold.created
financial.hold.released
financial.refund.posted
financial.adjustment.posted
financial.settlement.calculated
financial.settlement.approved
financial.payout.requested
financial.payout.succeeded
financial.payout.failed
financial.reconciliation.mismatch
```

事件必须包含稳定 event ID、entity ID、version、occurredAt 和 correlation ID。

消费者必须支持重复事件。

## 27. Cross-Domain Boundary

资金系统不得与其他业务域形成强耦合分布式事务。

推荐：

```text
Advertising / Marketplace / Commerce
→ Evidence / Command
→ Financial Validation
→ Ledger
→ Settlement
→ Payout
```

Rights、Risk、Moderation、Analytics 等提供必要的事实或决策引用，但不直接修改 Ledger。

## 28. Performance / Reliability

P0：

- Ledger posting 必须走有限且可恢复的权威路径；
- Dashboard 不得阻塞资金 Posting；
- Settlement calculation 可异步执行；
- Reconciliation 可批处理；
- Provider callback 必须幂等；
- 大型交易列表使用 cursor pagination；
- 任何 financial write 都必须可追踪 request/correlation ID；
- 资金事实必须可从持久化权威记录恢复。

## 29. Acceptance Criteria

Implementation readiness requires：

- Wallet authority boundary
- Immutable Ledger model
- Double-entry invariant
- Transaction lifecycle
- Revenue posting boundary
- Hold / Reserve
- Refund / Reversal / Adjustment
- Chargeback
- Settlement lifecycle
- Settlement Line provenance
- Payout lifecycle
- Reconciliation
- Currency precision
- Idempotency
- Financial permissions
- Audit
- Privacy/security classification
- Rebuildability
- API contract
- Event contract
- Cross-domain transaction boundary
- Data lifecycle

## 30. STOP Conditions

以下任一条件出现，禁止进入实现：

1. Wallet 可以脱离 Ledger 直接修改余额；
2. Ledger Entry 可以被删除或原地修改金融事实；
3. 非整数金额进入资金事实；
4. Transaction 无法证明借贷平衡；
5. Revenue Event 可以绕过 Risk / Validation 直接变成余额；
6. Refund / Adjustment 通过覆盖历史记录实现；
7. Settlement 无法追溯到 Ledger；
8. Payout 无法追溯到 Settlement；
9. Provider callback 非幂等；
10. 对账异常可以静默覆盖；
11. Cache 被当作金融权威；
12. 金融权限没有最小权限控制；
13. Financial history 无法审计或恢复；
14. 跨域资金操作依赖未批准的分布式事务。

## 31. Admission Status

```text
PRODUCT-ARCHITECTURE-COMPLETE
→ CONTRACT-READY
→ IMPLEMENTATION PENDING
```

本契约冻结 Wallet / Ledger / Settlement 的金融事实边界，为 Advertising、Marketplace、Commerce、MCN、Creator Economy 等上层商业域提供统一资金权威，而不复制其业务事实。
