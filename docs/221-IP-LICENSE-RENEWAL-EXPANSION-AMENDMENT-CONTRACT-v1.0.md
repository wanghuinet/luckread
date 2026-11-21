# LuckRead IP License Renewal / Expansion / Amendment Contract v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同补齐 IP Center 的 P0 持续商业生命周期：

```text
Active License
→ Renewal Eligibility
→ Renewal Offer
→ Renewal Decision
→ Expansion / Upsell
→ Amendment
→ Revalidation
→ Re-approval / Re-sign where required
→ Updated License
→ Updated Authorization
→ Updated Settlement / Payout
```

目标是保证一次授权交易完成后，不需要把历史交易事实删除重建，而是以版本化方式持续经营同一 License 生命周期。

本合同不创建新的 Rights、Commerce、Agreement、License、Settlement、Ledger 或 Evidence Authority。

## 2. Lifecycle Boundary

本合同负责：

```text
Renewal
Expansion
Amendment
Term Extension
Scope Extension
Territory Extension
Channel Extension
Media Extension
Commercial Scale Change
Exclusivity Change
Price / Royalty Change
```

本合同不负责首次 License 创建；首次交易仍由 208–210 等既有合同负责。

## 3. Canonical Continuity

续约、扩展、变更必须保持：

```text
tradeId
licenseId
agreement lineage
ipId
buyerId
licensorId
```

新的版本必须能关联原始 License，但不得覆盖历史 License Version。

## 4. Renewal Eligibility

进入 Renewal Evaluation 前至少验证：

```text
Current License Active
Current Rights Valid
Current Buyer Eligible
No blocking dispute
No blocking compliance issue
No unresolved material settlement variance
```

任何关键 Authority 为 `UNKNOWN` 时，不得默认允许自动续约。

## 5. Renewal Window

系统应支持明确的 Renewal Window：

```text
NOT_OPEN
OPEN
EXPIRING_SOON
EXPIRED
GRACE
CLOSED
```

Renewal Window 本身不得改变当前 License 权利状态。

## 6. Renewal Offer

Renewal Offer 必须至少包含：

```text
offerId
licenseId
sourceLicenseVersion
term
scopeSnapshot
territory
channel
media
exclusivity
priceVersion
royaltyRuleVersion
validUntil
```

Offer 是商业提案，不等于 Active License。

## 7. Renewal Decision

标准决策：

```text
ACCEPT
REJECT
EXPIRE
REVIEW
BLOCKED
```

`ACCEPT` 只能表示接受续约条件，不自动等同新的 Active License。

## 8. Expansion Model

Expansion 必须明确变化维度：

```text
TERM_EXTENSION
TERRITORY_EXTENSION
CHANNEL_EXTENSION
MEDIA_EXTENSION
PRODUCT_EXTENSION
INDUSTRY_EXTENSION
USAGE_VOLUME_EXTENSION
EXCLUSIVITY_EXTENSION
COMMERCIAL_SCOPE_EXTENSION
```

Expansion 不是修改历史 License，而是创建新 Version / Amendment。

## 9. Scope Safety

任何扩展必须满足：

```text
Requested Expansion
→ Rights Recheck
→ Conflict Recheck
→ Risk / Eligibility Recheck
→ Commercial Recalculation
→ Agreement Update if required
→ License Version Update
```

Scope 扩展不得绕过 Rights Authority。

## 10. Amendment Classification

变更至少分为：

```text
NON_MATERIAL
MATERIAL
PROHIBITED
```

`MATERIAL` 至少包括：

```text
Rights Scope
Territory
Term
Exclusivity
Commercial Scale
Royalty
Fee
Buyer / Licensor Identity
Channel
Media
Usage Restrictions
```

Material Amendment 必须重新执行受影响准入与验证。

## 11. Amendment Versioning

每次 Amendment 至少关联：

```text
amendmentId
baseLicenseVersion
requestedChanges
approvedChanges
rejectedChanges
approvalRefs
agreementVersion?
scopeVersion
pricingVersion
rightsCheckRef
riskCheckRef
status
```

