# LuckRead L5-L6 IP License Commercial Settlement / Royalty / Commission / Tax Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

将 214 商业结算合同实例化为可执行 L5 与可验证 L6，并固定商业计算、对账、调整、分成、税务、汇率及财务最终性的边界。

```text
Contract
→ L5 Execution Unit
→ L6 Atomic Verification
→ Evidence
```

本文件不创建 Commerce / Ledger / Tax / Rights / Agreement / License Authority。

## 2. Coverage Registry

| L4 | L5 | L6 | 状态 |
|---|---|---|---|
| Commercial Components | L5-IP-216-COMPONENTS | 001-003 | PENDING |
| Money Model | L5-IP-216-MONEY | 004-006 | PENDING |
| Settlement Basis | L5-IP-216-BASIS | 007-009 | PENDING |
| Royalty | L5-IP-216-ROYALTY | 010-012 | PENDING |
| Revenue Share | L5-IP-216-REVSHARE | 013-015 | PENDING |
| Commission | L5-IP-216-COMMISSION | 016-018 | PENDING |
| Calculation Snapshot | L5-IP-216-CALC | 019-021 | PENDING |
| Reporting Period | L5-IP-216-PERIOD | 022-024 | PENDING |
| Royalty Report | L5-IP-216-REPORT | 025-028 | PENDING |
| Report Correction | L5-IP-216-CORRECTION | 029-031 | PENDING |
| Reconciliation | L5-IP-216-RECON | 032-035 | PENDING |
| Variance | L5-IP-216-VARIANCE | 036-038 | PENDING |
| Settlement Statement | L5-IP-216-STATEMENT | 039-041 | PENDING |
| Tax Reference | L5-IP-216-TAX | 042-044 | PENDING |
| FX Reference | L5-IP-216-FX | 045-047 | PENDING |
| Minimum Guarantee | L5-IP-216-MG | 048-050 | PENDING |
| Advance / Recoupment | L5-IP-216-RECOUP | 051-053 | PENDING |
| Payment Reconciliation | L5-IP-216-PAYMENT | 054-056 | PENDING |
| Refund / Chargeback | L5-IP-216-REFUND | 057-059 | PENDING |
| Commission Reversal | L5-IP-216-REVERSAL | 060-062 | PENDING |
| Settlement Dispute | L5-IP-216-DISPUTE | 063-065 | PENDING |
| Approval | L5-IP-216-APPROVAL | 066-068 | PENDING |
| Settlement State | L5-IP-216-STATE | 069-071 | PENDING |
| Idempotency | L5-IP-216-IDEMPOTENCY | 072-074 | PENDING |
| Versioning | L5-IP-216-VERSION | 075-077 | PENDING |
| Failure Safety | L5-IP-216-SAFETY | 078-080 | PENDING |
| Traceability | L5-IP-216-TRACE | 081-083 | PENDING |
| Audit | L5-IP-216-AUDIT | 084-086 | PENDING |

## 3. Common L5 Contract

Each L5 unit MUST define Intent, Input, Output, Preconditions, Validation, Authority, Scope, Decision Rule, Version, Idempotency, Transaction Boundary, Events, Errors, Recovery, Audit, Observability, Cost, Test and Evidence requirements.

## 4. Core L5 Units

### L5-IP-216-COMPONENTS

支持 License Fee、Minimum Guarantee、Advance、Royalty、Revenue Share、Platform Fee、Service Fee、Agency/Channel/Partner Commission、Adjustment、Tax Reference。每个组件必须有来源、范围、期间与版本。

### L5-IP-216-MONEY

所有金额使用 `currency + minorUnitAmount`，禁止浮点作为财务依据，并保存 basis / scope / period / version。

### L5-IP-216-BASIS

结算基础必须可追踪至 Order、Payment、Usage、Sales、Campaign、Distribution、Royalty Report 或 Revenue Share Report。

### L5-IP-216-ROYALTY

支持 FIXED、PERCENTAGE、TIERED、PER_UNIT、PER_VIEW、PER_SALE、MG_PLUS_ROYALTY、HYBRID；Rule 必须版本化。

### L5-IP-216-REVSHARE

参与方可以是 Licensor、Co-Licensor、Agency、MCN、Distributor、Platform、Partner；每项分成必须明确 party、basis、rate/fixed amount 与 effective dates。

### L5-IP-216-COMMISSION

支持 seller/buyer-service/agency/channel/partner/platform fees；佣金不得修改 License Scope。

