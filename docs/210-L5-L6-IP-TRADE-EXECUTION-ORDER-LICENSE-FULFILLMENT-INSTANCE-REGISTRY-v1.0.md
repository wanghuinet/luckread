# LuckRead L5-L6 IP Trade Execution / Order / License / Fulfillment Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 209 IP Trade Execution / Order / License / Fulfillment Contract 实例化为 L5 Engineering Units 与 L6 Verification Atomic Units。

原则：

```text
L4 Product Contract
→ L5 Execution Unit
→ L6 Verification Atomic Unit
→ Evidence
```

本文件不新增产品能力，不创造新的 Order、Agreement、Rights、Commerce、License 或 Ledger 权威，也不授权代码实现。

## 2. Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Trade Execution Intake | L5-IP-210-INTAKE | 001-003 | PENDING |
| Order Model | L5-IP-210-ORDER | 004-006 | PENDING |
| Order Creation Gate | L5-IP-210-ORDER-GATE | 007-009 | PENDING |
| Order State Machine | L5-IP-210-ORDER-STATE | 010-012 | PENDING |
| Authorization Reservation | L5-IP-210-RESERVATION | 013-015 | PENDING |
| Reservation Release / Expiry | L5-IP-210-RESERVATION-LIFE | 016-018 | PENDING |
| Agreement Preparation | L5-IP-210-AGREEMENT | 019-021 | PENDING |
| Agreement Change Control | L5-IP-210-AGREEMENT-VERSION | 022-024 | PENDING |
| Approval Gate | L5-IP-210-APPROVAL | 025-027 | PENDING |
| E-Signature | L5-IP-210-ESIGN | 028-030 | PENDING |
| Payment / Condition Gate | L5-IP-210-CONDITION | 031-033 | PENDING |
| Ready-to-Activate Gate | L5-IP-210-ACTIVATE-GATE | 034-036 | PENDING |
| License Activation | L5-IP-210-LICENSE | 037-039 | PENDING |
| License State | L5-IP-210-LICENSE-STATE | 040-042 | PENDING |
| Authorization Certificate | L5-IP-210-CERTIFICATE | 043-045 | PENDING |
| Public Verification | L5-IP-210-VERIFY | 046-048 | PENDING |
| Fulfillment | L5-IP-210-FULFILLMENT | 049-051 | PENDING |
| Asset Delivery | L5-IP-210-ASSET | 052-054 | PENDING |
| Fulfillment Approval | L5-IP-210-FULFILLMENT-APPROVAL | 055-057 | PENDING |
| Reporting | L5-IP-210-REPORTING | 058-060 | PENDING |
| Cancellation | L5-IP-210-CANCEL | 061-063 | PENDING |
| Refund | L5-IP-210-REFUND | 064-066 | PENDING |
| Rights Revocation Impact | L5-IP-210-REVOCATION | 067-069 | PENDING |
| Dispute | L5-IP-210-DISPUTE | 070-072 | PENDING |
| Amendment | L5-IP-210-AMENDMENT | 073-075 | PENDING |
| Renewal | L5-IP-210-RENEWAL | 076-078 | PENDING |
| Expansion | L5-IP-210-EXPANSION | 079-081 | PENDING |
| Saga / Compensation | L5-IP-210-SAGA | 082-084 | PENDING |
| Idempotency | L5-IP-210-IDEMPOTENCY | 085-087 | PENDING |
| Event Ordering | L5-IP-210-EVENT | 088-090 | PENDING |
| Observability | L5-IP-210-OBSERVABILITY | 091-092 | PENDING |
| Audit | L5-IP-210-AUDIT | 093-095 | PENDING |

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

## 4. L5-IP-210-INTAKE

建立成交执行上下文：

```text
tradeId
admissionDecisionRef
buyerRef
licensorRef
skuRef
quoteRef?
dealRef?
requestedScope
createdAt
```

必须引用已通过的 Trade Admission 版本。

## 5. L5-IP-210-ORDER

订单保存关键版本快照：

```text
orderId
buyerId
licensorId
skuId
admissionDecisionId
admissionDecisionVersion
skuVersion
priceVersion
scopeSnapshot
quantity
currency
amountMinor
expiresAt
```

历史订单版本不得因当前商品变化而被重写。

## 6. L5-IP-210-ORDER-GATE

订单创建前再次验证：

```text
Admission
Buyer
SKU Availability
Current Rights
Scope
Conflict
Risk
Price
Approval
```

