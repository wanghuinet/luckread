# LuckRead IP Trade Execution / Order / Agreement / License / Fulfillment Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本合同定义 IP Trading Center 在 `Trade Admission = ALLOW` 之后的标准成交执行链。

目标不是“下单成功”，而是确保每一笔授权交易从订单创建到 License 生效、电子授权书签发、履约、续期、取消、退款、争议和撤销都具有明确状态、权利边界和可审计证据。

核心链路：

```text
Trade Admission
→ Order
→ Authorization Reservation
→ Agreement Preparation
→ Approval
→ E-Signature
→ Payment / Conditions
→ License Activation
→ Authorization Certificate
→ Fulfillment
→ Renewal / Expansion / Amendment
→ Completion / Expiry / Revocation
```

## 2. 非协商原则

系统必须保证：

```text
没有有效 Trade Admission 不能进入标准成交
没有合法 Scope 不能生成 License
没有满足签约条件不能进入 Signed
没有满足生效条件不能进入 Active License
License Active 之前不得伪造“已获得授权”
Authorization Certificate 必须绑定真实 License
```

## 3. Authority Boundary

```text
Trade Admission → 交易准入决策
Commerce → Order / Payment / Refund
Agreement → Agreement / Contract Fact
Signature Provider → Signature Evidence
Rights → Rights Authority
License → Effective License Fact
Authorization → Certificate / Verification Projection
Ledger → Financial Fact
Risk → Risk Decision
Evidence Registry → Evidence
```

Transaction Orchestrator 只能协调，不得重新定义这些事实。

## 4. Order Model

标准订单至少具有：

```text
orderId
buyerId
licensorId
skuId
quoteId?
dealId?
admissionDecisionId
admissionDecisionVersion
skuVersion
priceVersion
scopeSnapshot
quantity
currency
amountMinor
orderStatus
createdAt
expiresAt
```

订单必须保存创建时的关键版本快照。

## 5. Order Creation Gate

创建 Order 前必须再次确认：

```text
Admission Decision
Buyer Eligibility
SKU Availability
Current Rights
Scope
Conflict
Risk
Price Validity
Required Approval
```

允许存在轻量再检查，但不能永久信任旧准入结果。

## 6. Order State Machine

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

## 7. Authorization Reservation

涉及独家权利、有限数量、区域额度或时间窗口时，必须先建立 Reservation：

```text
requested
reserved
committed
released
expired
consumed
```

Reservation 不是 License。

## 8. Reservation Rules

Reservation 必须具备：

```text
reservationId
scope
capacity
expiresAt
ownerRef
sourceOrderId
version
```

失效订单必须释放未消费的 Reservation。

禁止通过前端状态模拟保留授权资源。

## 9. Agreement Preparation