### L5-IP-216-CALC

每次计算保存：`calculationId, calculationVersion, agreementVersion, licenseVersion, pricingVersion, royaltyRuleVersion, commissionRuleVersion, reportingPeriod, basisSnapshot, rateSnapshot, participantsSnapshot`。

历史计算不得被新费率覆盖。

### L5-IP-216-PERIOD

周期支持 DAILY / WEEKLY / MONTHLY / QUARTERLY / ANNUAL / CUSTOM，并明确时区与边界。

### L5-IP-216-REPORT

Report 保存 `reportId, licenseId, period, territory, channel, units, salesAmount, usageMetric, adjustments, submittedBy, submittedAt, status`。历史 append-only。

### L5-IP-216-CORRECTION

错误报告采用：

```text
Original Report → Correction → New Version → Recalculation → Adjustment Reference
```

不得删除原始报告。

### L5-IP-216-RECON

执行：

```text
Order × Payment × Report × Agreement × License × Rate
→ MATCHED / VARIANCE / REVIEW_REQUIRED / BLOCKED
```

### L5-IP-216-VARIANCE

至少区分 DATA_MISMATCH、PAYMENT_MISSING、REPORT_MISSING、RATE_MISMATCH、SCOPE_MISMATCH、TERRITORY_MISMATCH、TERM_MISMATCH、DUPLICATE、REFUND_IMPACT、ADJUSTMENT_REQUIRED。

重大差异不得静默进入结算。

### L5-IP-216-STATEMENT

Statement 保存 gross、royalty、commission、service fee、tax reference、adjustment、net 及来源引用。Statement ≠ Ledger Fact。

### L5-IP-216-TAX

保存税务辖区、税种、税率引用、税务文档、代扣引用；最终税务结果由授权税务/财务 Authority 决定。

### L5-IP-216-FX

支持 transactionCurrency / settlementCurrency / fxRateReference / fxRateTimestamp / fxPolicyVersion，并保留计算快照。

### L5-IP-216-MG

保存 guaranteeAmount、paymentSchedule、recoupmentPolicy、reportingBasis。

### L5-IP-216-RECOUP

`Advance → Eligible Royalty/Revenue → Recoupment → Remaining Balance`，余额可重算可审计。

### L5-IP-216-PAYMENT

记录 payment/reference/status/refund/chargeback；Commerce 提供支付最终事实。

### L5-IP-216-REFUND

Refund / Chargeback 必须定位受影响 Settlement Period，并通过 Adjustment + Reconciliation 处理，不能覆盖历史 Statement。

### L5-IP-216-REVERSAL

佣金状态支持 PENDING / EARNED / REVERSED / ADJUSTED；Reverse 保留原始历史。

### L5-IP-216-DISPUTE

争议支持 OPEN / UNDER_REVIEW / EVIDENCE_REQUIRED / MEDIATION / RESOLVED / ESCALATED，并关联 Statement、Report、Calculation、Evidence。

### L5-IP-216-APPROVAL

高价值结算可要求 Business / Finance / Legal / Compliance Approval；审批不重写 Agreement / License。

### L5-IP-216-STATE

```text
PREPARING
→ CALCULATED
→ RECONCILIATION_REQUIRED
→ APPROVAL_REQUIRED
→ READY_FOR_SETTLEMENT
→ SUBMITTED_TO_COMMERCE
→ SETTLED
```

异常：`ADJUSTMENT_REQUIRED / DISPUTED / BLOCKED`。

`SETTLED` 只能由正式财务 Authority 确认。

### L5-IP-216-IDEMPOTENCY

Submit Report、Calculate Settlement、Create Statement、Submit、Adjustment、Commission Reversal、Payment/Refund Reference 均必须幂等。

### L5-IP-216-VERSION

结算上下文固定引用 Agreement / License / Pricing / Royalty / Commission / Tax / FX / Report Versions。

### L5-IP-216-SAFETY

```text
UNKNOWN ≠ SETTLED
```

支付、报告、费率、Ledger 状态未知时，默认 `REVIEW_REQUIRED / BLOCKED`。

### L5-IP-216-TRACE

所有关键操作必须能够关联：

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

### L5-IP-216-AUDIT

审计覆盖 Report、Correction、Rate、Calculation、Reconciliation、Variance、Statement、Tax、FX、Approval、Adjustment、Commission Reversal、Dispute、Settlement。

## 5. L6 Atomic Verification Units

