# LuckRead IP Payout / Distribution / Financial Finality Contract v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同补齐 IP Center 的 P0 商业收入闭环：

```text
Settlement
→ Payable Allocation
→ Beneficiary Distribution
→ Commission / Fee / Tax Allocation
→ Payout Instruction
→ Payout Execution
→ Payout Confirmation
→ Reconciliation
→ Ledger Finality
```

目标是把“已经完成 Settlement”与“实际向权利人、合作方、代理方产生应付并完成支付”明确区分，同时保证最终财务事实只能由 Financial Authority 确认。

本合同不创建新的 Ledger、Wallet、Commerce、Rights 或 Tax Authority。

## 2. Authority Boundary

| Domain | Authority |
|---|---|
| Rights | Rights Authority |
| Trade Admission | Trade Admission Authority |
| Order / Commerce | Commerce Authority |
| Agreement / E-Sign | Agreement Authority |
| License | License Authority |
| Usage / Compliance | Compliance Authority |
| Settlement Calculation | Settlement / Commerce Authority |
| Payable / Payout Finality | Wallet / Ledger / Payment Authority |
| Tax Fact | Tax / Financial Authority where applicable |
| Evidence | Evidence Registry |

Payout Coordination 只能编排，不得伪造财务最终状态。

## 3. Canonical Payout Record

每个 Payout Flow 至少能够关联：

```text
payoutId
tradeId
settlementId
statementId?
beneficiaryId
beneficiaryType
allocationVersion
currency
amountMinor
payoutMethodRef?
payoutInstructionId?
paymentReference?
ledgerReference?
taxReference?
correlationId
rootOperationId
status
createdAt
updatedAt
```

已经产生的金融引用不得静默替换。

## 4. State Machine

标准状态：

```text
PENDING_SETTLEMENT
SETTLEMENT_ACCEPTED
ALLOCATED
ELIGIBILITY_PENDING
READY_FOR_PAYOUT
PAYOUT_INSTRUCTED
PAYOUT_PROCESSING
PAYOUT_CONFIRMED
PAYOUT_FAILED
ON_HOLD
REVERSED
ADJUSTMENT_REQUIRED
RECONCILIATION_REQUIRED
FINANCIAL_FINAL
CLOSED
```

禁止直接从 `Settlement Accepted` 跳到 `Financial Final`，必须经过正式金融确认。

## 5. Settlement-to-Payout Preconditions

进入 `READY_FOR_PAYOUT` 必须满足：

```text
Settlement Accepted
+ Payable Allocation Valid
+ Beneficiary Valid
+ Required Compliance Checks Passed
+ Required Tax / Withholding Data Available
+ Required Payment Method Valid
```

任何关键条件为 `UNKNOWN` 时，不得默认为 `READY_FOR_PAYOUT`。

## 6. Allocation Model

一次 Settlement 可以产生多个经济受益方：

```text
Gross Settlement
 ├─ Rights Holder
 ├─ Co-right Holder
 ├─ Licensor / Agent
 ├─ Creator / Partner
 ├─ Platform Fee
 ├─ Agency / Channel Commission
 ├─ Service Fee
 ├─ Tax / Withholding
 └─ Adjustment / Reserve
```

所有 Allocation 必须具有：

```text
allocationId
allocationVersion
beneficiaryId
ruleId / basis
amountMinor
currency
reason
sourceReference
```

## 7. Allocation Invariants

必须满足：

```text
sum(allocations)
+ explicit retained / reserve amounts
= settlement payable base
```

禁止因四舍五入、重复任务或重试产生无法解释的金额漂移。

金额统一使用整数 `minor units`。

## 8. Beneficiary Validation

进入 payout 前必须验证：

```text
Beneficiary Identity
Eligibility
Payment Capability
Required Tax Information
Required Compliance State
```

Beneficiary 状态变化必须能够触发受影响 Payout Hold / Recheck。

## 9. Payout Instruction

