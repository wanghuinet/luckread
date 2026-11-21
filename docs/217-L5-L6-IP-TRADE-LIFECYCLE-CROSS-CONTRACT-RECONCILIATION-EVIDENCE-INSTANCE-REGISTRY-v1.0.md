# LuckRead L5-L6 IP Trade Lifecycle Cross-Contract Reconciliation / Evidence Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 IP Trading Center 205–216 的跨合同主链实例化为统一的 L5 Execution Units 与 L6 Verification Atomic Units，重点验证：

```text
Licensor
× Buyer
× IP
× Rights
× SKU
× Intent
× Admission
× Order
× Agreement
× Payment
× License
× Usage
× Compliance
× Settlement
→ Consistent Trade Lifecycle
```

本文件不创建新的业务权威，不改变既有 Rights / Buyer / Risk / Commerce / Agreement / License / Ledger / Evidence 边界，也不授权代码实现。

## 2. Canonical Trade Identity

统一交易链必须能够关联：

```text
tradeId
licensorId
buyerId
ipId
rightsProfileId
skuId
intentId
admissionDecisionId
orderId
dealId?
quoteId?
agreementId
licenseId
authorizationId
settlementId?
caseId?
correlationId
```

不同阶段可以缺少尚未产生的实体，但已经产生的标识不得漂移。

## 3. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Canonical Trade Identity | L5-IP-217-IDENTITY | 001-003 | PENDING |
| Version Lineage | L5-IP-217-VERSION | 004-006 | PENDING |
| Scope Lineage | L5-IP-217-SCOPE | 007-009 | PENDING |
| Party Consistency | L5-IP-217-PARTY | 010-012 | PENDING |
| Rights Consistency | L5-IP-217-RIGHTS | 013-016 | PENDING |
| SKU Consistency | L5-IP-217-SKU | 017-019 | PENDING |
| Admission Consistency | L5-IP-217-ADMISSION | 020-022 | PENDING |
| Order Consistency | L5-IP-217-ORDER | 023-025 | PENDING |
| Agreement Consistency | L5-IP-217-AGREEMENT | 026-028 | PENDING |
| Payment Consistency | L5-IP-217-PAYMENT | 029-031 | PENDING |
| License Consistency | L5-IP-217-LICENSE | 032-034 | PENDING |
| Certificate Consistency | L5-IP-217-CERTIFICATE | 035-037 | PENDING |
| Usage Consistency | L5-IP-217-USAGE | 038-040 | PENDING |
| Compliance Consistency | L5-IP-217-COMPLIANCE | 041-043 | PENDING |
| Settlement Consistency | L5-IP-217-SETTLEMENT | 044-046 | PENDING |
| Event Correlation | L5-IP-217-EVENT | 047-049 | PENDING |
| Evidence Chain | L5-IP-217-EVIDENCE | 050-052 | PENDING |
| Reconciliation | L5-IP-217-RECON | 053-056 | PENDING |
| Drift Detection | L5-IP-217-DRIFT | 057-060 | PENDING |
| Material Change Recheck | L5-IP-217-RECHECK | 061-063 | PENDING |
| Failure / Unknown Safety | L5-IP-217-SAFETY | 064-066 | PENDING |
| Historical Immutability | L5-IP-217-HISTORY | 067-069 | PENDING |
| Audit / Observability | L5-IP-217-AUDIT | 070-072 | PENDING |

## 4. Canonical Identity Rules

同一交易生命周期中，核心主体引用必须稳定：

```text
tradeId
→ all lifecycle references
```

禁止同一事实交易在不同模块产生无法关联的多个 Trade Identity。

## 5. Version Lineage

必须保存版本链：

```text
Intent Version
→ Admission Version
→ SKU Version
→ Price Version
→ Agreement Version
→ License Version
→ Report Version
→ Settlement Calculation Version
```

每一次跨域转换都必须能定位输入版本与输出版本。

## 6. Scope Lineage

授权范围必须保持：

```text
Rights Scope
⊇
Sellable Scope
⊇
SKU Scope
⊇
Admission Scope
⊇
Order Scope
⊇
Agreement Scope
⊇
License Scope
```

任何向外扩大的 Scope 都必须经过新的正式权利与交易准入流程。

## 7. Party Consistency

必须验证：

```text
Buyer
Licensor
Agreement Parties
Order Parties
License Parties
Certificate Parties
```

除非存在合法的代理、联合授权或组织代表关系，否则不得自动视为同一主体。

## 8. Rights Consistency

当前 Rights Authority 状态必须能够支撑：

```text
Sellable SKU
Admission
Agreement
License
Renewal
Expansion
```