### L6-IP-216-001—003
商业组件具有来源、范围与期间；组件不能隐式修改 License Scope。

### L6-IP-216-004—006
金额使用 minor units；每个金额具有 currency；金额具备 basis/scope/period/version。

### L6-IP-216-007—009
Settlement Basis 可定位来源；不可追踪来源的金额不能进入正式计算；来源引用保持稳定。

### L6-IP-216-010—012
Royalty Rule 有稳定版本；计算可定位适用期间与范围；模型与合同一致。

### L6-IP-216-013—015
Revenue Share 参与方有明确 basis/effective dates；不存在隐式全额归属。

### L6-IP-216-016—018
Commission 来源可追踪；Commission 不改变 License；适用范围可解释。

### L6-IP-216-019—021
Calculation Snapshot 完整；新费率不得覆盖历史 Calculation；Calculation Version 唯一。

### L6-IP-216-022—024
Period 边界明确；时区明确；Report 状态符合状态机。

### L6-IP-216-025—028
Report 绑定 License；有 submittedBy/submittedAt；历史可保留；Correction 可关联原报告并生成新版本。

### L6-IP-216-029—031
Correction 触发重新计算；不删除原证据；Reconciliation 同时检查 Order/Payment/Report/Terms/License/Rate。

### L6-IP-216-032—035
Reconciliation 结果可区分；Variance 可分类；重大差异不能直接 Settled；阻断条件可追踪。

### L6-IP-216-036—038
Variance 分类完整；Adjustment 必须有来源；人工差异处理可审计。

### L6-IP-216-039—041
Settlement Statement 引用完整；Statement 与 Ledger 明确分离；历史 Statement 不可覆盖。

### L6-IP-216-042—044
Tax Reference 可定位辖区/税种/税率；税务版本可追踪；Tax Reference 不冒充最终税务事实。

### L6-IP-216-045—047
FX Reference 可定位汇率与时间；FX Policy 有版本；结算保存计算时 FX 快照。

### L6-IP-216-048—050
Minimum Guarantee 具有金额与支付计划；Guarantee 不等于最终 Royalty；Recoupment Balance 可重算。

### L6-IP-216-051—053
Advance 能映射至可抵扣收益；余额可审计；Recoupment 不产生虚假 Ledger Finality。

### L6-IP-216-054—056
Payment Reference 可追踪；Refund/Chargeback Reference 可追踪；Commerce 是支付最终事实来源。

### L6-IP-216-057—059
Refund/Chargeback 能定位受影响结算；历史 Statement 不被覆盖；Adjustment 可重算。

### L6-IP-216-060—062
Commission Reversal 保留原历史；Reverse 可定位原因；重复 Reverse 不产生重复财务事实。

### L6-IP-216-063—065
Settlement Dispute 唯一化；争议绑定 Evidence；争议不会覆盖原始结算历史。

### L6-IP-216-066—068
Approval 使用明确 Policy Version；审批结果绑定范围；缺少 blocking approval 不得进入 Ready。

### L6-IP-216-069—071
Settlement State 符合状态机；SETTLED 必须有正式财务确认；状态变化保留历史。

### L6-IP-216-072—074
关键操作幂等；重复请求不能生成重复 Settlement；幂等键可追踪。

### L6-IP-216-075—077
Settlement 引用精确 Version Snapshot；历史版本不可覆盖；Version 变化可触发重新计算。

### L6-IP-216-078—080
UNKNOWN 不得 Settled；关键依赖不可用时进入 Review/Block；不存在隐式安全降级。

### L6-IP-216-081—083
API/Event 可关联完整交易；Correlation 可跨异步步骤传递；关键事实可反向追踪。

### L6-IP-216-084—086
关键结算动作均有 audit actor/time/reason/evidence；历史可重建；人工调整可追溯。

## 6. Global Invariants

```text
I1: Settlement Statement ≠ Ledger Fact
I2: UNKNOWN ≠ SETTLED
I3: Historical Calculation / Statement / Report are immutable snapshots
I4: Material variance cannot silently settle
I5: Refund / Chargeback triggers impact assessment
I6: Manual adjustment requires actor + reason + evidence
I7: Commerce / Ledger retain final financial authority
I8: Agreement / License / Pricing / Rule versions are preserved
I9: Duplicate settlement requests are idempotent
I10: No financial finality without authoritative confirmation
```

## 7. Implementation Boundary

本注册表不授权代码实现。

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