任何关键失败不得进入标准成交。

## 7. L5-IP-210-ORDER-STATE

状态机：

```text
DRAFT
→ CREATED
→ RESERVED
→ AGREEMENT_PENDING
→ SIGNATURE_PENDING
→ PAYMENT_PENDING
→ READY_TO_ACTIVATE
→ ACTIVATING
→ ACTIVE
→ FULFILLING
→ COMPLETED
```

异常：

```text
EXPIRED
CANCELLED
REJECTED
REFUNDED
DISPUTED
SUSPENDED
FAILED
```

## 8. L5-IP-210-RESERVATION

独家、有限容量、地区额度或时间窗口交易必须支持授权 Reservation：

```text
requested
reserved
committed
released
expired
consumed
```

Reservation ≠ License。

## 9. L5-IP-210-RESERVATION-LIFE

Reservation 必须具备：

```text
reservationId
sourceOrderId
scope
capacity
expiresAt
version
```

取消、过期或失败时释放未消费资源。

## 10. L5-IP-210-AGREEMENT

Agreement 输入来自结构化 Order / Deal：

```text
parties
scope
term
territory
usage
media
channels
exclusivity
derivative
sublicense
price
paymentTerms
approvals
complianceRequirements
```

必须保存生成时 Agreement Snapshot。

## 11. L5-IP-210-AGREEMENT-VERSION

签署前发生范围、价格、权利、主体或政策变化时必须重新生成/版本化 Agreement。

禁止静默覆盖历史 Agreement Snapshot。

## 12. L5-IP-210-APPROVAL

复杂交易支持：

```text
RIGHTS
LEGAL
COMPLIANCE
BUSINESS
FINANCE
EXECUTIVE
```

blocking approval 未完成不得进入最终签署。

## 13. L5-IP-210-ESIGN

签署证据必须记录：

```text
agreementId
agreementVersion
signerRef
signatureProvider
providerEnvelopeRef
signedAt
documentHash
signatureStatus
evidenceRef
```

SIGNED ≠ LICENSE ACTIVE。

## 14. L5-IP-210-CONDITION

激活条件支持：

```text
FULL_PAYMENT
DEPOSIT_PAID
MILESTONE_REACHED
NON_MONETARY_CONDITION
MANUAL_APPROVAL
CUSTOM_CONDITION
```

条件必须由正式 Authority 或证据提供方确认。

## 15. L5-IP-210-ACTIVATE-GATE

License 激活前必须满足：

```text
Valid Order
Valid Agreement
Required Signatures
Required Payment / Conditions
Current Rights Valid
Current Scope Valid
No Blocking Conflict
No Blocking Risk
Required Approval
```

```text
UNKNOWN ≠ READY_TO_ACTIVATE
```

## 16. L5-IP-210-LICENSE

License 是正式有效权利事实：

```text
licenseId
orderId
agreementId
skuId
scope
territory
term
exclusivity
derivative
sublicense
effectiveFrom
effectiveTo
status
version
```

Scope 不得超出合法授权范围与购买范围。

## 17. L5-IP-210-LICENSE-STATE

```text
PENDING
→ ACTIVE
→ EXPIRING
→ EXPIRED
```

异常：

```text
SUSPENDED
REVOKED
AMENDED
TERMINATED
```

## 18. L5-IP-210-CERTIFICATE

License Active 后才能生成：

```text
authorizationId
authorizationNumber
licenseId
agreementId
ipIdentity
licensor
licensee
scope
territory
term
issuedAt
status
documentHash
verificationRef
```

授权书必须与真实 License 一一绑定。

## 19. L5-IP-210-VERIFY

公开验证：

```text
VALID
EXPIRED
REVOKED
SUSPENDED
INVALID
```

仅返回最小必要信息，不泄露私有合同/风险/证据。

## 20. L5-IP-210-FULFILLMENT

履约状态：

```text
LICENSE_ACTIVE
→ ASSETS_DELIVERED
→ APPROVAL_IN_PROGRESS
→ APPROVED
→ USAGE_ACTIVE
→ REPORTING
→ COMPLETED
```

License Family 可定义专用履约模板。

## 21. L5-IP-210-ASSET

素材交付保存：

```text
assetSetId
assetVersion
deliveryMethod
deliveredAt
receivedBy
approvalStatus
checksumRef
```

素材交付不得修改 License Scope。

## 22. L5-IP-210-FULFILLMENT-APPROVAL

需要事前审批的业务：