Payout Instruction 必须是不可变业务快照，至少包含：

```text
beneficiary snapshot
amountMinor
currency
payout method reference
allocation version
settlement reference
approval reference
idempotency key
```

历史 Payout Instruction 不因当前收款资料变化而被重写。

## 10. Idempotency

相同：

```text
tradeId
+ settlementId
+ beneficiaryId
+ allocationVersion
+ payoutInstructionId
```

不得产生重复经济支付。

支付系统返回重复结果时必须能够安全归并到同一金融操作。

## 11. Payout Execution

执行链：

```text
Payout Instruction
→ Payment Attempt
→ Provider / Financial Authority
→ Payment Result
→ Confirmation / Failure
```

Payout Coordinator 不得仅凭发送请求成功，就把状态设为 `PAYOUT_CONFIRMED`。

## 12. Failure Handling

失败至少区分：

```text
VALIDATION_FAILURE
PAYMENT_PROVIDER_FAILURE
TEMPORARY_FAILURE
BENEFICIARY_BLOCK
COMPLIANCE_HOLD
DUPLICATE_REQUEST
UNKNOWN_RESULT
```

`UNKNOWN_RESULT` 必须进入查询 / 对账流程，不得直接重试产生潜在双付。

## 13. Hold / Release

以下情况可以触发 `ON_HOLD`：

```text
Beneficiary Change
Tax Missing
Compliance Review
Fraud / Risk Review
Material Settlement Variance
Payment Unknown
Legal / Rights Dispute
```

解除 Hold 必须保存：

```text
actor
reason
evidence
previousState
newState
time
```

## 14. Reversal

已经确认的 Payout 不允许直接删除。

必须通过：

```text
Reversal
or
Adjustment
```

表达。

每次 Reversal 都必须关联原始 Payout 与原因。

## 15. Reconciliation

至少执行三层对账：

```text
Settlement ↔ Allocation
Allocation ↔ Payout Instruction
Payout Confirmation ↔ Ledger / Financial Authority
```

出现差异进入：

```text
MATCHED
VARIANCE
REVIEW
BLOCKED
```

重大差异禁止自动进入 `FINANCIAL_FINAL`。

## 16. Financial Finality

只有正式 Financial Authority 返回有效确认后，才允许：

```text
PAYOUT_CONFIRMED
→ FINANCIAL_FINAL
```

以下任何状态都不能等同 Financial Final：

```text
Settlement Accepted
Payout Instructed
Payment Requested
Payment Processing
Provider Accepted
```

## 17. Historical Immutability

以下均保留不可变历史快照：

```text
Settlement Snapshot
Allocation Version
Beneficiary Snapshot
Payout Instruction
Payment Result
Reversal
Adjustment
Reconciliation Result
Financial Confirmation
```

新事实通过新版本、Adjustment 或 Reversal 表达。

## 18. Event Semantics

关键事件至少包含：

```text
eventId
tradeId
payoutId
aggregateId
aggregateVersion
causationId
correlationId
occurredAt
```

事件不得承担新的财务权威。

## 19. Evidence Chain

完整 Payout Evidence：

```text
Settlement Evidence
↓
Allocation Evidence
↓
Beneficiary Verification
↓
Payout Approval
↓
Payout Instruction
↓
Payment Attempt
↓
Provider Confirmation
↓
Reconciliation
↓
Ledger / Financial Finality Evidence
```

人工调整、Hold、Reversal、Override 都必须进入 Evidence Registry。

## 20. Audit

每个 payout lifecycle 至少能够回答：

```text
Who received?
Why this amount?
Which settlement?
Which allocation version?
Which beneficiary snapshot?
Which payout instruction?
Which payment reference?
Who approved?
What failed / changed?
Which authority confirmed finality?
```

## 21. Machine Invariants

### I1
`FINANCIAL_FINAL ⇒ authoritative financial confirmation exists`。

### I2
`PAYOUT_CONFIRMED ≠ automatically FINANCIAL_FINAL`。

