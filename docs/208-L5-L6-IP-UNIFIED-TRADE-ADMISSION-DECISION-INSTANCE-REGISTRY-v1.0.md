# LuckRead L5-L6 IP Unified Trade Admission Decision Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 IP 交易中心的跨域交易准入逻辑实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

统一准入原则：

```text
Buyer
× Intent
× SKU
× Rights
× Eligibility
× Risk
× Pricing
× Procurement
× Agreement Readiness
        ↓
TRADE ADMISSION DECISION
        ↓
ALLOW / CONDITIONAL / REVIEW / BLOCK
```

本文件不创造新的业务权威。Rights、Risk、Commerce、Agreement、License、Identity 等仍由各自 Authority 管理。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Trade Intake | L5-IP-208-INTAKE | 001-003 | PENDING |
| Buyer Eligibility Gate | L5-IP-208-BUYER-GATE | 004-006 | PENDING |
| Intent Integrity Gate | L5-IP-208-INTENT-GATE | 007-009 | PENDING |
| SKU Integrity Gate | L5-IP-208-SKU-GATE | 010-012 | PENDING |
| Rights Authority Gate | L5-IP-208-RIGHTS-GATE | 013-015 | PENDING |
| Scope Intersection | L5-IP-208-SCOPE-GATE | 016-018 | PENDING |
| Conflict Gate | L5-IP-208-CONFLICT-GATE | 019-021 | PENDING |
| Risk Gate | L5-IP-208-RISK-GATE | 022-024 | PENDING |
| Pricing Gate | L5-IP-208-PRICE-GATE | 025-027 | PENDING |
| Procurement Gate | L5-IP-208-PROCUREMENT-GATE | 028-030 | PENDING |
| Approval Gate | L5-IP-208-APPROVAL-GATE | 031-033 | PENDING |
| Agreement Readiness | L5-IP-208-AGREEMENT-GATE | 034-036 | PENDING |
| Decision Composer | L5-IP-208-COMPOSER | 037-039 | PENDING |
| Conditional Admission | L5-IP-208-CONDITIONAL | 040-042 | PENDING |
| Manual Review | L5-IP-208-REVIEW | 043-045 | PENDING |
| Decision Versioning | L5-IP-208-VERSION | 046-048 | PENDING |
| Idempotency | L5-IP-208-IDEMPOTENCY | 049-051 | PENDING |
| Recheck on Change | L5-IP-208-RECHECK | 052-054 | PENDING |
| Decision Expiration | L5-IP-208-EXPIRY | 055-056 | PENDING |
| Decision Audit | L5-IP-208-AUDIT | 057-059 | PENDING |
| Evidence Binding | L5-IP-208-EVIDENCE | 060-062 | PENDING |
| Security / Privacy | L5-IP-208-PRIVACY | 063-065 | PENDING |
| Event Publication | L5-IP-208-EVENT | 066-068 | PENDING |

## 3. L5 Common Execution Contract

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

## 4. L5-IP-208-INTAKE

建立统一交易准入上下文：

```text
buyerRef
intentRef
skuRef
quoteRef?
dealRef?
requestedAt
requestedScope
```

必须绑定当前 Buyer、Intent、SKU 版本。

## 5. L5-IP-208-BUYER-GATE

验证：

```text
Buyer Verification
Buyer Status
Procurement Status
Contract Eligibility
Risk Status
```

任何关键状态无效都不能产生 ALLOW。

## 6. L5-IP-208-INTENT-GATE

验证：

```text
intentVersion
usage
industry
territory
term
channel
media
exclusivity
budget
```

缺少交易必需字段时：

```text
REVIEW 或 BLOCK
```

## 7. L5-IP-208-SKU-GATE

验证 SKU：

```text
status
version
scope
pricingVersion
contractTemplateVersion
eligibilityPolicy
availability
```

已失效 SKU 不得进入 ALLOW。

## 8. L5-IP-208-RIGHTS-GATE

必须重新向 Rights Authority 获取当前权利状态引用。

禁止仅相信页面缓存或旧 Quote：

```text
Current Rights
≠
Cached Rights Snapshot
```

## 9. L5-IP-208-SCOPE-GATE

计算：

```text
Buyer Intent
∩
SKU Grant Scope
∩
Current Rights Scope
```

只有完整合法交集才能进入标准交易。

输出：

