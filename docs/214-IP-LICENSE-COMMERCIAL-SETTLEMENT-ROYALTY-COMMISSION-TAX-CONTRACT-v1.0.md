# LuckRead IP License Commercial Settlement / Royalty / Commission / Tax Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 IP 授权交易发生后的商业对账、Royalty、Revenue Share、平台服务费、佣金、渠道分成、税务信息与结算引用边界。

目标是把：

```text
Order
→ Payment
→ Usage / Sales Report
→ Royalty Calculation
→ Commission Allocation
→ Tax / Fee Reference
→ Settlement Statement
→ Commerce / Ledger Settlement
```

形成可追踪商业链路，同时严格避免 IP Trading、License 或报告系统自行成为财务最终权威。

## 2. Authority Boundary

```text
Rights → 权利事实
Agreement → 商业与合同条款事实
License → 生效授权事实
Commerce → 订单 / 支付 / 退款事实
Ledger → 财务账簿 / 应收应付 / 结算事实
Tax / Fiscal Provider → 税务计算或合规结果
IP Trading → 商业交易上下文 / 结算引用 / 展示
```

## 3. Commercial Components

至少支持：

```text
License Fee
Minimum Guarantee
Advance
Royalty
Revenue Share
Platform Fee
Service Fee
Agency Commission
Channel Commission
Partner Share
Performance Fee
Adjustment
Credit / Debit Reference
Tax Reference
```

## 4. Money Model

金额必须使用：

```text
currency
minorUnitAmount
```

禁止使用浮点数作为财务依据。

每个金额必须说明：

```text
basis
scope
period
priceVersion
agreementVersion
```

## 5. Settlement Basis

商业结算基础可以来自：

```text
ORDER
PAYMENT
USAGE
SALES
CAMPAIGN
DISTRIBUTION
ROYALTY_REPORT
REVENUE_SHARE_REPORT
```

基础记录必须可追踪来源。

## 6. Royalty Model

支持：

```text
FIXED_ROYALTY
PERCENTAGE
TIERED_PERCENTAGE
PER_UNIT
PER_VIEW
PER_SALE
MINIMUM_GUARANTEE_PLUS_ROYALTY
HYBRID
```

Royalty Rate 必须版本化。

## 7. Revenue Share

支持多方分成：

```text
LICENSOR
CO_LICENSOR
AGENCY
MCN
DISTRIBUTOR
PLATFORM
PARTNER
```

每个参与者必须有明确：

```text
partyRef
shareType
shareRate / fixedAmount
basis
effectiveFrom
effectiveTo
```

## 8. Commission

平台可以根据商业政策产生：

```text
SELLER_COMMISSION
BUYER_SERVICE_FEE
AGENCY_COMMISSION
CHANNEL_COMMISSION
PARTNER_COMMISSION
PLATFORM_FEE
```

佣金规则不得修改 License Scope。

## 9. Settlement Calculation Snapshot

每次结算计算必须保存：

```text
settlementCalculationId
calculationVersion
agreementVersion
licenseVersion
pricingVersion
reportingPeriod
basisSnapshot
rateSnapshot
participantsSnapshot
calculatedAt
```

历史结算不得因新费率变化而被原地重算覆盖。

## 10. Reporting Period

支持：

```text
DAILY
WEEKLY
MONTHLY
QUARTERLY
ANNUAL
CUSTOM
```

不同 License Family 可以使用不同周期。

## 11. Royalty Report

报告至少包含：

```text
reportId
licenseId
reportingPeriod
territory
channel
units
salesAmount
usageMetric
adjustments
submittedBy
submittedAt
status
```

报告是商业计算输入，不自动成为 Ledger 最终账务事实。

## 12. Report Status

```text
DRAFT
SUBMITTED
UNDER_REVIEW
ACCEPTED
REJECTED
CORRECTED
SUPERSEDED
```

Report 历史必须保留。

## 13. Report Correction

错误报告必须：

```text
Original Report
→ Correction
→ New Version
→ Recalculation
→ Adjustment Reference
```

禁止删除原始报告证明历史。

## 14. Reconciliation

结算前应执行：

```text
Order
× Payment
× Usage / Sales Report
× Agreement Terms
× License Scope
× Pricing / Royalty Version
→ Reconciliation Result
```

结果：

```text
MATCHED
VARIANCE
REVIEW_REQUIRED
BLOCKED
```

## 15. Variance

差异至少分类：

```text
DATA_MISMATCH
PAYMENT_MISSING
REPORT_MISSING
RATE_MISMATCH
SCOPE_MISMATCH
TERRITORY_MISMATCH
TERM_MISMATCH
DUPLICATE
REFUND_IMPACT
ADJUSTMENT_REQUIRED
```

重大差异必须进入人工或自动补偿流程。

## 16. Settlement Statement

平台可生成商业结算单：

```text
statementId
period
licenseId
reportRefs
calculationRefs
grossAmount
royaltyAmount
commissionAmount
serviceFeeAmount
taxReference
adjustmentAmount
netAmount
status
```

结算单是商业解释与对账产物，不替代 Ledger。

## 17. Tax Boundary

支持记录税务引用：

```text
taxJurisdiction
taxType
taxRateReference
taxDocumentReference
withholdingReference
```

具体税务最终结果可由外部税务/财务 Authority 提供。

## 18. Currency / FX

跨币种场景支持：

```text
transactionCurrency
settlementCurrency
fxRateReference
fxRateTimestamp
fxPolicyVersion
```

平台必须保留计算时使用的汇率引用与版本。

## 19. Minimum Guarantee

支持：

