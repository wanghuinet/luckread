# LuckRead IP Trade Cross-Contract Master Traceability and Admission Gate v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同是 200–217 IP Trading Center 合同/实例注册表的上层 Traceability Gate。

目标不是增加新的业务能力，而是定义：

```text
Any IP Trade Capability
        ↓
Canonical Identity
        ↓
Version Lineage
        ↓
Authority Lineage
        ↓
Scope Lineage
        ↓
Lifecycle Lineage
        ↓
Evidence Lineage
        ↓
Reconciliation
        ↓
Admission Gate
```

本合同不得成为任何业务域的新 Authority。

## 2. Authority Boundary

权威保持不变：

| Domain | Authority |
|---|---|
| Rights | Rights Authority |
| Buyer Identity / Eligibility | Buyer Authority |
| Risk | Risk / Trust Authority |
| Trade Admission | Trade Admission Contract |
| Order / Commerce | Commerce Authority |
| Agreement / Signature | Agreement / E-Sign Authority |
| License | License Authority |
| Usage / Compliance | Compliance Authority |
| Settlement | Settlement Calculation + Commerce Authority |
| Financial Finality | Ledger / Wallet Authority |
| Evidence | Evidence Registry |

Traceability Gate 只负责验证跨域事实是否可关联、可重建、可解释。

## 3. Canonical Trade Record

任何标准 IP Trade 生命周期至少能够建立：

```text
tradeId
correlationId
rootOperationId
licensorId
buyerId
ipId
rightsProfileId
skuId
intentId
admissionDecisionId
orderId
agreementId
licenseId
authorizationId
settlementId?
caseId?
```

尚未发生的阶段可以为空，但已经产生的标识不能被静默替换。

## 4. Master Traceability Chain

完整交易必须能够证明：

```text
Licensor
→ Rights Provenance
→ Sellable Scope
→ SKU
→ Buyer Intent
→ Admission
→ Order
→ Agreement
→ Payment Reference
→ License
→ Authorization Certificate
→ Usage
→ Compliance
→ Settlement
→ Resolution / Adjustment
→ Evidence
```

缺失关键链路不得进入 `ACCEPTED`。

## 5. Version Lineage Gate

以下版本必须可重建：

```text
Intent Version
SKU Version
Pricing Version
Rights Version
Risk Version
Admission Version
Order Snapshot Version
Agreement Version
License Version
Rule Version
Usage Report Version
Settlement Calculation Version
```

### Gate

```text
Every derived decision
→ records source versions
```

禁止使用当前版本覆盖历史事实。

## 6. Authority Lineage Gate

任一结论必须能够回答：

```text
Who owns this fact?
Which authority produced it?
When was it valid?
Which version produced it?
Which evidence supports it?
```

以下语义永久禁止混淆：

```text
Recommendation ≠ Authorization
Evidence ≠ Authority
Snapshot ≠ Current Truth
Statement ≠ Ledger Fact
Payment Reference ≠ Ledger Finality
Compliance Result ≠ License Grant
```

## 7. Scope Monotonicity Gate

授权范围必须满足：

```text
Rights Scope
⊇ Sellable Scope
⊇ SKU Scope
⊇ Admission Scope
⊇ Order Scope
⊇ Agreement Scope
⊇ License Scope
⊇ Usage Scope
```

任何扩大必须重新产生正式 Rights / Admission / Agreement / License 事实。

## 8. Party Continuity Gate

关键主体必须可验证：

```text
Licensor
Buyer
Order Party
Agreement Party
License Party
Certificate Party
Settlement Party
```

主体变化必须有明确关系：

```text
Agency
Organization Representation
Joint Authorization
Assignment
Novation
```

否则进入 `REVIEW` 或 `BLOCKED`。

## 9. Trade Admission Gate

标准交易必须满足：

```text
Identity = VALID
Rights = VALID
Buyer = VALID
SKU = VALID
Risk = ALLOWABLE
Scope = CONSISTENT
Pricing = CONSISTENT
Procurement = READY
Agreement = READY
Evidence = SUFFICIENT
```

任何关键项为 `UNKNOWN` 不得自动 `ALLOW`。

优先级：

```text
BLOCKED > REVIEW > CONDITIONAL > ALLOW
```

## 10. Lifecycle State Gate

标准生命周期：

```text
DISCOVERED
→ QUOTED
→ ADMITTED
→ ORDERED
→ AGREED
→ SIGNED
→ PAID / CONDITIONS_MET
→ LICENSE_ACTIVE
→ USED
→ COMPLIANT
→ SETTLEMENT_READY
→ SETTLED
→ CLOSED
```

不允许出现非法跳跃，例如：

```text
DISCOVERED → SETTLED
ORDERED → LICENSE_ACTIVE
SIGNED → SETTLED
```

除非中间正式事实已经存在并可追溯。

## 11. Cross-Contract Invariant Gate

必须永久满足：

### G-01
`Order` 必须有有效 Admission。

### G-02
`Agreement` Scope 不得大于 Order Scope。

### G-03
`License` Scope 不得大于 Rights Scope 与购买 Scope。

### G-04
`Authorization Certificate` 必须绑定 Active License。

### G-05
`Usage` 不得成为授权来源。

### G-06
`Settlement` 不得创造交易权利。

### G-07
`Refund / Chargeback` 必须触发受影响 License / Settlement 检查。

### G-08
`Revoked Rights` 必须能够影响后续交易与生命周期处理。

### G-09
历史 Agreement / License / Settlement Calculation 不得原地改写。

