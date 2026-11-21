# LuckRead IP Trade Dispute / Claims / Legal Resolution Contract v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同补齐 IP Center 的 P0 争议与法律处理闭环：

```text
Conflict / Incident
→ Notice
→ Claim
→ Evidence Preservation
→ Case Admission
→ Review
→ Negotiation / Mediation
→ Decision
→ Enforcement
→ Compensation / Adjustment
→ Reconciliation
→ Closure
```

目标是保证 IP 交易、授权、使用、结算发生争议时，可以从原始交易事实追溯到证据、责任范围、处理决定、执行结果和最终关闭，而不是停留在一个孤立的“投诉工单”。

本合同不创建新的 Rights、Commerce、License、Compliance、Ledger 或 Evidence Authority。

## 2. Authority Boundary

| Domain | Authority |
|---|---|
| Rights Fact | Rights Authority |
| Trade Admission | Trade Admission Authority |
| Order / Commerce Fact | Commerce Authority |
| Agreement / Signature | Agreement / E-Sign Authority |
| License Fact | License Authority |
| Usage / Compliance | Compliance Authority |
| Financial Finality | Wallet / Ledger / Financial Authority |
| Evidence | Evidence Registry |
| Dispute Coordination | Dispute Case Authority defined by platform |
| Legal Determination | Authorized legal / arbitration / judicial process where applicable |

Dispute Case Authority 负责案件编排、状态管理、证据关联和结果追踪，不得自行制造其他领域的事实权威。

## 3. Canonical Case Record

每个争议案件至少能够关联：

```text
caseId
tradeId
ipId
rightsProfileId?
licenseId?
orderId?
agreementId?
settlementId?
payoutId?
claimantId
respondentId
issueType
severity
riskLevel
status
correlationId
rootOperationId
createdAt
updatedAt
```

已经产生的核心引用不得在案件生命周期中静默替换。

## 4. Case Sources

案件可以来源于：

```text
Rights Conflict
License Breach
Usage Over-Scope
Payment / Settlement Dispute
Royalty Dispute
Payout Failure
Agreement Interpretation
Unauthorized Use
Counterfeit / Misrepresentation
Fraud / Abuse
Platform Policy Incident
```

案件来源必须保留原始事实引用。

## 5. Case State Machine

标准状态：

```text
DETECTED
NOTICE_REQUIRED
CLAIM_SUBMITTED
ADMISSION_REVIEW
OPEN
EVIDENCE_COLLECTION
UNDER_REVIEW
NEGOTIATION
MEDIATION
DECISION_PENDING
DECIDED
ENFORCEMENT_PENDING
ENFORCED
COMPENSATION_PENDING
RECONCILIATION_PENDING
RESOLVED
CLOSED
REOPENED
BLOCKED
```

状态转换必须满足前置条件，不允许通过人工写状态绕过案件流程。

## 6. Immediate Protection

重大案件可以触发临时保护：

```text
License Hold
New Order Hold
Payout Hold
Content / Usage Restriction
SKU Suspension
Account Review
Evidence Preservation
```

临时保护不是最终责任判定，必须记录：

```text
reason
scope
actor
authority
evidence
startAt
expiryAt / reviewAt
```

## 7. Notice

正式 Notice 至少包含：

```text
noticeId
caseId
recipient
issueSummary
affectedScope
requiredAction
responseDeadline
evidenceRefs
issuedAt
```

Notice 不得自动等同最终裁决。

## 8. Claim

Claim 至少包含：

```text
claimId
caseId
claimType
claimant
respondent
factualBasis
requestedRemedy
amountMinor?
currency?
affectedLicenseScope?
evidenceRefs
submittedAt
```

Claim 是当事方主张，不等同于平台最终事实。

## 9. Evidence Preservation

案件进入正式处理后，应保护关键证据：

```text
Identity Evidence
Rights Evidence
License Version
Agreement Version
Order Snapshot
Payment Reference
Usage Evidence
Compliance Evidence
Settlement Calculation
Payout Record
Event Timeline
Communication Record
Prior Decisions
```

原始证据不得被争议流程静默修改或删除。

## 10. Evidence Chain

案件必须建立：

```text
Claim
↓
Source Fact
↓
Evidence Ref
↓
Evidence Integrity / Provenance
↓
Review Finding
↓
Decision
↓
Enforcement
↓
Compensation / Adjustment
```

证据引用失效、缺失或不可验证时，不得假设其为真实。

## 11. Case Admission

进入 `OPEN` 至少验证：

```text
Case Identity
+ Claimant / Respondent
+ Source Fact
+ Issue Classification
+ Minimum Evidence
+ Conflict / Duplicate Check
```

