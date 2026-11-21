# LuckRead L5-L6 IP License Commercial Settlement / Royalty / Commission / Tax Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 214 IP License Commercial Settlement / Royalty / Commission / Tax Contract 实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

原则：

```text
L4 Product Contract
→ L5 Execution Unit
→ L6 Verification Atomic Unit
→ Evidence
```

本文件不创造新的 Commerce、Ledger、Tax、Rights、Agreement 或 License Authority，也不授权代码实现。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Commercial Components | L5-IP-215-COMPONENTS | 001-003 | PENDING |
| Money Model | L5-IP-215-MONEY | 004-006 | PENDING |
| Settlement Basis | L5-IP-215-BASIS | 007-009 | PENDING |
| Royalty Model | L5-IP-215-ROYALTY | 010-012 | PENDING |
| Revenue Share | L5-IP-215-REVSHARE | 013-015 | PENDING |
| Commission | L5-IP-215-COMMISSION | 016-018 | PENDING |
| Calculation Snapshot | L5-IP-215-CALC | 019-021 | PENDING |
| Reporting Period | L5-IP-215-PERIOD | 022-023 | PENDING |
| Royalty Report | L5-IP-215-REPORT | 024-027 | PENDING |
| Report Correction | L5-IP-215-CORRECTION | 028-030 | PENDING |
| Reconciliation | L5-IP-215-RECON | 031-034 | PENDING |
| Variance | L5-IP-215-VARIANCE | 035-037 | PENDING |
| Settlement Statement | L5-IP-215-STATEMENT | 038-040 | PENDING |
| Tax Reference | L5-IP-215-TAX | 041-043 | PENDING |
| FX Reference | L5-IP-215-FX | 044-046 | PENDING |
| Minimum Guarantee | L5-IP-215-MINIMUM-GUARANTEE | 047-049 | PENDING |
| Advance / Recoupment | L5-IP-215-RECOUPMENT | 050-052 | PENDING |
| Payment Reconciliation | L5-IP-215-PAYMENT-RECON | 053-055 | PENDING |
| Refund / Chargeback Impact | L5-IP-215-REFUND | 056-058 | PENDING |
| Commission Reversal | L5-IP-215-COMMISSION-REVERSAL | 059-061 | PENDING |
| Settlement Dispute | L5-IP-215-DISPUTE | 062-064 | PENDING |
| Settlement Approval | L5-IP-215-APPROVAL | 065-067 | PENDING |
| Settlement State | L5-IP-215-STATE | 068-070 | PENDING |
| Idempotency | L5-IP-215-IDEMPOTENCY | 071-073 | PENDING |
| Versioning | L5-IP-215-VERSION | 074-076 | PENDING |
| Failure Safety | L5-IP-215-SAFETY | 077-079 | PENDING |
| API / Event Traceability | L5-IP-215-TRACE | 080-082 | PENDING |
| Audit | L5-IP-215-AUDIT | 083-085 | PENDING |

## 3. Common L5 Execution Contract

每个 L5 Unit MUST 明确：

```text
Intent
Input
Output
Preconditions
Validation
Authority
Decision Rule
Scope
State Transition
Data Boundary
Concurrency / Version
Idempotency
Transaction Boundary
Events
Async Behavior
Cache Behavior
Error Taxonomy
Recovery
Audit
Observability
Cost
Test Plan
Evidence Requirement
```

## 4. L5-IP-215-COMPONENTS