```text
Submitted
→ Review
→ Approved / Rejected
→ Revision
→ Resubmit
```

Approval 必须绑定具体 License Scope 和交付物版本。

## 23. L5-IP-210-REPORTING

支持：

```text
salesReport
usageReport
campaignReport
territoryReport
channelReport
royaltyReportReference
```

Report 不覆盖 License 权利事实。

## 24. L5-IP-210-CANCEL

取消按阶段分类：

```text
BEFORE_SIGNATURE
BEFORE_PAYMENT
AFTER_PAYMENT_BEFORE_ACTIVATION
AFTER_ACTIVATION
DURING_FULFILLMENT
```

每一阶段的结果必须可追踪。

## 25. L5-IP-210-REFUND

退款由 Commerce Authority 决定：

```text
REQUESTED
→ REVIEW
→ APPROVED / REJECTED
→ REFUNDED
```

不得通过退款操作静默改写历史财务事实。

## 26. L5-IP-210-REVOCATION

Rights Revocation 后：

```text
Affected Licenses
→ Open Orders Review
→ SKU Availability Update
→ Authorization Verification Update
```

历史交易记录不得删除。

## 27. L5-IP-210-DISPUTE

争议可发生于：

```text
Quote
Order
Agreement
Payment
License
Fulfillment
Royalty / Reporting
```

状态：

```text
OPEN
UNDER_REVIEW
RESOLVED
REJECTED
ESCALATED
```

正式争议决策必须留下审计证据。

## 28. L5-IP-210-AMENDMENT

已签署交易变更使用：

```text
Original Agreement
→ Amendment
→ New Effective Version
→ License Revision
→ Authorization Projection
```

历史版本不可覆盖。

## 29. L5-IP-210-RENEWAL

续期必须重新检查：

```text
Rights
Price
Eligibility
Conflict
Risk
Agreement
```

产生新的 License Version / 生命周期记录。

## 30. L5-IP-210-EXPANSION

扩权范围：

```text
Territory
Channel
Media
Industry
Product Category
Term
Exclusivity
Derivative
Sublicense
```

扩权不得修改历史 Scope Snapshot。

## 31. L5-IP-210-SAGA

执行步骤：

```text
Reserve
→ Agreement
→ Sign
→ Payment
→ Activate
→ Certificate
→ Fulfillment
```

每一步必须定义：

```text
success
failure
retry
compensation
manualRecovery
```

禁止部分成功却显示为 Completed。

## 32. L5-IP-210-IDEMPOTENCY

幂等操作至少包括：

```text
Create Order
Reserve
Create Agreement
Send Signature
Record Payment Result
Activate License
Issue Certificate
Refund
Amendment
Renewal
```

重复请求不得产生重复正式事实。

## 33. L5-IP-210-EVENT

事件必须携带：

```text
eventId
aggregateId
aggregateVersion
sequence
occurredAt
causationId
correlationId
```

关键消费者必须能够检测重复、乱序和缺失。

## 34. L5-IP-210-OBSERVABILITY

统一交易关联键：

```text
tradeId
orderId
dealId?
agreementId
licenseId
authorizationId
```

必须可以从任意阶段回溯完整交易链路。

## 35. L5-IP-210-AUDIT

审计至少覆盖：

```text
Order
Reservation
Agreement Versions
Approvals
Signatures
Payment References
License Activation
Certificate
Fulfillment
Refund
Amendment
Renewal
Revocation
```

## 36. L6 Verification Atomic Units

### L6-IP-210-001
Trade execution context 必须引用有效 Admission Decision。

### L6-IP-210-002
Admission Decision 版本变化时执行上下文必须可识别。

### L6-IP-210-003
订单创建必须保留关键输入版本引用。

### L6-IP-210-004
Order 必须保存 SKU Version 与 Price Version。

### L6-IP-210-005
Order Scope Snapshot 不因当前 SKU 修改而变化。

### L6-IP-210-006
订单金额使用整数 minor units。

### L6-IP-210-007
订单创建前必须检查关键准入条件。

### L6-IP-210-008
失效 SKU 不得创建标准订单。

### L6-IP-210-009
关键状态 UNKNOWN 不得伪装成可继续交易。

### L6-IP-210-010
Order State 必须符合定义状态机。

### L6-IP-210-011
异常 Order State 必须与正常路径区分。

### L6-IP-210-012
ACTIVE Order 不代表 License Active，除非满足定义中的激活阶段。

### L6-IP-210-013
需要锁定授权资源时必须创建 Reservation。