### I3
`Settlement Accepted ⇒ payout not yet implied`。

### I4
`UNKNOWN payment result ⇒ no blind retry`。

### I5
同一 payout instruction 不能产生重复经济支付。

### I6
Allocation total 必须能够重建 settlement payable base。

### I7
Beneficiary Snapshot 必须属于对应 payout instruction 版本。

### I8
历史 payout instruction 不随当前 beneficiary profile 改写。

### I9
Reversal 必须引用原始 payout。

### I10
Material variance 不得静默进入 Financial Finality。

### I11
Manual override 必须具备 actor + reason + evidence。

### I12
Tax / withholding 未满足必要条件时不得自动放款。

### I13
Final payout 结果必须能够追溯 settlement、trade 与 license lifecycle。

### I14
Financial Finality 不得由 IP Trading Coordinator 自行声明。

### I15
所有金额使用整数 minor units 并固定 currency。

## 22. L5 Execution Units

```text
L5-IP-220-SETTLEMENT-ACCEPTANCE
L5-IP-220-PAYABLE-ALLOCATION
L5-IP-220-BENEFICIARY-VALIDATION
L5-IP-220-TAX-CHECK
L5-IP-220-PAYOUT-READINESS
L5-IP-220-PAYOUT-INSTRUCTION
L5-IP-220-IDEMPOTENCY
L5-IP-220-PAYOUT-EXECUTION
L5-IP-220-UNKNOWN-RESULT-HANDLING
L5-IP-220-HOLD-RELEASE
L5-IP-220-REVERSAL
L5-IP-220-ADJUSTMENT
L5-IP-220-RECONCILIATION
L5-IP-220-FINANCIAL-FINALITY
L5-IP-220-EVIDENCE
L5-IP-220-AUDIT
```

## 23. L6 Acceptance Atoms

### L6-IP-220-001
Settlement reference is present before payout readiness.

### L6-IP-220-002
Allocation version is immutable once used by a payout instruction.

### L6-IP-220-003
Every beneficiary allocation has an explainable basis.

### L6-IP-220-004
Allocation totals can reconstruct the settlement payable base.

### L6-IP-220-005
Unknown beneficiary eligibility blocks automatic payout.

### L6-IP-220-006
Required tax data is available before payout execution.

### L6-IP-220-007
Payout instruction contains immutable amount and currency snapshots.

### L6-IP-220-008
Payout idempotency prevents duplicate economic payment.

### L6-IP-220-009
Provider request success is not equivalent to payout confirmation.

### L6-IP-220-010
Unknown payment result enters reconciliation/query flow.

### L6-IP-220-011
Hold reasons and release evidence are auditable.

### L6-IP-220-012
Reversal references the original payout.

### L6-IP-220-013
Reconciliation can compare settlement, allocation and payout.

### L6-IP-220-014
Material variance blocks financial finality.

### L6-IP-220-015
Financial finality requires authoritative confirmation.

### L6-IP-220-016
Historical payout facts remain reconstructable after profile changes.

### L6-IP-220-017
Manual overrides are attributable and evidenced.

### L6-IP-220-018
Payout events carry trade and correlation identity.

### L6-IP-220-019
Payout status transitions obey the declared state machine.

### L6-IP-220-020
Payout cannot exceed the authoritative payable amount.

## 24. Non-Goals

本合同不负责：

```text
Banking Core
Payment Network
Accounting Ledger Implementation
Tax Law Engine
Rights Determination
Commerce Order Authority
```

这些能力仍由各自 Authority 提供。

## 25. Implementation Gate

在以下条件全部满足前，不允许实现本合同代码：

```text
L4 Contract = COMPLETE
L5 Units = REGISTERED
L6 Units = REGISTERED
Authority Boundary = COMPLETE
Evidence Mapping = COMPLETE
Cross-Contract Traceability = COMPLETE
Machine Invariants = COMPLETE
```

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