Rights 变化必须触发受影响生命周期重新检查。

## 9. SKU Consistency

订单使用的 SKU 必须引用：

```text
skuId
skuVersion
pricingVersion
scopeSnapshot
contractTemplateVersion
```

历史订单不能因当前 SKU 更新而被重写。

## 10. Admission Consistency

Order 必须能够追溯至：

```text
Admission Decision
Admission Version
Buyer
Intent
SKU
Rights
Risk
```

不存在有效准入引用时，不得把订单标记为标准成交。

## 11. Order Consistency

订单必须保存：

```text
scopeSnapshot
priceVersion
amountMinor
currency
admissionDecisionVersion
```

金额与 Scope 必须与准入和 SKU 一致。

## 12. Agreement Consistency

Agreement Snapshot 必须与：

```text
Order
Deal
Scope
Price
Parties
Approvals
```

一致。

签署前发生物质变化必须产生新版本。

## 13. Payment Consistency

Payment 只能作为 Commerce Authority 提供的正式引用：

```text
orderId
paymentReference
paymentStatus
paidAt
refundReference
chargebackReference
```

Trading 不得伪造 Payment Finality。

## 14. License Consistency

License 必须能够回溯：

```text
Order
Agreement
Authorized Scope
Rights State
Activation Conditions
```

License Scope 不得超出合法授权和已购买范围。

## 15. Certificate Consistency

Authorization Certificate 必须绑定：

```text
authorizationId
authorizationNumber
licenseId
agreementId
documentHash
scope
term
territory
```

不存在 Active License 时不得产生新的有效授权书。

## 16. Usage Consistency

实际使用必须满足：

```text
Usage Event
⊆ Current License Scope
```

Usage Evidence 不得成为新的授权来源。

## 17. Compliance Consistency

Compliance 判断必须引用：

```text
License Version
Scope Version
Rule Version
Evidence Refs
```

规则变化能够定位受影响交易。

## 18. Settlement Consistency

Settlement Calculation 必须引用：

```text
Order
Payment
Usage / Report
Agreement
License
Pricing
Royalty Rule
Commission Rule
```

历史计算不得被新规则覆盖。

## 19. Event Correlation

所有关键事件必须带：

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

能够从任一阶段追踪到完整交易。

## 20. Evidence Chain

完整 Evidence DAG：

```text
Licensor Evidence
      ↓
Rights Provenance
      ↓
SKU / Scope Evidence
      ↓
Buyer Evidence
      ↓
Admission Evidence
      ↓
Order Evidence
      ↓
Agreement / Signature Evidence
      ↓
Payment Reference
      ↓
License Evidence
      ↓
Authorization Certificate
      ↓
Usage / Compliance Evidence
      ↓
Settlement Evidence
      ↓
Dispute / Resolution Evidence
```

关键节点必须引用 Evidence Registry。

## 21. Reconciliation

统一 Reconciliation 执行：

```text
Identity
× Versions
× Parties
× Scope
× Rights
× Admission
× Order
× Agreement
× Payment
× License
× Usage
× Compliance
× Settlement
→
MATCHED / VARIANCE / REVIEW / BLOCKED
```

任何重大不一致不得静默归入 MATCHED。

## 22. Drift Detection

至少检测：

```text
Party Drift
Rights Drift
Scope Drift
Price Drift
Policy Drift
Version Drift
License Drift
Settlement Drift
```

发现 Material Drift 必须进入 Recheck。

## 23. Material Change