### L6-IP-210-014
Reservation 不得被当作 License。

### L6-IP-210-015
Reservation 必须绑定 sourceOrderId 与 scope。

### L6-IP-210-016
订单取消时未消费 Reservation 能被释放。

### L6-IP-210-017
Reservation 过期后不能继续提供有效保留。

### L6-IP-210-018
Reservation 生命周期可重放。

### L6-IP-210-019
Agreement 输入来自结构化交易上下文。

### L6-IP-210-020
Agreement Snapshot 包含生成时 Scope 与 Price。

### L6-IP-210-021
Agreement 生成关系可追溯到 Order / Deal。

### L6-IP-210-022
签约前实质变化会产生新 Agreement Version。

### L6-IP-210-023
历史 Agreement Snapshot 不被原地覆盖。

### L6-IP-210-024
Agreement 版本变更可以定位变更原因。

### L6-IP-210-025
Blocking Approval 未完成不得进入最终签署。

### L6-IP-210-026
Approval 必须记录 approver、policyVersion、scope 与 decision。

### L6-IP-210-027
Approval 不能偷偷改变 Rights Scope。

### L6-IP-210-028
Signature Evidence 必须引用 Agreement Version。

### L6-IP-210-029
SIGNED 状态不能直接证明 License Active。

### L6-IP-210-030
Signature Evidence 必须具备 documentHash 或等价完整性证据。

### L6-IP-210-031
Payment / Condition Gate 必须引用正式条件状态。

### L6-IP-210-032
未满足 blocking condition 不得进入 Activation。

### L6-IP-210-033
UNKNOWN Condition 不得判定为已满足。

### L6-IP-210-034
Ready-to-Activate 需要满足所有 blocking 条件。

### L6-IP-210-035
Current Rights 与 Current Scope 必须再次检查。

### L6-IP-210-036
Activation Gate 不得仅相信旧缓存。

### L6-IP-210-037
License Scope 不得超过授权 Scope。

### L6-IP-210-038
License Active 必须存在满足条件的 Order 与 Agreement。

### L6-IP-210-039
重复 License Activation 不得产生第二个正式 License。

### L6-IP-210-040
License State 必须符合定义状态机。

### L6-IP-210-041
Expired License 不得继续被视为 Active。

### L6-IP-210-042
Revoked / Suspended License 必须反映在状态查询中。

### L6-IP-210-043
Authorization Certificate 只能绑定真实 License。

### L6-IP-210-044
Authorization Number 必须唯一。

### L6-IP-210-045
Certificate DocumentHash 可验证证书完整性。

### L6-IP-210-046
公开验证能区分 VALID、EXPIRED、REVOKED、SUSPENDED、INVALID。

### L6-IP-210-047
公共验证不能泄露受限合同或内部风险证据。

### L6-IP-210-048
验证结果可以追溯至 Authorization / License。

### L6-IP-210-049
Fulfillment 生命周期符合定义状态机。

### L6-IP-210-050
履约开始必须引用 Active License。

### L6-IP-210-051
履约完成不能自动扩大 License Scope。

### L6-IP-210-052
Asset Delivery 必须具有版本标识。

### L6-IP-210-053
交付记录必须能够确认接收主体。

### L6-IP-210-054
交付内容完整性可以通过 checksum/hash reference 验证。

### L6-IP-210-055
需要审批的履约项必须进入 Approval Workflow。

### L6-IP-210-056
Approval 必须绑定 License Scope 与 Asset Version。

### L6-IP-210-057
被拒绝的履约项不能被显示为 Approved。

### L6-IP-210-058
Reporting 数据与 License 权利事实保持边界。

### L6-IP-210-059
Reporting 能追踪到授权范围与交易上下文。

### L6-IP-210-060
Royalty reporting 不能直接修改 Ledger Authority。

### L6-IP-210-061
取消必须保留取消阶段。

### L6-IP-210-062
取消结果必须可追溯到对应 Order / Agreement / License。

### L6-IP-210-063
取消不会删除历史交易证据。

### L6-IP-210-064
退款只能由 Commerce Authority 最终决定。

### L6-IP-210-065
退款不会静默覆盖历史 Payment / Ledger 事实。

### L6-IP-210-066
退款状态必须可审计。

### L6-IP-210-067
Rights Revocation 能定位受影响 License。

### L6-IP-210-068
撤销后新授权签发被阻止。

### L6-IP-210-069
撤销影响能够传播到公开验证状态。