```text
EXACT
PARTIAL
EMPTY
```

`PARTIAL` 必须进入重新报价、缩减范围或 Deal Desk。

## 10. L5-IP-208-CONFLICT-GATE

检查：

```text
Existing Exclusive Licenses
Overlapping Territory
Overlapping Term
Overlapping Channel
Overlapping Usage
Existing Reservations
```

结果：

```text
CLEAR
POTENTIAL
CONFIRMED
REVIEW
```

CONFIRMED 不得自动 ALLOW。

## 11. L5-IP-208-RISK-GATE

读取 Risk Authority 当前决策：

```text
PASS
CONDITIONAL
REVIEW
BLOCK
```

不可在 Trading Center 内自行降低风险等级。

## 12. L5-IP-208-PRICE-GATE

验证：

```text
pricingVersion
currency
minorUnitAmount
priceScope
effectiveFrom
effectiveTo
pricingPolicyVersion
```

价格必须覆盖当前交易 scope，且不存在过期价格。

## 13. L5-IP-208-PROCUREMENT-GATE

企业交易验证：

```text
purchaseRequest
budgetApproval
procurementApproval
requiredReferences
```

不要求采购审批的标准 SKU 可以走轻量路径；复杂高价值交易必须满足对应政策。

## 14. L5-IP-208-APPROVAL-GATE

根据交易策略触发：

```text
BUSINESS
FINANCE
LEGAL
COMPLIANCE
SECURITY
EXECUTIVE
```

每个审批必须绑定：

```text
policyVersion
scope
decision
approver
decidedAt
```

## 15. L5-IP-208-AGREEMENT-GATE

签约前必须验证：

```text
agreementTemplate
clauseSet
partyEligibility
scopeSnapshot
pricingSnapshot
requiredApprovals
```

Agreement 生成输入必须来自结构化交易上下文。

## 16. L5-IP-208-COMPOSER

统一 Decision Composer：

```text
Buyer Gate
+
Intent Gate
+
SKU Gate
+
Rights Gate
+
Scope Gate
+
Conflict Gate
+
Risk Gate
+
Price Gate
+
Procurement Gate
+
Approval Gate
+
Agreement Gate
        ↓
Trade Admission Decision
```

结果必须明确每个子决策。

## 17. Decision Vocabulary

统一输出：

```text
ALLOW
CONDITIONAL
REVIEW
BLOCK
```

禁止使用模糊的 `SUCCESS` 代替交易准入决策。

## 18. L5-IP-208-CONDITIONAL

CONDITIONAL 必须明确：

```text
conditions[]
conditionType
conditionOwner
dueAt
blocking
satisfactionEvidenceRef
```

未满足 blocking condition 不得继续至签约/授权。

## 19. L5-IP-208-REVIEW

REVIEW 必须进入指定队列：

```text
LEGAL
RIGHTS
RISK
COMPLIANCE
DEAL_DESK
OPERATIONS
```

Review 状态不能被 UI 当成 Allow。

## 20. L5-IP-208-VERSION

每一次准入决策必须版本化：

```text
decisionId
decisionVersion
createdAt
inputsSnapshot
policyVersions
result
previousDecisionRef
```

历史决策 append-only。

## 21. L5-IP-208-IDEMPOTENCY

同一：

```text
buyer
× intentVersion
× skuVersion
× quoteVersion
× requestedScope
```

的重复请求必须返回同一有效决策或明确的新版本，而不是产生无法关联的多个活动决策。

## 22. L5-IP-208-RECHECK

任何关键依赖发生变化必须重新决策：

```text
Buyer Status Changed
Intent Changed
SKU Changed
Rights Changed
Conflict Changed
Risk Changed
Price Expired
Policy Changed
Approval Changed
```

## 23. L5-IP-208-EXPIRY

准入决策可以具备：

```text
validFrom
validUntil
```

过期后必须重新检查，而不是永久信任历史 Allow。

## 24. L5-IP-208-AUDIT

记录：

```text
actor
decision
time
inputs
outputs
policyVersions
manualOverrides
reason
evidenceRefs
```

尤其记录 BLOCK、REVIEW、CONDITIONAL 以及人工覆盖。

## 25. L5-IP-208-EVIDENCE

每个关键子决策必须能绑定 Evidence：

```text
buyerEvidence
rightsEvidence
riskEvidence
priceEvidence
approvalEvidence
agreementEvidence
```

