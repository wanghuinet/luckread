# LuckRead IP Center Structural Defect Repair and Semantic Lock Contract v1.0

**状态：STRUCTURAL-REPAIR-COMPLETE / SEMANTIC-LOCKED / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同修复 IP Center 在 Unified CL 前发现的六项结构性缺陷。

本文件不是新的业务域，也不新增新的 IP 产品能力；它对 201–233 已有定义进行语义收口、优先级固定和冲突消解。

当旧文档局部表述与本合同冲突时，本合同作为 IP Center 结构语义修复层，以最新版本为准。

## 2. Six Structural Repairs

```text
P0-01 Authority Uniqueness
P0-02 License Orthogonal State Model
P0-03 Admission Snapshot → Execution Binding
P1-04 Unified Cross-Domain Impact Propagation
P1-05 Legal Fact ≠ Platform Verification Fact
P1-06 Jurisdiction / Governing-Law Boundary
```

Certificate ≠ License 的边界并入 P0-01 Authority Uniqueness 一并锁定。

## 3. P0-01 Authority Uniqueness

IP Center 最终只允许以下 Canonical Authorities：

```text
IP Identity Authority
Rights Authority
Buyer Eligibility Authority
Risk / Trust Authority
Trade Admission Authority
Commerce Authority
Agreement Authority
License Authority
Compliance Authority
Settlement Authority
Ledger / Financial Finality Authority
Payout Execution Provider
Dispute Case Authority
Evidence Authority
```

严格区分：

```text
Authority
Provider
Adapter
Coordinator
Projection
UI / Display
```

规则：

```text
Provider ≠ Authority
Adapter ≠ Authority
Coordinator ≠ Authority
Projection ≠ Authority
Display ≠ Authority
```

任何非 Authority 组件不得声明最终业务事实。

### Financial Authority

```text
Settlement Authority
= 商业结算计算与结算上下文

Ledger / Financial Finality Authority
= 财务账簿与 Financial Finality

Payment Provider
= 外部支付执行结果来源
```

`FINANCIAL_FINAL` 只能由 Ledger / Financial Finality Authority 的有效确认成立。

### Certificate Boundary

```text
License
= Authoritative authorization fact

Authorization Certificate
= Proof / Verification Projection
```

机器规则：

```text
Certificate cannot create License
Certificate cannot expand Scope
Certificate cannot extend Term
Certificate cannot override Revocation
Certificate status cannot become the License Authority
```

## 4. P0-02 License Orthogonal State Model

License 不再使用单一扁平状态表达全部生命周期事实。

Canonical License Model：

```text
License Identity
+
License Version
+
Lifecycle State
+
Control State
+
Expiry State
+
Effective Scope
```

### Lifecycle State

```text
PENDING
ACTIVE
EXPIRED
TERMINATED
```

### Control State

```text
NORMAL
SUSPENDED
REVOKED
HOLD
```

### Expiry State

```text
NOT_EXPIRING
EXPIRING
EXPIRED
```

### Change / Version

```text
AMENDED
RENEWED
EXPANDED
SUPERSEDED
```

以上 Change semantics 通过新 `licenseVersion` / lifecycle record 表达，不作为与 `ACTIVE` / `EXPIRED` 并列的互斥生命周期状态。

例如允许：

```text
Lifecycle = ACTIVE
Control = SUSPENDED
Expiry = EXPIRING
Version = 7
```

禁止以模糊字符串覆盖上述正交事实。

历史 License Version 必须不可变。

## 5. P0-03 Admission Snapshot → Execution Binding

Trade Admission `ALLOW` 不自动等于后续交易永远有效。

Admission 必须生成不可变 `Admission Decision Snapshot`。

最小绑定：

```text
admissionDecisionId
decisionVersion
buyerSnapshot
intentSnapshot
skuSnapshot
scopeSnapshot
priceSnapshot
policySnapshots
approvalSnapshot
rightsReference
riskReference
eligibilityReference
validFrom
validUntil
```

### Execution Binding

进入 Order / Agreement / License Execution 前：

```text
Admission Decision
→ Execution Binding Snapshot
```

Snapshot 中已锁定的交易输入不得被静默重写。

### Mandatory Recheck

在执行关键节点必须重新检查仍可能变化的权威事实：

```text
Current Rights Validity
Current Eligibility
Current Risk
Current Conflict
Payment Conditions
Agreement Readiness
```

Material change 时：

```text
Recheck Required
→ New Admission Decision or Explicit Safe Continuation
```

旧 Admission 不得在当前状态失效后继续作为授权依据。

## 6. P1-04 Unified Cross-Domain Impact Propagation

所有重大权利、交易、争议、主体和财务变化必须通过统一 Impact Matrix 定义影响范围。

Canonical dependency graph：

```text
IP
→ Rights
→ Licensor
→ SKU
→ Quote
→ Admission
→ Order
→ Agreement
→ License
→ Usage
→ Compliance
→ Settlement
→ Payout
→ Renewal / Expansion
```

### Mandatory Impact Rules