以下变化视为 Material Change：

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
Agreement Terms
Risk State
License State
```

Material Change 必须重新评估受影响生命周期阶段。

## 24. Recheck Strategy

根据交易阶段执行最小必要重查：

```text
Quote → Quote Recheck
Order → Order Recheck
Pre-sign → Agreement Recheck
Pre-activation → License Recheck
Active Usage → Usage / Compliance Recheck
Settlement → Settlement Recheck
```

不得用一次历史检查永久覆盖整个生命周期。

## 25. Unknown Safety

跨域 Authority 无法确认时：

```text
UNKNOWN
≠
PASS
≠
ALLOW
≠
ACTIVE
≠
SETTLED
```

具体阶段进入 `REVIEW` 或 `BLOCKED`。

## 26. Historical Immutability

以下均为不可变历史快照：

```text
Intent Version
Admission Decision
Quote
Order
Agreement Snapshot
Signature Evidence
License Version
Certificate
Usage Report
Settlement Calculation
Settlement Statement
Case Resolution
```

更正通过新版本或 Adjustment 表达。

## 27. Cross-Contract Failure Handling

任一跨域动作失败必须支持：

```text
Retry
Compensation
Recheck
Manual Recovery
Evidence Recording
```

禁止出现：

```text
Order = Completed
License = Missing
Settlement = Settled
```

这种部分成功假完成状态。

## 28. Recovery Consistency

恢复时必须依据正式 Authority 重新读取：

```text
Rights
Risk
Commerce
Agreement
License
Ledger
```

不能仅依赖内存状态或旧缓存。

## 29. Cache Boundary

允许缓存：

```text
Display Data
Search Candidates
Non-authoritative Metadata
```

禁止缓存绕过当前：

```text
Rights
Risk
Eligibility
Conflict
License
Settlement Finality
```

## 30. Observability

每笔交易至少具备：

```text
tradeId
correlationId
rootOperationId
```

关键阶段可测量：

```text
latency
retryCount
failureRate
reviewRate
blockRate
reconciliationVariance
```

## 31. Audit

完整链路必须支持：

```text
Who
What
When
Before
After
Why
Authority
Evidence
Version
```

人工 Override 必须可定位。

## 32. L6 Atomic Verification Units

### L6-IP-217-001
同一交易生命周期使用稳定 tradeId。

### L6-IP-217-002
不同模块产生的核心标识可以关联至同一交易。

### L6-IP-217-003
无法关联的活动事实必须进入异常处理。

### L6-IP-217-004
Intent Version 能定位 Admission 输入版本。

### L6-IP-217-005
Order 能定位 Admission Version 与 SKU Version。

### L6-IP-217-006
Settlement 能定位 License / Agreement / Rule Versions。

### L6-IP-217-007
Rights Scope 是 Sellable Scope 的上限。

### L6-IP-217-008
Order Scope 不得超过 Admission Scope。

### L6-IP-217-009
License Scope 不得超过合法 Rights Scope 与购买 Scope。

### L6-IP-217-010
Buyer / Licensor 在各关键阶段保持主体一致性或具有合法关系引用。

### L6-IP-217-011
Agreement Parties 能与 Order Parties 对齐。

### L6-IP-217-012
Certificate Parties 能与 Active License 对齐。

### L6-IP-217-013
SKU 权利范围具有当前 Rights 支撑。

### L6-IP-217-014
Rights Material Change 可定位受影响交易。

### L6-IP-217-015
Rights Drift 会触发 Recheck。

### L6-IP-217-016
无当前 Rights 支撑不能继续标准交易。

### L6-IP-217-017
历史 Order 使用固定 SKU Version。

### L6-IP-217-018
历史 Order 不因新 SKU 发布而改变。

### L6-IP-217-019
Price Version 与 Order Amount 可以被重建。

### L6-IP-217-020
Admission Decision 能回溯 Buyer、Intent、SKU、Rights、Risk。

### L6-IP-217-021
无有效 Admission 时 Standard Order 被阻止。

### L6-IP-217-022
Admission Version 变化能够触发相关交易 Recheck。

### L6-IP-217-023
Order Snapshot 与 Admission Snapshot 可以比较。

### L6-IP-217-024
Order 金额使用整数 minor units。

### L6-IP-217-025
Order Scope Snapshot 不被实时商品数据覆盖。

### L6-IP-217-026
Agreement Snapshot 与 Order Scope 可比对。

### L6-IP-217-027
Agreement Price 与 Order Price 可比对。

### L6-IP-217-028
Agreement 重大变更会产生新版本。

### L6-IP-217-029
Payment Finality 来自 Commerce Authority。

### L6-IP-217-030
未知 Payment 状态不会被映射为已支付。

### L6-IP-217-031
Refund / Chargeback 能定位受影响交易。

### L6-IP-217-032
License 可以回溯 Order / Agreement / Rights。

### L6-IP-217-033
License Scope 不超过合法授权范围。

### L6-IP-217-034
License Version 变化可以被定位。

### L6-IP-217-035
Certificate 绑定唯一 License。

### L6-IP-217-036
无 Active License 不产生新的有效 Certificate。

### L6-IP-217-037
Certificate Document Hash 可验证。

### L6-IP-217-038
Usage Event 可以映射 Current License Scope。

### L6-IP-217-039
超范围 Usage 能被分类发现。

### L6-IP-217-040
Usage Evidence 不扩大授权。

### L6-IP-217-041
Compliance Decision 引用 Rule Version。

### L6-IP-217-042
Compliance Decision 引用 Scope / License Version。

### L6-IP-217-043
Compliance Evidence 可以关联到 Case / Trade。

### L6-IP-217-044
Settlement 计算能够追踪 Order、Payment、Usage 与 License。

### L6-IP-217-045
Settlement 不依赖被覆盖的历史版本。

### L6-IP-217-046
Settlement 与 License Scope 可以执行一致性检查。

### L6-IP-217-047
关键事件携带 tradeId / correlationId。

### L6-IP-217-048
事件 sequence / aggregateVersion 可用于检测乱序或重复。

### L6-IP-217-049
跨异步步骤保持 correlation lineage。

### L6-IP-217-050
Licensor Evidence 可以关联至 Rights Provenance。

### L6-IP-217-051
Admission / Order / Agreement / License / Settlement 均可关联 Evidence。

### L6-IP-217-052
Evidence Chain 能重建关键交易上下文。

### L6-IP-217-053
Reconciliation 可以比较全部关键阶段。

### L6-IP-217-054
重大 Variance 不得自动 MATCHED。

### L6-IP-217-055
Reconciliation 结果支持 REVIEW。

### L6-IP-217-056
Reconciliation BLOCKED 条件可解释。

### L6-IP-217-057
Party Drift 可以被识别。

### L6-IP-217-058
Scope / Rights / Price Drift 可以被识别。

### L6-IP-217-059
Version Drift 可以被识别。

### L6-IP-217-060
Material Drift 触发 Recheck。

### L6-IP-217-061
Quote 阶段可以执行最小必要 Recheck。

### L6-IP-217-062
Pre-activation 阶段可以执行 License Recheck。

### L6-IP-217-063
Settlement 阶段可以执行 Settlement Recheck。

### L6-IP-217-064
Authority UNKNOWN 不得产生 Pass。

### L6-IP-217-065
Authority UNKNOWN 不得产生 Active License。

### L6-IP-217-066
Authority UNKNOWN 不得产生 Settled Finality。

### L6-IP-217-067
历史 Intent / Admission / Quote / Order 快照保持不可变。

### L6-IP-217-068
历史 Agreement / License / Certificate 快照保持不可变。

### L6-IP-217-069
历史 Report / Settlement / Case Resolution 保持不可变。

### L6-IP-217-070
跨域错误具备统一 correlation identity。

### L6-IP-217-071
Recovery 可以重新读取正式 Authority 状态。

### L6-IP-217-072
人工 Override 能够记录 actor / reason / evidence / version。

## 33. Global Invariants

```text
I1: One Trade Lifecycle ⇒ Stable Canonical Identity
I2: Rights Scope is the upper authorization bound
I3: Every downstream Scope is traceable to an upstream Scope Snapshot
I4: Historical Versions are immutable
I5: UNKNOWN Authority Result ≠ PASS / ALLOW / ACTIVE / SETTLED
I6: Material Drift ⇒ Recheck
I7: Certificate ⇒ Active License
I8: Usage ⇒ Current License Scope
I9: Settlement ⇒ Reconstructable version chain
I10: Major Reconciliation Variance ≠ MATCHED
I11: Cross-domain failure ≠ Completed Transaction
I12: Manual Override ⇒ Actor + Reason + Evidence
I13: Event lineage is correlation-preserving
I14: Evidence chain can reconstruct critical trade context
I15: No downstream domain may silently become a new authority
```

## 34. Cross-Contract Dependency Chain

```text
205 Licensor / Rights Verification
        ↓