无法确认基础身份或来源事实时进入 `ADMISSION_REVIEW`、`REVIEW` 或 `BLOCKED`，不得自动确认有效责任案件。

## 12. Duplicate / Related Case Handling

相同或高度相关案件必须支持：

```text
Duplicate
Related Case
Parent Case
Child Case
Merged Case
Split Case
```

合并案件不得丢失原始 caseId 与 Evidence lineage。

## 13. Review

Review 至少区分：

```text
FACT_CONFIRMED
FACT_UNCONFIRMED
PARTIALLY_CONFIRMED
CONFLICTING_EVIDENCE
INSUFFICIENT_EVIDENCE
NO_VIOLATION_FOUND
```

`Claim Submitted` 不得直接转换为 `FACT_CONFIRMED`。

## 14. Negotiation / Mediation

双方可以通过：

```text
Direct Negotiation
Platform Mediation
Third-party Mediation
```

达成：

```text
Settlement Agreement
Remediation Plan
Usage Restriction
Payment Adjustment
License Amendment
Withdrawal
```

协商结果必须保留参与方、版本和证据引用。

## 15. Decision

正式 Decision 至少包含：

```text
decisionId
caseId
decisionType
factsEstablished
factsRejected
scope
reasoningReference
authority
remedy
effectiveAt
appealWindow
evidenceRefs
```

Decision 不是自动生成新的 Rights 或 License Authority。

## 16. Decision Outcomes

标准结果：

```text
NO_VIOLATION
PARTIALLY_UPHELD
UPHELD
DISMISSED
SETTLED
REMEDIATION_REQUIRED
LICENSE_RESTRICTED
LICENSE_SUSPENDED
LICENSE_REVOKED
PAYOUT_ADJUSTMENT
SETTLEMENT_ADJUSTMENT
ACCOUNT_ACTION
ESCALATE_LEGAL
```

需要跨域执行时必须创建对应的正式执行动作。

## 17. Appeal / Reopening

必须支持：

```text
Appeal
Review Request
Reopen
New Evidence
Material New Fact
```

Reopen 不得覆盖旧 Decision，应建立新的 Decision Version / Review Event。

## 18. Enforcement

Decision 执行可以包含：

```text
License Restriction
License Suspension
License Revocation
Order Cancellation
Usage Takedown / Restriction
Payout Hold
Payout Release
Settlement Adjustment
Compensation
Account Restriction
```

每个执行动作必须关联 Decision 与执行证据。

## 19. Compensation / Adjustment

争议导致经济调整时：

```text
Original Settlement / Payout
→ Adjustment Assessment
→ Approved Adjustment
→ New Settlement / Payout Instruction
→ Financial Authority
→ Reconciliation
```

不得直接修改历史 Settlement、Payout 或 Ledger Fact。

## 20. License Impact

案件可能影响 License：

```text
No Impact
Scope Restriction
Temporary Suspension
Revocation
Renewal Block
Expansion Block
Revalidation Required
```

任何 License 最终状态变化必须由 License Authority 正式确认。

## 21. Rights Impact

如果案件涉及 Rights：

```text
Rights Recheck
→ Conflict Assessment
→ Scope Recalculation
→ Affected SKU Identification
→ Affected License Identification
→ Revalidation
```

Dispute Coordinator 不得自行宣布权利归属。

## 22. Trade Impact Propagation

案件发现 Material Impact 后，应能够定位：

```text
IP
SKU
Buyer
Licensor
Order
Agreement
License
Usage
Settlement
Payout
```

受影响对象必须进入相应 Recheck / Hold / Review 流程。

## 23. SLA / Severity

案件应支持至少：

```text
LOW
MEDIUM
HIGH
CRITICAL
```

并定义：

```text
ackDeadline
reviewDeadline
decisionTarget
appealWindow
recheckInterval
```

关键案件不得因普通队列延迟而无限悬置。

## 24. Idempotency

相同：

```text
caseId
+ actionType
+ actionFingerprint
```

不得产生重复 Enforcement、Adjustment、Payout Hold 或 Compensation 经济事实。

## 25. Event Semantics

关键事件至少包含：

```text
eventId
caseId
tradeId
aggregateId
aggregateVersion
causationId
correlationId
occurredAt
```

示例：

```text
CASE_OPENED
CLAIM_SUBMITTED
EVIDENCE_PRESERVED
CASE_REVIEW_STARTED
CASE_DECIDED
ENFORCEMENT_STARTED
COMPENSATION_APPROVED
CASE_RESOLVED
CASE_CLOSED
CASE_REOPENED
```

## 26. Audit

案件全过程至少回答：