### L6-IP-210-070
Dispute 必须具有独立状态。

### L6-IP-210-071
Dispute 不能通过直接覆盖正式状态结案。

### L6-IP-210-072
争议结果必须保留决策与证据引用。

### L6-IP-210-073
Amendment 产生新版本。

### L6-IP-210-074
原 Agreement / License 历史版本不可覆盖。

### L6-IP-210-075
Amendment 能够解释其变更范围。

### L6-IP-210-076
Renewal 重新检查当前 Rights。

### L6-IP-210-077
Renewal 重新检查价格与资格。

### L6-IP-210-078
Renewal 产生新的有效期/版本关系。

### L6-IP-210-079
Expansion 只能增加明确声明的授权维度。

### L6-IP-210-080
Expansion 不改变历史 Scope Snapshot。

### L6-IP-210-081
Expansion 的新 Scope 可追溯到正式批准与交易输入。

### L6-IP-210-082
Saga 每一步都有成功/失败语义。

### L6-IP-210-083
失败步骤定义 retry 与 compensation。

### L6-IP-210-084
部分执行不得标记为 Completed。

### L6-IP-210-085
关键交易动作必须幂等。

### L6-IP-210-086
重复请求不能制造重复 License / Certificate。

### L6-IP-210-087
幂等键与正式结果可关联。

### L6-IP-210-088
关键事件具有 aggregateVersion / sequence。

### L6-IP-210-089
消费者可以识别重复或乱序事件。

### L6-IP-210-090
事件关联能够回溯交易因果链。

### L6-IP-210-091
交易全链路具有统一 correlation。

### L6-IP-210-092
关键阶段失败可以关联到可观测指标与日志上下文。

### L6-IP-210-093
关键交易状态变更必须审计。

### L6-IP-210-094
审计记录包含 actor、time、before、after、reason 或等价字段。

### L6-IP-210-095
交易链可从最终授权书反向追溯至 Admission / Order / Agreement / Rights Evidence。

## 37. Machine Invariants

```text
I1: No valid admission ⇒ no standard order
I2: Order Scope ⊆ Admission Scope
I3: Reservation ≠ License
I4: Signed ≠ Active License
I5: Active License ⇒ activation conditions satisfied
I6: Authorization Certificate ⇒ Active License
I7: Expired / Revoked License ≠ VALID verification
I8: UNKNOWN condition ≠ activation readiness
I9: Historical Agreement / License versions immutable
I10: Duplicate activation ⇒ no duplicate License
I11: Rights revocation ⇒ affected transaction re-evaluation
I12: Partial execution ≠ completed transaction
I13: Refund ≠ silent Ledger rewrite
I14: Amendment ⇒ new version
I15: Event replay does not create duplicate formal facts
```

## 38. Evidence Requirements

每个 L6 PASS 必须具备至少一种可审计 Evidence：

```text
unit test
integration test
contract test
e2e evidence
security evidence
performance evidence
reliability evidence
migration evidence
smoke evidence
user acceptance evidence
static analysis evidence
```

Evidence 必须可关联：

```text
L6 ID
→ test / artifact
→ execution context
→ result
→ timestamp
→ version / commit
```

## 39. Cross-Contract Dependencies

```text
208 Unified Trade Admission
 ↓
209 Trade Execution Contract
 ↓
210 Trade Execution L5/L6 Registry
 ↓
200 Transaction / E-Sign / Authorization
 ↓
Rights / Commerce / Agreement / License / Ledger
 ↓
Fulfillment / Evidence / Event / Audit
```

## 40. Acceptance Gates

```text
[ ] Trade Intake instantiated
[ ] Order lifecycle instantiated
[ ] Reservation lifecycle instantiated
[ ] Agreement snapshot/versioning instantiated
[ ] Approval instantiated
[ ] E-sign evidence instantiated
[ ] Activation gate instantiated
[ ] License lifecycle instantiated
[ ] Authorization certificate instantiated
[ ] Public verification instantiated
[ ] Fulfillment instantiated
[ ] Cancellation/refund instantiated
[ ] Revocation instantiated
[ ] Dispute instantiated
[ ] Amendment/renewal/expansion instantiated
[ ] Saga/compensation instantiated
[ ] Idempotency instantiated
[ ] Event ordering instantiated
[ ] Observability instantiated
[ ] Audit instantiated
[ ] L6 Evidence requirements instantiated
```

## 41. Implementation Boundary

本注册表只定义 L5/L6 可验证结构，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