```text
guaranteeAmount
paymentSchedule
recoupmentPolicy
reportingBasis
```

Minimum Guarantee 不自动代表 Royalty 已结算完成。

## 20. Advance / Recoupment

如合同存在预付款：

```text
Advance
→ Eligible Revenue / Royalty
→ Recoupment
→ Remaining Balance
```

余额必须可解释、可审计。

## 21. Payment Reconciliation

必须关联：

```text
paymentReference
paymentStatus
paidAt
refundReference
chargebackReference
```

Commerce 提供支付最终事实，Trading 只保存引用。

## 22. Refund / Chargeback Impact

退款或拒付发生后，应重新评估受影响结算：

```text
Refund / Chargeback
→ Affected Settlement Period
→ Adjustment
→ Reconciliation
→ Commerce / Ledger Reference
```

不得直接覆盖历史 Settlement Statement。

## 23. Commission Reversal

发生退款、取消或无效交易时，平台佣金可能需要：

```text
EARNED
PENDING
REVERSED
ADJUSTED
```

最终财务事实仍由 Ledger / Commerce 决定。

## 24. Dispute

商业结算争议支持：

```text
OPEN
UNDER_REVIEW
EVIDENCE_REQUIRED
MEDIATION
RESOLVED
ESCALATED
```

争议必须绑定：

```text
statementId
reportRefs
calculationRefs
evidenceRefs
```

## 25. Audit Trail

必须审计：

```text
Report Submission
Report Correction
Rate Selection
Calculation
Reconciliation
Adjustment
Approval
Settlement Statement
Tax Reference
Commission Reversal
Dispute Resolution
```

## 26. Settlement Approval

高价值结算可以触发：

```text
BUSINESS_APPROVAL
FINANCE_APPROVAL
LEGAL_APPROVAL
COMPLIANCE_APPROVAL
```

审批不会改变原始 Agreement 或 License 事实。

## 27. Settlement State

```text
PREPARING
CALCULATED
RECONCILIATION_REQUIRED
APPROVAL_REQUIRED
READY_FOR_SETTLEMENT
SUBMITTED_TO_COMMERCE
SETTLED
ADJUSTMENT_REQUIRED
DISPUTED
BLOCKED
```

`SETTLED` 只有获得正式财务 Authority 确认后才成立。

## 28. Idempotency

关键操作必须幂等：

```text
Submit Report
Calculate Settlement
Create Statement
Submit Settlement
Apply Adjustment
Reverse Commission
Record Payment Reference
Record Refund Reference
```

重复请求不得生成重复正式结算事实。

## 29. Versioning

结算上下文至少引用：

```text
Agreement Version
License Version
Pricing Version
Royalty Rule Version
Commission Rule Version
Tax Policy Version
FX Policy Version
Report Version
```

## 30. Failure Safety

任何关键依赖状态未知：

```text
UNKNOWN ≠ SETTLED
```

无法确认支付、报告、费率或必要账务状态时，默认进入 `REVIEW_REQUIRED` 或 `BLOCKED`。

## 31. API Surface

建议：

```text
POST /v1/ip/licenses/{id}/reports
GET  /v1/ip/licenses/{id}/reports
POST /v1/ip/settlements/calculate
POST /v1/ip/settlements/reconcile
GET  /v1/ip/settlements/{id}
POST /v1/ip/settlements/{id}/approve
POST /v1/ip/settlements/{id}/submit
POST /v1/ip/settlements/{id}/adjust
GET  /v1/ip/settlements/{id}/statement
```

## 32. Event Contract

至少支持：

```text
royalty.report.submitted
royalty.report.corrected
settlement.calculated
settlement.reconciliation_required
settlement.approved
settlement.submitted
settlement.settled
settlement.adjustment_required
commission.reversed
settlement.disputed
```

事件只表达业务事实，不替代 Ledger Settlement。

## 33. Machine Invariants

```text
I1: Settlement calculation uses explicit version snapshots
I2: Report correction never deletes original history
I3: Settlement Statement ≠ Ledger Fact
I4: Unknown payment state ≠ settled
I5: Refund / chargeback can trigger recalculation or adjustment
I6: Commission reversal preserves original commission history
I7: Royalty calculation basis is traceable
I8: Multi-party shares have explicit scope and effective dates
I9: Tax data is referenceable and versioned
I10: Historical settlements are immutable
I11: Duplicate settlement requests are idempotent
I12: Material variance cannot silently become settled
I13: Agreement / License version changes do not rewrite prior settlement snapshots
I14: Manual adjustment requires actor + reason + evidence
I15: Financial finality belongs to Commerce / Ledger Authority
```

## 34. Cross-Contract Dependencies

```text
209 / 210 Trade Execution
211 / 212 License Lifecycle
213 Usage / Compliance
214 Commercial Settlement
 ↓
65 Commerce
68 Wallet / Ledger
64 Rights
62 Risk
176 Evidence
160 Data Lifecycle
163 Event Semantics
```

## 35. Acceptance Gates

```text
[ ] Commercial components defined
[ ] Royalty model defined
[ ] Revenue share defined
[ ] Commission model defined
[ ] Reporting defined
[ ] Calculation snapshot defined
[ ] Reconciliation defined
[ ] Variance handling defined
[ ] Settlement Statement defined
[ ] Tax boundary defined
[ ] FX boundary defined
[ ] Refund / chargeback impact defined
[ ] Commission reversal defined
[ ] Dispute defined
[ ] Approval defined
[ ] Versioning defined
[ ] Idempotency defined
[ ] Failure-safe semantics defined
[ ] Machine invariants defined
```

## 36. Implementation Boundary

本合同只定义产品与架构约束，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