历史 Agreement / License Version 不得重写。

## 12. Revalidation Matrix

```text
Renewal
→ Rights + Eligibility + Risk + Commercial

Expansion
→ Rights + Conflict + Eligibility + Risk + Commercial

Material Amendment
→ Rights + Scope + Agreement + Risk + Compliance

Non-material Amendment
→ Contract-defined minimal validation
```

实际重查范围由变更类型决定，但不能少于必要 Authority。

## 13. Agreement / E-Sign Boundary

需要法律文本变化时：

```text
Amendment
→ Agreement Version
→ Approval
→ E-Sign where required
→ Signature Evidence
```

交易协调层不得伪造签署事实。

## 14. Price / Royalty Recalculation

续约或扩展导致商业条件变化时，必须使用新版本：

```text
priceVersion
royaltyRuleVersion
commissionRuleVersion
settlementRuleVersion
```

新规则不得回写历史 Settlement。

## 15. License Activation

新 License Version 进入 `ACTIVE` 前必须满足合同规定的条件：

```text
Rights Valid
+ Required Agreement Valid
+ Required Signature Complete
+ Required Commercial Conditions Met
+ Required Compliance Conditions Met
```

`Renewal Accepted`、`Amendment Approved`、`Payment Requested` 都不能单独代表 Active License。

## 16. Authorization Continuity

新的 License Version 生效后：

```text
License Version
→ Authorization Record
→ Authorization Certificate where applicable
```

旧 Certificate 必须保持历史状态；不得被静默修改为新范围。

## 17. Settlement / Payout Impact

以下变化必须评估商业影响：

```text
Price Change
Royalty Change
Commission Change
Term Change
Usage Scale Change
Scope Change
```

必要时产生：

```text
Settlement Recalculation
Adjustment
New Statement Version
Payout Impact
```

最终财务事实仍由 Commerce / Wallet / Ledger Authority 确认。

## 18. Expiry and Grace

License 到期后状态必须明确：

```text
ACTIVE
→ EXPIRING
→ EXPIRED
→ GRACE (if contractually allowed)
→ CLOSED
```

Grace 期间的可用范围必须有明确 Contract Snapshot，不能默认等同原 ACTIVE 全量权限。

## 19. Non-Renewal

不续约时：

```text
Renewal Rejected / Expired
→ Commercial Close
→ License Expiry
→ Authorization Impact
→ Usage Restriction where required
→ Settlement / Payout Completion
→ Historical Retention
```

历史交易、历史 License、历史 Settlement 不得删除。

## 20. Revocation Interaction

如果原 License 被 Revoked：

```text
Revoked License
→ Renewal Blocked
→ Expansion Blocked
→ Material Amendment Blocked
```

任何新商业动作必须重新通过相应 Rights / Risk / Admission 流程。

## 21. Conflict Handling

如果 Expansion / Renewal 产生新的 Exclusivity / Territory / Channel 冲突：

```text
CONFLICT
→ REVIEW / BLOCKED
```

不得因为客户续约历史存在而自动覆盖新冲突。

## 22. Idempotency

相同：

```text
licenseId
+ baseLicenseVersion
+ changeRequestFingerprint
```

不得生成重复 Renewal / Expansion / Amendment 经济事实。

重试必须安全归并到同一操作。

## 23. Event Semantics

关键事件至少包含：

```text
eventId
tradeId
licenseId
licenseVersion
operationId
causationId
correlationId
occurredAt
```

示例：

```text
LICENSE_RENEWAL_OPENED
LICENSE_RENEWAL_ACCEPTED
LICENSE_EXPANSION_REQUESTED
LICENSE_AMENDMENT_APPROVED
LICENSE_VERSION_ACTIVATED
LICENSE_VERSION_EXPIRED
```

## 24. Evidence Chain

完整持续生命周期证据：

```text
Original License
↓
Renewal / Change Request
↓
Rights Recheck
↓
Risk / Eligibility Recheck
↓
Commercial Calculation
↓
Approval
↓
Agreement / Signature Evidence
↓
Payment / Conditions
↓
New License Version
↓
Authorization
↓
Updated Settlement / Payout
```