### G-10
任何人工 Override 必须具有 actor、reason、timestamp、evidence。

## 12. Evidence Gate

Evidence DAG 必须支持：

```text
Identity Evidence
→ Rights Evidence
→ Buyer Evidence
→ Admission Evidence
→ Order Evidence
→ Agreement / Signature Evidence
→ Payment Reference Evidence
→ License Evidence
→ Usage Evidence
→ Compliance Evidence
→ Settlement Evidence
→ Dispute / Resolution Evidence
```

Evidence Registry 为空时，不得因业务对象状态字段而自动判定完整链路通过。

## 13. Reconciliation Gate

统一校验：

```text
Identity
× Party
× Rights
× Scope
× SKU
× Admission
× Order
× Agreement
× Payment
× License
× Usage
× Compliance
× Settlement
× Evidence
```

结果仅允许：

```text
MATCHED
VARIANCE
REVIEW
BLOCKED
```

### Rule

`VARIANCE` 不得被静默压成 `MATCHED`。

## 14. Material Change Gate

以下变化必须重新计算受影响链路：

```text
Buyer Identity
Licensor Authority
Rights Scope
Territory
Term
Channel
Media
Exclusivity
Price
Risk
Agreement Terms
License State
Settlement Rule
```

重新检查范围遵循最小影响原则，而不是无条件重跑整个交易。

## 15. Failure Safety Gate

任一跨域操作失败：

```text
NO FALSE SUCCESS
```

禁止形成：

```text
Order = COMPLETED
License = MISSING
Settlement = SETTLED
```

推荐恢复路径：

```text
Retry
→ Reconcile
→ Recheck
→ Compensate / Manual Recovery
→ Record Evidence
```

## 16. Historical Reconstruction Gate

任意历史交易必须能够在不依赖当前数据覆盖历史的情况下重建：

```text
Identity
→ Input Versions
→ Decision
→ Scope
→ Agreement
→ License
→ Usage
→ Settlement
→ Evidence
```

目标不是保存所有运行时状态，而是保存所有决定性事实及其版本。

## 17. Event Correlation Gate

关键事件至少携带：

```text
eventId
aggregateId
aggregateVersion
sequence
occurredAt
causationId
correlationId
tradeId
```

允许从事件流重建交易生命周期。

## 18. Acceptance State Machine

```text
INVENTORIED
  ↓
TRACEABLE
  ↓
RECONCILED
  ↓
EVIDENCE-SUFFICIENT
  ↓
ADMISSION-READY
  ↓
IMPLEMENTATION-READY
  ↓
IMPLEMENTED
  ↓
VERIFIED
  ↓
ACCEPTED
```

任一步骤失败必须退回对应状态，不得跳过中间状态。

## 19. Machine Admission Rules

实现层最终必须能够机械执行：

```text
IF canonical_identity_missing
  → BLOCKED

IF authority_missing
  → REVIEW / BLOCKED

IF evidence_missing_for_required_claim
  → BLOCKED

IF scope_expanded_without_reauthorization
  → BLOCKED

IF historical_snapshot_mutated
  → BLOCKED

IF material_drift_detected
  → RECHECK

IF reconciliation_variance_material
  → REVIEW / BLOCKED

IF all_required_gates_pass
  → ADMISSION_READY
```

## 20. L5/L6 Admission Requirement

每个实现范围 L4 必须绑定：

```text
L4
→ L5 Execution Unit
→ L6 Verification Atomic Units
→ Evidence
→ Acceptance Result
```

没有 L6 就没有最终 Accepted。

## 21. Scope of 200–217

本合同将以下链路统一纳入主 Traceability Gate：

```text
200 License / Transaction / E-Sign
201 IP Trading Center Master
202 Catalog / Pricing / Deal Desk / Vault
203 SKU / Industry / Pricing Matrix
204 Licensor Rights Provenance
205 Licensor L5/L6
206 Buyer Admission
207 Buyer L5/L6
208 Unified Trade Admission
209 Trade Execution
210 Trade Execution L5/L6
211 License Lifecycle
212 License Lifecycle L5/L6
213 Usage / Compliance / Dispute
214 Commercial Settlement
215/216 Settlement Instance Registry
217 Cross-Contract Reconciliation / Evidence
```

这些合同共同构成 IP Trading 的当前实现前置基线。

## 22. Non-Goals

本合同不得新增：

```text
New Payment Authority
New Ledger
New Rights Authority
New User Authority
New Recommendation Authority
New Commerce Authority
New CMS Core
```

也不得复制 Payload Core 内部实现。

## 23. Implementation Rule

在以下条件全部满足前，不允许进入正式业务代码开发：

```text
L4 Coverage = COMPLETE
L5 Coverage = COMPLETE
L6 Coverage = COMPLETE
Cross-Contract Traceability = COMPLETE
Authority Boundary = COMPLETE
Evidence Mapping = COMPLETE
Machine Admission Rules = DEFINED
```

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```

## 24. Final Contract Statement

LuckRead IP Trading Center 的世界级可信交易能力，不以“功能数量”定义，而以：

```text
Every Trade
→ One Identity
→ One Authority Chain
→ Versioned Scope
→ Explicit Admission
→ Immutable History
→ Observable Events
→ Verifiable Evidence
→ Reconciled Financial Outcome
```

作为工程准入底线。

任何无法证明完整链路、权威来源、版本关系、范围关系和证据来源的交易，不得被系统声明为最终可信状态。