| Source Change | Minimum Required Impact |
|---|---|
| Rights Revoked | SKU Revalidation + Quote Hold + Admission Recheck + License Impact + Usage Block + Settlement/Payout Review |
| Licensor Suspended | SKU Suspension + Open Quote Review + Trade Review + License Recheck |
| Confirmed Rights Conflict | New Standard Sale Block + Affected SKU Review + Affected License Review |
| Material Dispute | Relevant Order/Agreement/License/Settlement/Payout Hold or Recheck |
| Price Version Changed | New Price Version; active historical transaction snapshot preserved |
| Beneficiary Changed | Pending Payout Hold/Recheck; historical payout snapshot preserved |
| Compliance Block | Usage Block where applicable + Renewal/Expansion Block + downstream review |
| Agreement Termination | License Authority Recheck + Usage Impact + Settlement/Payout Impact |

Impact propagation is coordination semantics, not a replacement for any downstream Authority.

## 7. P1-05 Legal Fact ≠ Platform Verification Fact

IP Center 必须分离：

```text
LEGAL / RIGHTS FACT
PLATFORM VERIFICATION FACT
COMMERCIAL ELIGIBILITY
MARKETPLACE TRUST SIGNAL
```

允许同时存在：

```text
Legal Fact = UNKNOWN
Platform Verification = VERIFIED
Commercial Eligibility = BLOCKED
Trust Signal = LIMITED
```

平台验证不得自动表示：

```text
所有权最终成立
不存在任何第三方主张
法院不会推翻权利
```

### Evidence Semantics

Evidence confidence 只描述证据来源/验证程度，不改变法律权利本身。

```text
SELF_DECLARED
THIRD_PARTY_SUBMITTED
PLATFORM_CHECKED
CONTRACT_VERIFIED
LEGAL_VERIFIED
AUTHORITATIVE_RECORD
```

最终权利事实仍归 Rights Authority。

## 8. P1-06 Jurisdiction / Governing-Law Boundary

国际 IP 交易必须区分：

```text
Buyer Jurisdiction
Licensor Jurisdiction
IP Rights Territory
Usage Territory
Tax Jurisdiction
Contract Governing Law
Dispute Forum
Arbitration Seat
Enforcement Territory
Sanctions / Export Restrictions
```

这些字段不能被 `territory` 单字段代替。

### Canonical Contract Context

复杂交易至少应支持：

```text
governingLawReference
disputeForumReference
arbitrationSeatReference
enforcementTerritoryReference
sanctionsPolicyReference
exportControlReference
localRegulatoryReference
```

IP Center 可以保存结构化引用与交易上下文，但不得自称法律权威或自行作出司法裁判。

## 9. Cross-Contract Precedence Rules

发生局部语义冲突时，按以下优先级解释：

```text
Canonical Authority Fact
>
Immutable Version Snapshot
>
Current Valid Authority Projection
>
Cross-Contract Admission Decision
>
Coordinator State
>
Cache / Derived State
>
UI Display
```

任何较低层不得覆盖较高层事实。

## 10. Machine Invariants

```text
I1: One business fact has exactly one canonical Authority.
I2: Provider success is not equivalent to Authority finality.
I3: Certificate cannot create or expand License authority.
I4: License lifecycle/control/expiry/version are orthogonal facts.
I5: Historical License versions are immutable.
I6: Admission ALLOW requires an exact Decision Snapshot.
I7: Material Authority change requires recheck before affected execution.
I8: Historical execution snapshots cannot be rewritten by current profiles.
I9: Major cross-domain changes must have Impact Matrix handling.
I10: Legal Fact and Platform Verification Fact cannot be silently conflated.
I11: Verification state cannot be used as a legal final judgment.
I12: Jurisdiction and governing-law semantics are distinct from usage territory.
I13: Unknown / stale / incompatible authoritative inputs cannot become final success implicitly.
I14: Coordinator/projection/UI cannot declare business finality.
I15: Financial Finality belongs to Ledger / Financial Finality Authority.
```

## 11. Required Instance Updates

修复后的 L5/L6 语义必须进入现有 Instance Registry，而不是另建第二套业务 Registry：

```text
204/205 → authority + legal/verification distinction
208      → admission snapshot + execution binding
210/212  → license orthogonal state
213      → impact propagation
214/216  → settlement authority boundary
220      → financial authority + certificate-independent finality
222      → dispute impact + jurisdiction references
224/225  → lifecycle closure using repaired semantics
226      → reverse coverage re-audit
229/230  → evidence semantics
231/232/233 → repaired preflight/evidence bundle semantics
```

## 12. Repair Acceptance Gates

```text
[ ] Authority registry has no ambiguous final authority
[ ] Provider / Adapter / Coordinator / Projection boundaries fixed
[ ] Certificate cannot become License authority
[ ] License state model is orthogonal
[ ] Admission snapshot fields fixed
[ ] Execution binding defined
[ ] Material-change recheck defined
[ ] Unified impact matrix defined
[ ] Legal fact / verification fact separated
[ ] Jurisdiction fields separated from territory
[ ] Machine invariants registered
[ ] Existing L5/L6 registries map to repaired semantics
[ ] Reverse coverage audit updated
```

## 13. Final Disposition

本修复完成后，不再因为上述六项问题新增业务合同。

下一步只允许：

```text
Update Instance Traceability
→ Reverse Audit
→ Populate Evidence
→ Verify Evidence
→ Unified CL
→ Implementation Admission
→ Implementation
→ CI
→ Runtime Verification
→ Production Acceptance
```

当前状态保持：

```text
STRUCTURAL REPAIR = COMPLETE
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