最终交易决策必须可以反向追踪到 Evidence Registry。

## 26. L5-IP-208-PRIVACY

交易准入上下文可能包含商业敏感信息：

```text
budget
negotiationTerms
businessPurpose
counterparty
internalApproval
```

只能向有权限的角色暴露。

## 27. L5-IP-208-EVENT

至少产生：

```text
trade.admission.requested
trade.admission.allowed
trade.admission.conditional
trade.admission.review
trade.admission.blocked
trade.admission.expired
trade.admission.recheck_required
```

事件表达决策事实，不自行完成跨域授权或结算。

## 28. Unified State Model

交易准入上下文状态：

```text
INITIATED
CHECKING
CONDITIONALLY_READY
READY
REVIEW_REQUIRED
BLOCKED
EXPIRED
SUPERSEDED
```

`READY` 只表示准入条件完成，不等同于 License 已生效。

## 29. Decision Precedence

当多个子决策冲突时：

```text
BLOCK
  > REVIEW
  > CONDITIONAL
  > ALLOW
```

即任何关键 BLOCK 不得被其他子系统的 ALLOW 覆盖。

## 30. Authority Boundary

统一 Composer 只能聚合各 Authority 的结果：

```text
Identity → 身份事实
Rights → 权利事实
Risk → 风险决策
Commerce → 订单/支付事实
Agreement → 合同事实
License → 生效权利事实
Ledger → 财务事实
```

Composer 不得重新创建这些事实。

## 31. Standard Trade Path

```text
SKU
→ Trade Intake
→ All Gates
→ ALLOW
→ Order
→ Agreement
→ E-Sign
→ Payment
→ License
→ Authorization
```

准入 Gate 不取代后续订单、签约与授权流程。

## 32. Enterprise Path

```text
Intent
→ Precheck
→ Deal Desk
→ Multi-Gate Decision
→ Term Sheet
→ Approval
→ Agreement
→ E-Sign
→ Commerce
→ License
```

企业流程必须使用相同核心 Gate，而不是创建第二套交易规则。

## 33. Failure Handling

任一 Gate 超时、状态未知或 Authority unavailable 时：

```text
UNKNOWN ≠ ALLOW
```

默认进入：

```text
REVIEW 或 BLOCK
```

除非已有明确、未过期且政策允许的安全降级规则。

## 34. Cache Boundary

可以缓存：

```text
non-authoritative display data
match candidates
static policy metadata
```

不得用过期缓存绕过：

```text
Current Rights Check
Current Risk Decision
Current Buyer Eligibility
Exclusive Conflict Check
```

## 35. Machine Invariants

```text
I1: ALLOW requires all blocking gates satisfied
I2: BLOCK > REVIEW > CONDITIONAL > ALLOW
I3: UNKNOWN Authority result ≠ ALLOW
I4: PARTIAL scope ≠ standard ALLOW
I5: Expired price ≠ valid trade price
I6: Expired decision ≠ current authorization
I7: Decision references exact input versions
I8: Manual override requires reason + actor + evidence
I9: Composer cannot create Rights / Risk / Commerce / Agreement facts
I10: Recheck is required after material dependency change
I11: Review state cannot be represented as Ready
I12: Evidence binding is required for acceptance
```

## 36. Cross-Contract Dependencies

```text
207 Buyer Admission
 ↓
205 Licensor / Rights Verification
 ↓
203 SKU / Pricing / Deal Desk
 ↓
208 Unified Trade Admission
 ↓
200 Transaction / E-Sign / Authorization
 ↓
64 Rights
62 Risk
65 Commerce
68 Wallet / Ledger
Agreement / License
176 Evidence Registry
```

## 37. Acceptance Gates

```text
[ ] Unified trade context defined
[ ] All blocking gates defined
[ ] Decision vocabulary fixed
[ ] Decision precedence fixed
[ ] Rights/Risk/Commerce/Agreement boundaries fixed
[ ] Versioning defined
[ ] Idempotency defined
[ ] Recheck defined
[ ] Expiry defined
[ ] Failure-safe behavior defined
[ ] Evidence binding defined
[ ] Security boundary defined
[ ] Events defined
[ ] Machine invariants defined
```

## 38. Implementation Boundary

本注册表只定义 L5/L6 可验证结构，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