商业组件至少支持：

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
Tax Reference
```

组件必须有来源、范围和适用期间。

## 5. L5-IP-215-MONEY

金额统一：

```text
currency
minorUnitAmount
```

任何财务金额不得依赖浮点数计算。

每项金额必须具有：

```text
basis
scope
period
version
```

## 6. L5-IP-215-BASIS

结算基础必须引用：

```text
Order
Payment
Usage
Sales
Campaign
Distribution
Royalty Report
Revenue Share Report
```

不可追踪来源的金额不能进入正式计算。

## 7. L5-IP-215-ROYALTY

支持：

```text
FIXED
PERCENTAGE
TIERED_PERCENTAGE
PER_UNIT
PER_VIEW
PER_SALE
MG_PLUS_ROYALTY
HYBRID
```

Royalty Rule 必须版本化。

## 8. L5-IP-215-REVSHARE

分成参与方：

```text
LICENSOR
CO_LICENSOR
AGENCY
MCN
DISTRIBUTOR
PLATFORM
PARTNER
```

每一份分成必须明确：

```text
partyRef
shareType
shareRate / fixedAmount
basis
effectiveFrom
effectiveTo
```

## 9. L5-IP-215-COMMISSION

佣金至少支持：

```text
SELLER_COMMISSION
BUYER_SERVICE_FEE
AGENCY_COMMISSION
CHANNEL_COMMISSION
PARTNER_COMMISSION
PLATFORM_FEE
```

佣金计算不得修改 License Scope。

## 10. L5-IP-215-CALC

结算计算 Snapshot：

```text
settlementCalculationId
calculationVersion
agreementVersion
licenseVersion
pricingVersion
royaltyRuleVersion
commissionRuleVersion
reportingPeriod
basisSnapshot
rateSnapshot
participantsSnapshot
calculatedAt
```

历史计算不得被后续费率原地覆盖。

## 11. L5-IP-215-PERIOD

周期：

```text
DAILY
WEEKLY
MONTHLY
QUARTERLY
ANNUAL
CUSTOM
```

周期必须明确 start/end 与时区语义。

## 12. L5-IP-215-REPORT

Royalty Report：

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

状态：

```text
DRAFT
SUBMITTED
UNDER_REVIEW
ACCEPTED
REJECTED
CORRECTED
SUPERSEDED
```

## 13. L5-IP-215-CORRECTION

错误报告必须形成：

```text
Original Report
→ Correction
→ New Version
→ Recalculation
→ Adjustment Reference
```

不得删除原始版本。

## 14. L5-IP-215-RECON

结算前执行：

```text
Order
× Payment
× Usage / Sales Report
× Agreement Terms
× License Scope
× Pricing / Royalty Version
→ Reconciliation
```

结果：

```text
MATCHED
VARIANCE
REVIEW_REQUIRED
BLOCKED
```

## 15. L5-IP-215-VARIANCE

差异分类：

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

重大差异不得静默进入 SETTLED。

## 16. L5-IP-215-STATEMENT

Settlement Statement 至少引用：

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

Statement 是解释/对账产物，不是 Ledger 最终事实。

## 17. L5-IP-215-TAX

保存：

```text
taxJurisdiction
taxType
taxRateReference
taxDocumentReference
withholdingReference
```

税务最终结果由授权 Tax / Fiscal Authority 提供。

## 18. L5-IP-215-FX

跨币种支持：

```text
transactionCurrency
settlementCurrency
fxRateReference
fxRateTimestamp
fxPolicyVersion
```

必须保留计算时的 FX 引用。

## 19. L5-IP-215-MINIMUM-GUARANTEE

保存：

```text
guaranteeAmount
paymentSchedule
recoupmentPolicy
reportingBasis
```

Guarantee 不等于 Royalty 已最终结算。

## 20. L5-IP-215-RECOUPMENT

支持：

```text
Advance
→ Eligible Royalty / Revenue
→ Recoupment
→ Remaining Balance
```

余额必须可以重新计算与审计。

## 21. L5-IP-215-PAYMENT-RECON

支付引用：

```text
paymentReference
paymentStatus
paidAt
refundReference
chargebackReference
```

Commerce 提供支付最终事实。

## 22. L5-IP-215-REFUND

退款/拒付发生时：

```text
Refund / Chargeback
→ Affected Settlement
→ Adjustment
→ Reconciliation
```

不得覆盖历史结算 Statement。

## 23. L5-IP-215-COMMISSION-REVERSAL

佣金状态：

```text
PENDING
EARNED
REVERSED
ADJUSTED
```

Reverse 必须保留原 Commission 历史。

## 24. L5-IP-215-DISPUTE

结算争议状态：

```text
OPEN
UNDER_REVIEW
EVIDENCE_REQUIRED
MEDIATION
RESOLVED
ESCALATED
```

必须引用 Statement、Report、Calculation、Evidence。

## 25. L5-IP-215-APPROVAL

高价值结算可触发：

```text
BUSINESS
FINANCE
LEGAL
COMPLIANCE
```

审批不能重写原 Agreement / License。

## 26. L5-IP-215-STATE

结算状态：

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

`SETTLED` 只能由正式财务 Authority 确认。

## 27. L5-IP-215-IDEMPOTENCY

关键操作：

```text
Submit Report
Calculate Settlement
Create Statement
Submit Settlement
Apply Adjustment
Reverse Commission
Record Payment
Record Refund
```

重复请求不得产生重复正式事实。

## 28. L5-IP-215-VERSION

结算必须引用：

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

## 29. L5-IP-215-SAFETY

关键状态未知时：

```text
UNKNOWN ≠ SETTLED
```

支付、报告、费率或 Ledger 状态无法确认时，默认：

```text
REVIEW_REQUIRED / BLOCKED
```

## 30. L5-IP-215-TRACE

关键 API / Event 必须可映射到：

```text
settlementId
licenseId
orderId
reportId
calculationId
statementId
caseId?
correlationId
```

事件：

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

## 31. L5-IP-215-AUDIT

审计至少覆盖：

```text
Report
Correction
Rate Selection
Calculation
Reconciliation
Variance
Statement
Tax Reference
FX Reference
Approval
Adjustment
Commission Reversal
Dispute
Settlement
```

## 32. L6 Verification Atomic Units

### L6-IP-215-001
每个商业结算组件具有明确来源与适用范围。

### L6-IP-215-002
商业组件不能隐式修改 License Scope。

### L6-IP-215-003
金额使用整数 minor units。

### L6-IP-215-004
每个金额具有 currency。

### L6-IP-215-005
金额具有 basis / scope / period / version。

### L6-IP-215-006
无来源的金额不能进入正式结算计算。

### L6-IP-215-007
Settlement Basis 能定位来源对象。

### L6-IP-215-008
Royalty Rule 具有稳定版本。

### L6-IP-215-009
Royalty 计算能够识别适用期间与范围。

### L6-IP-215-010
支持的 Royalty Model 与合同定义一致。

### L6-IP-215-011
Revenue Share 每个参与方具有明确 basis。

### L6-IP-215-012
Revenue Share 每个参与方具有有效期限。

### L6-IP-215-013
Revenue Share 不得默认假设任意参与方拥有全部收入。

### L6-IP-215-014
Commission Rule 具有可追踪来源。

### L6-IP-215-015
Commission 不得修改 License 权利范围。

### L6-IP-215-016
Commission 参与方和适用范围可解释。

### L6-IP-215-017
Settlement Calculation 保存完整版本 Snapshot。

### L6-IP-215-018
后续费率变化不能覆盖历史 Calculation Snapshot。

### L6-IP-215-019
Calculation Version 可被唯一识别。

### L6-IP-215-020
Reporting Period 具有明确边界。

### L6-IP-215-021
周期边界具有时区语义。

### L6-IP-215-022
Royalty Report 绑定 License。

### L6-IP-215-023
Report 包含 reportingPeriod。

### L6-IP-215-024
Report 状态符合定义状态机。

### L6-IP-215-025
Report 具有 submittedBy 与 submittedAt。

### L6-IP-215-026
Report 历史不会因为修正而被删除。

### L6-IP-215-027
Correction 能关联原 Report。

### L6-IP-215-028
Correction 生成新版本。

### L6-IP-215-029
Correction 后重新计算能够引用新版本。

### L6-IP-215-030
Correction 不覆盖原始证据历史。

### L6-IP-215-031
Reconciliation 同时检查 Order、Payment、Report、Terms、License、Rate。

### L6-IP-215-032
Reconciliation 结果可区分 MATCHED / VARIANCE。

### L6-IP-215-033
REVIEW_REQUIRED 不得直接转换为 SETTLED。

### L6-IP-215-034
BLOCKED Reconciliation 不得产生正式 Settled 结论。

### L6-IP-215-035
Variance 使用结构化分类。

### L6-IP-215-036
重大 Variance 必须触发 Review 或 Block。

### L6-IP-215-037
Variance 可以追踪到源记录。

### L6-IP-215-038
Settlement Statement 能引用 Calculation 与 Reports。

### L6-IP-215-039
Statement 不成为 Ledger Authority。

### L6-IP-215-040
Statement 历史不能被原地覆盖。

### L6-IP-215-041
Tax Reference 具有 jurisdiction 与 type。

### L6-IP-215-042
Tax Reference 可以定位来源文档或 Authority。

### L6-IP-215-043
Tax Reference 不伪装为最终税务账务事实。

### L6-IP-215-044
FX Reference 具有时间戳。

### L6-IP-215-045
FX Policy 具有版本。

### L6-IP-215-046
历史计算能够使用当时的 FX Reference 重建。

### L6-IP-215-047
Minimum Guarantee 具有金额与支付计划。

### L6-IP-215-048
Recoupment 余额可以重新计算。

### L6-IP-215-049
Recoupment 不会删除 Advance 历史。

### L6-IP-215-050
Payment Reconciliation 引用 Commerce Payment。

### L6-IP-215-051
Payment Unknown 不得当作 Paid。

### L6-IP-215-052
Refund / Chargeback 能识别受影响 Settlement。

### L6-IP-215-053
Refund Impact 通过 Adjustment 处理而不是历史覆盖。

### L6-IP-215-054
Chargeback Impact 可以触发重新对账。

### L6-IP-215-055
Commission Reversal 保留原 Commission 历史。

### L6-IP-215-056
Reversal 能关联触发原因。

### L6-IP-215-057
Adjusted Commission 不会隐藏原值。

### L6-IP-215-058
Settlement Dispute 具有唯一标识。

### L6-IP-215-059
Dispute 绑定 Statement / Report / Calculation / Evidence。

### L6-IP-215-060
Dispute 状态历史可审计。

### L6-IP-215-061
高价值 Settlement 可要求正式 Approval。

### L6-IP-215-062
Approval 绑定 policyVersion 与 scope。

### L6-IP-215-063
Approval 不能重写 Agreement / License。

### L6-IP-215-064
SETTLED 必须获得 Commerce / Ledger 正式确认。

### L6-IP-215-065
Settlement State 符合定义状态机。

### L6-IP-215-066
SETTLED 不得在依赖状态 UNKNOWN 时生成。

### L6-IP-215-067
Settlement State 变化可以关联正式事件。

### L6-IP-215-068
关键提交操作具有幂等语义。

### L6-IP-215-069
重复 Calculate 不产生无法关联的新正式结算事实。

### L6-IP-215-070
重复 Submit 不产生重复 Settled 事实。

### L6-IP-215-071
结算引用 Agreement Version。

### L6-IP-215-072
结算引用 License Version。

### L6-IP-215-073
结算引用 Report / Rule / Policy Version。

### L6-IP-215-074
版本引用能够重建计算上下文。

### L6-IP-215-075
未知 Payment / Report / Rate / Ledger 状态不能自动 Settlement。

### L6-IP-215-076
Failure Safety 默认进入 Review 或 Block。

### L6-IP-215-077
关键 API 可以追溯到 Settlement Aggregate。

### L6-IP-215-078
关键 Event 具备 correlationId / causationId 关联能力。

### L6-IP-215-079
事件不会越权修改 Commerce / Ledger 最终事实。

### L6-IP-215-080
Audit 能覆盖完整 Settlement 生命周期。

### L6-IP-215-081
Audit 记录 actor、action、timestamp 与结果。

### L6-IP-215-082
人工 Adjustment 必须有 reason 与 evidence。

### L6-IP-215-083
历史 Settlement 不能通过普通写操作删除。

### L6-IP-215-084
关键 Settlement 决策可反向追踪 Evidence Registry。

### L6-IP-215-085
最终财务事实归属于 Commerce / Ledger Authority。

## 33. Machine Invariants

```text
I1: Calculation uses explicit immutable version snapshots
I2: Historical reports are append-only
I3: Statement ≠ Ledger Fact
I4: Unknown payment state ≠ settled
I5: Unknown ledger state ≠ settled
I6: Material variance cannot silently settle
I7: Refund / chargeback preserves historical records
I8: Commission reversal preserves original history
I9: Multi-party share has explicit basis and dates
I10: Tax and FX references are versioned / traceable
I11: Duplicate operations are idempotent
I12: Agreement / License version changes do not rewrite prior settlement snapshots
I13: Manual adjustments require actor + reason + evidence
I14: Financial finality belongs to Commerce / Ledger Authority
```

## 34. Cross-Contract Dependencies

```text
214 Commercial Settlement Contract
 ↓
215 L5/L6 Settlement Registry
 ↓
209 / 210 Trade Execution
211 / 212 License Lifecycle
213 Usage / Compliance
 ↓
65 Commerce
68 Wallet / Ledger
64 Rights
62 Risk
176 Evidence Registry
160 Data Lifecycle
163 Event Semantics
```

## 35. Acceptance Gates

```text
[ ] Components instantiated
[ ] Money model instantiated
[ ] Royalty / Revenue Share instantiated
[ ] Commission instantiated
[ ] Calculation snapshot instantiated
[ ] Reporting instantiated
[ ] Correction instantiated
[ ] Reconciliation instantiated
[ ] Variance instantiated
[ ] Statement instantiated
[ ] Tax / FX references instantiated
[ ] Refund / chargeback instantiated
[ ] Commission reversal instantiated
[ ] Dispute instantiated
[ ] Approval instantiated
[ ] Settlement state instantiated
[ ] Idempotency instantiated
[ ] Versioning instantiated
[ ] Failure safety instantiated
[ ] API / event traceability instantiated
[ ] Audit instantiated
[ ] Evidence binding instantiated
```

## 36. Implementation Boundary

本注册表只定义 L5/L6 可验证结构，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