Agreement 的输入必须来自结构化订单/Deal：

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
approvalRequirements
complianceRequirements
```

Agreement Snapshot 必须冻结生成时版本。

## 10. Agreement Change Control

签约前发生以下变化：

```text
Scope Changed
Price Changed
Term Changed
Party Changed
Rights Changed
Policy Changed
```

必须重新生成或版本化 Agreement，不得静默修改原 Snapshot。

## 11. Approval Gate

复杂交易可以要求：

```text
RIGHTS_APPROVAL
LEGAL_APPROVAL
COMPLIANCE_APPROVAL
BUSINESS_APPROVAL
FINANCE_APPROVAL
EXECUTIVE_APPROVAL
```

所有 blocking approval 未完成，不得进入最终签署。

## 12. E-Signature

签署必须关联：

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

签署成功只证明 Agreement 被签署，不自动等同 License Active。

## 13. Signature State

```text
NOT_STARTED
PREPARED
SENT
PARTIALLY_SIGNED
SIGNED
DECLINED
EXPIRED
VOIDED
```

部分签署不得被表示为最终成交完成。

## 14. Payment / Condition Gate

License 激活条件必须明确：

```text
FULL_PAYMENT
DEPOSIT_PAID
MILESTONE_REACHED
NON_MONETARY_CONDITION
MANUAL_APPROVAL
CUSTOM_CONDITION
```

条件满足由对应 Authority 或证据提供方确认。

## 15. Payment Boundary

IP Trading 不自己记录财务最终事实：

```text
Order Amount
→ Commerce
→ Payment Status
→ Ledger Reference
```

平台只保存必要引用和交易上下文。

## 16. Ready-to-Activate Gate

License 进入激活前必须满足：

```text
Valid Order
Valid Agreement
Required Signatures Complete
Required Payment / Conditions Complete
Rights Still Valid
Scope Still Valid
No Blocking Conflict
No Blocking Risk
Required Approval Complete
```

任一关键条件未知时：

```text
UNKNOWN ≠ READY_TO_ACTIVATE
```

## 17. License Activation

License 是正式生效的权利事实。

最小字段：

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

License 的 Scope 不得超出已购买和合法授权范围。

## 18. License State Machine

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

## 19. Authorization Certificate

License Active 后生成电子授权书：

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

授权书必须可验证并与 License 一一绑定。

## 20. Certificate Generation Rule

禁止：

```text
Signed Agreement
→ 直接生成有效授权书
```

必须：

```text
Signed Agreement
+
Activation Conditions
+
Active License
→ Authorization Certificate
```

## 21. Public Verification

第三方可通过：

```text
authorizationNumber
QR
verificationRef
```

查询：

```text
VALID
EXPIRED
REVOKED
SUSPENDED
INVALID
```

只公开最小必要信息。

## 22. Fulfillment

授权交易需要支持行业履约：

```text
LICENSE_ACTIVE
→ ASSETS_DELIVERED
→ APPROVAL_IN_PROGRESS
→ APPROVED
→ USAGE_ACTIVE
→ REPORTING
→ COMPLETED
```

不同 License Family 可定义不同 Fulfillment Template。

## 23. Asset Delivery

需要交付素材时必须支持：

```text
assetSetId
assetVersion
deliveryMethod
deliveredAt
receivedBy
approvalStatus
checksum / hash reference
```

素材交付不能修改 License Scope。

## 24. Approval Workflow During Fulfillment

例如商品包装、角色使用、广告素材可能需要事前批准：

```text
Submitted
→ Review
→ Approved / Rejected
→ Revision
→ Resubmit
```

Approval Record 必须绑定 License Scope 与具体交付物版本。

## 25. Reporting

复杂授权可要求：

```text
salesReport
usageReport
campaignReport
territoryReport
channelReport
royaltyReportReference
```

Reporting 结果不能直接覆盖 License 权利事实。

## 26. Cancellation

取消必须区分：

```text
BEFORE_SIGNATURE
BEFORE_PAYMENT
AFTER_PAYMENT_BEFORE_ACTIVATION
AFTER_ACTIVATION
DURING_FULFILLMENT
```

不同阶段的取消后果必须由 Commerce / Agreement / License 合同定义。

## 27. Refund

退款必须由 Commerce Authority 决定：

```text
Refund Requested
→ Review
→ Approved / Rejected
→ Refunded
```

退款不会自动假设 License 已撤销；若已激活，必须依据正式 License / Agreement 规则处理。

## 28. Rights Revocation Impact

权利撤销发生时：

```text
Rights Revoked
→ Affected Licenses Identified
→ Trading Availability Updated
→ Open Orders Reviewed
→ Active License Impact Evaluated
→ Authorization Verification Updated
```

不得静默删除历史交易记录。

## 29. Dispute

交易争议可发生在：

```text
Quote
Order
Agreement
Payment
License
Fulfillment
Royalty / Reporting
```

争议状态：

```text
OPEN
UNDER_REVIEW
RESOLVED
REJECTED
ESCALATED
```

争议不能通过直接改数据库状态解决；必须形成正式决策记录。

## 30. Amendment

已签署交易发生变更时必须使用 Amendment：

```text
Original Agreement
→ Amendment
→ New Agreement Version / Effective Change
→ License Revision
→ New Authorization Projection if required
```

不得覆盖历史协议和历史 License 版本。

## 31. Renewal

续期流程：

```text
EXPIRING
→ RENEWAL OFFER
→ RIGHTS RECHECK
→ PRICE RECHECK
→ AGREEMENT / AMENDMENT
→ SIGN
→ CONDITIONS
→ NEW LICENSE VERSION
```

续期必须重新检查权利有效性。

## 32. Expansion

扩权可增加：

```text
Territory
Channel
Media
Industry
Product Category
Term
Exclusivity
Derivative Rights
Sublicense
```

扩权不能修改原历史 Scope Snapshot。

## 33. Saga / Compensation

跨域交易执行失败时采用可补偿步骤：

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
manual recovery
```