关键节点必须进入 Evidence Registry。

## 25. Machine Invariants

### I1
历史 License Version 不得被续约操作覆盖。

### I2
Renewal Accepted ≠ Active License。

### I3
Expansion 不得绕过 Rights Recheck。

### I4
Material Amendment 必须重新执行必要验证。

### I5
Revoked / Expired License 不得进入标准 Renewal / Expansion。

### I6
新 License Version 必须可追溯到 base License Version。

### I7
Scope Extension 不得超过当前有效 Rights / 新授权范围。

### I8
Price / Royalty 变更必须使用新版本。

### I9
新 Authorization 必须对应新有效 License Version。

### I10
旧 Certificate 不得被静默修改。

### I11
Renewal / Expansion / Amendment 操作必须幂等。

### I12
UNKNOWN Authority 状态不得自动产生新 Active License。

### I13
商业条件变更必须评估 Settlement / Payout Impact。

### I14
历史 Settlement / Payout 不得因新 Version 被重写。

### I15
重大变化必须产生可验证 Evidence Chain。

## 26. L5 Execution Units

```text
L5-IP-221-RENEWAL-ELIGIBILITY
L5-IP-221-RENEWAL-WINDOW
L5-IP-221-RENEWAL-OFFER
L5-IP-221-RENEWAL-DECISION
L5-IP-221-EXPANSION-REQUEST
L5-IP-221-SCOPE-RECHECK
L5-IP-221-RIGHTS-RECHECK
L5-IP-221-CONFLICT-RECHECK
L5-IP-221-AMENDMENT-CLASSIFICATION
L5-IP-221-AMENDMENT-VERSION
L5-IP-221-AGREEMENT-UPDATE
L5-IP-221-E-SIGN-RECHECK
L5-IP-221-PRICE-ROYALTY-RECALCULATION
L5-IP-221-LICENSE-VERSION-ACTIVATION
L5-IP-221-AUTHORIZATION-CONTINUITY
L5-IP-221-SETTLEMENT-PAYOUT-IMPACT
L5-IP-221-EXPIRY-GRACE
L5-IP-221-NON-RENEWAL
L5-IP-221-IDEMPOTENCY
L5-IP-221-EVIDENCE
L5-IP-221-AUDIT
```

## 27. L6 Acceptance Atoms

### L6-IP-221-001
Renewal eligibility references a current active license.

### L6-IP-221-002
Renewal window does not itself grant license rights.

### L6-IP-221-003
Renewal offer snapshots source license version and commercial terms.

### L6-IP-221-004
Renewal acceptance is not equivalent to activation.

### L6-IP-221-005
Expansion request identifies exact changed dimensions.

### L6-IP-221-006
Expansion performs required rights recheck.

### L6-IP-221-007
Expansion performs required conflict recheck.

### L6-IP-221-008
Material amendment triggers required validation.

### L6-IP-221-009
Amendment creates a new immutable version.

### L6-IP-221-010
Historical agreement and license versions remain reconstructable.

### L6-IP-221-011
Price and royalty changes reference new versions.

### L6-IP-221-012
Activation requires all contractually required preconditions.

### L6-IP-221-013
New authorization references the new active license version.

### L6-IP-221-014
Old authorization certificate remains historical.

### L6-IP-221-015
Revoked or expired licenses cannot enter standard renewal automatically.

### L6-IP-221-016
Unknown authority state blocks automatic activation.

### L6-IP-221-017
Commercial changes trigger settlement/payout impact evaluation.

### L6-IP-221-018
Historical settlement facts remain immutable.

### L6-IP-221-019
Renewal and amendment operations are idempotent.

### L6-IP-221-020
Renewal, expansion and amendment decisions are auditable.

## 28. Non-Goals

本合同不负责：

```text
First-sale Trade Admission
Rights Determination
Payment Network
Ledger Implementation
Tax Law Determination
Banking Execution
```

## 29. Implementation Gate

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