```text
Who reported?
Who reviewed?
What facts were confirmed?
Which evidence supported them?
Which authority decided?
What action was executed?
What financial / license impact occurred?
Who approved overrides?
When was the case closed?
```

## 27. Historical Immutability

以下均保留不可变历史：

```text
Original Claim
Evidence References
Review Findings
Decision
Appeal
Enforcement Action
Compensation Decision
Settlement Adjustment
Closure Record
```

更正通过新事件、版本或 Adjustment 表达。

## 28. Machine Invariants

### I1
`CLAIM_SUBMITTED ≠ FACT_CONFIRMED`。

### I2
案件必须能关联至少一个可信 Source Fact 或进入 Admission Review。

### I3
Evidence 缺失或不可验证时不得自动判定责任成立。

### I4
重大案件可以触发临时 Hold，但 Hold ≠ Final Decision。

### I5
Decision 必须引用 Decision Authority 与 Evidence。

### I6
Enforcement 必须引用有效 Decision。

### I7
历史 Decision 不得被新 Appeal / Reopen 覆盖。

### I8
Compensation / Adjustment 不得修改历史金融事实。

### I9
License 状态变化必须由 License Authority 确认。

### I10
Rights 争议不得由 Dispute Coordinator 自行确定权利归属。

### I11
相关案件合并 / 拆分必须保留全部原始 caseId lineage。

### I12
UNKNOWN ≠ UPHELD ≠ ENFORCED ≠ FINANCIAL_FINAL。

### I13
重复 Enforcement / Compensation 必须幂等。

### I14
Material Case Impact 必须传播到受影响 IP / SKU / License / Settlement / Payout。

### I15
案件关闭前必须完成规定的 Enforcement、Compensation、Reconciliation 与 Evidence Closure。

## 29. L5 Execution Units

```text
L5-IP-222-CASE-DETECTION
L5-IP-222-CASE-ADMISSION
L5-IP-222-DUPLICATE-RELATIONSHIP
L5-IP-222-NOTICE
L5-IP-222-CLAIM
L5-IP-222-EVIDENCE-PRESERVATION
L5-IP-222-REVIEW
L5-IP-222-NEGOTIATION
L5-IP-222-MEDIATION
L5-IP-222-DECISION
L5-IP-222-APPEAL
L5-IP-222-REOPEN
L5-IP-222-ENFORCEMENT
L5-IP-222-LICENSE-IMPACT
L5-IP-222-RIGHTS-IMPACT
L5-IP-222-TRADE-IMPACT-PROPAGATION
L5-IP-222-COMPENSATION
L5-IP-222-ADJUSTMENT
L5-IP-222-RECONCILIATION
L5-IP-222-SLA
L5-IP-222-IDEMPOTENCY
L5-IP-222-EVIDENCE-CLOSURE
L5-IP-222-AUDIT
```

## 30. L6 Acceptance Atoms

### L6-IP-222-001
Every formal case has a stable caseId.

### L6-IP-222-002
Case references preserve originating trade identity where applicable.

### L6-IP-222-003
Claim submission preserves claimant and respondent identity.

### L6-IP-222-004
Claim does not automatically become confirmed fact.

### L6-IP-222-005
Minimum evidence is checked before standard case admission.

### L6-IP-222-006
Evidence references are preserved immutably.

### L6-IP-222-007
Duplicate and related cases retain lineage.

### L6-IP-222-008
Temporary holds have actor, reason, authority and time boundaries.

### L6-IP-222-009
Review findings distinguish confirmed, unconfirmed and conflicting evidence.

### L6-IP-222-010
Decision records reference authority and supporting evidence.

### L6-IP-222-011
Appeals create new decision lineage instead of overwriting history.

### L6-IP-222-012
Enforcement actions reference a valid decision.

### L6-IP-222-013
License impacts are delegated to License Authority.

### L6-IP-222-014
Rights impacts trigger Rights recheck.

### L6-IP-222-015
Material trade impact identifies affected downstream objects.

### L6-IP-222-016
Compensation references the original economic fact.

### L6-IP-222-017
Settlement adjustments do not rewrite historical settlement facts.

### L6-IP-222-018
Payout actions remain subject to Financial Authority.

### L6-IP-222-019
Unknown payment or financial result enters reconciliation rather than blind retry.

### L6-IP-222-020
Case closure requires required enforcement and reconciliation completion.

## 31. Non-Goals

本合同不负责：

```text
Judicial Decision
Arbitration Provider Implementation
Payment Network
Accounting Ledger Implementation
Rights Ownership Determination
```

## 32. Implementation Gate

在以下条件全部满足前，不允许实现代码：

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