禁止“部分成功但系统显示完成”。

## 34. Idempotency

关键操作必须幂等：

```text
Create Order
Reserve Capacity
Create Agreement
Send Signature Request
Record Payment Result
Activate License
Issue Certificate
Process Refund
Create Amendment
Renew License
```

重复请求不得产生重复正式事实。

## 35. Event Contract

至少支持：

```text
order.created
order.reserved
agreement.prepared
agreement.signed
payment.completed
license.activated
authorization.issued
fulfillment.started
fulfillment.completed
order.cancelled
order.refunded
license.amended
license.renewed
license.revoked
trade.disputed
```

事件只表达事实变化，不直接替代 Authority。

## 36. Event Ordering

交易关键事件必须支持：

```text
sequence
aggregateId
aggregateVersion
eventId
occurredAt
causationId
correlationId
```

消费者必须能够检测重复和乱序。

## 37. Observability

每笔交易必须具有统一 Correlation：

```text
tradeId
orderId
dealId?
agreementId
licenseId
authorizationId
```

能够从任何关键阶段回溯完整链路。

## 38. Audit

必须审计：

```text
order creation
reservation
price
scope
agreement versions
approvals
signatures
payment references
license activation
certificate issuance
fulfillment
refund
amendment
renewal
revocation
```

## 39. Machine Invariants

```text
I1: No valid admission ⇒ no standard order
I2: Order Scope ⊆ Admission Scope
I3: License Scope ⊆ Authorized Scope
I4: Reservation ≠ License
I5: Signed ≠ License Active
I6: Active License ⇒ required activation conditions satisfied
I7: Authorization Certificate ⇒ Active License exists
I8: Expired / Revoked License ⇒ verification cannot return VALID
I9: UNKNOWN condition ≠ activation readiness
I10: Historical Agreement / License versions are immutable
I11: Duplicate activation request cannot create duplicate License
I12: Rights revocation triggers affected transaction re-evaluation
I13: Partial execution ≠ completed transaction
I14: Refund does not silently rewrite historical Ledger facts
I15: Amendment creates a new version
```

## 40. Cross-Contract Dependencies

```text
208 Unified Trade Admission
 ↓
203 SKU / Pricing / Deal Desk
 ↓
209 Trade Execution
 ↓
200 Transaction / E-Sign / Authorization
 ↓
Rights / Commerce / Agreement / License / Ledger
 ↓
Fulfillment / Evidence / Event / Audit
```

## 41. Acceptance Gates

```text
[ ] Order model defined
[ ] Reservation defined
[ ] Agreement snapshot defined
[ ] Approval gate defined
[ ] E-sign evidence defined
[ ] Payment/condition gate defined
[ ] License activation gate defined
[ ] Authorization certificate binding defined
[ ] Public verification defined
[ ] Fulfillment lifecycle defined
[ ] Cancellation/refund rules defined
[ ] Revocation impact defined
[ ] Amendment/renewal/expansion defined
[ ] Saga/compensation defined
[ ] Idempotency defined
[ ] Event ordering defined
[ ] Audit/observability defined
[ ] Machine invariants defined
```

## 42. Implementation Boundary

本合同只定义产品与架构约束，不授权代码实现。

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