207 Buyer Admission
        ↓
203 SKU / Pricing / Deal Desk
        ↓
208 Unified Trade Admission
        ↓
209 Trade Execution
        ↓
210 Trade Execution Instances
        ↓
200 Transaction / E-Sign / Authorization
        ↓
211 License Lifecycle
        ↓
212 Lifecycle Instances
        ↓
213 Usage / Compliance / Dispute
        ↓
214 Commercial Settlement
        ↓
216 Settlement Instances
        ↓
217 Cross-Contract Reconciliation / Evidence
        ↓
176 Evidence Registry
```

## 35. Acceptance Gates

```text
[ ] Canonical Trade Identity defined
[ ] Version lineage defined
[ ] Scope lineage defined
[ ] Party consistency defined
[ ] Rights consistency defined
[ ] SKU consistency defined
[ ] Admission consistency defined
[ ] Order consistency defined
[ ] Agreement consistency defined
[ ] Payment consistency defined
[ ] License consistency defined
[ ] Certificate consistency defined
[ ] Usage consistency defined
[ ] Compliance consistency defined
[ ] Settlement consistency defined
[ ] Event correlation defined
[ ] Evidence chain defined
[ ] Reconciliation defined
[ ] Drift detection defined
[ ] Material change recheck defined
[ ] Unknown-safe semantics defined
[ ] Historical immutability defined
[ ] Recovery defined
[ ] Audit / observability defined
[ ] Machine invariants defined
```

## 36. Implementation Boundary

本注册表不授权代码实现。

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
