# LuckRead IP Asset Lifecycle and Rights Change Contract v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同补齐 IP Center 的 P0 Asset Lifecycle 闭环。

目标：把 IP 从入驻、身份确认、权利验证、商业化、持续运营直到权利变化、到期、撤销、重新验证统一到一个不可跳过的生命周期模型。

本合同不创建新的 Rights Authority、Commerce Authority、Ledger Authority、License Authority 或 Evidence Authority。

## 2. Lifecycle Master Chain

```text
IP Admission
→ IP Identity
→ Rights Provenance
→ Rights Verification
→ Sellable Scope
→ Portfolio
→ Catalog / SKU
→ Commercial Activity
→ Rights Change Detection
→ Revalidation
→ Renewal / Amendment / Restriction
→ Expiry / Revocation
→ De-list / Suspend
→ Re-admission / Reverification
```

任何阶段发生 Material Change，都必须能够定位受影响的 IP、Rights、SKU、License 与交易。

## 3. Authority Boundary

| Domain | Authority |
|---|---|
| IP Identity | IP / Entity authority defined by platform |
| Rights Fact | Rights Authority |
| Licensor Eligibility | Licensor / Buyer Authority as applicable |
| Risk Decision | Risk / Trust Authority |
| SKU / Pricing | IP Trading catalog/pricing contracts |
| Trade Admission | Trade Admission Authority |
| Order | Commerce Authority |
| Agreement / E-Sign | Agreement / E-Sign Authority |
| License | License Authority |
| Usage / Compliance | Compliance Authority |
| Settlement | Settlement / Commerce Authority |
| Financial Finality | Ledger / Wallet Authority |
| Evidence | Evidence Registry |

IP Asset Lifecycle is coordination and lifecycle control, not a replacement authority.

## 4. Canonical IP Asset Record

每个 IP Asset 至少能够关联：

```text
ipId
ipVersion
entityId
ownerId
licensorId?
portfolioId?
rightsProfileId
provenanceId
verificationId
sellableScopeVersion?
status
riskState?
createdAt
updatedAt
correlationId
```

历史 IP Version 不得被当前版本静默覆盖。

## 5. Lifecycle States

标准生命周期状态：

```text
DRAFT
SUBMITTED
IDENTITY_PENDING
RIGHTS_PENDING
VERIFICATION_PENDING
VERIFIED
COMMERCIAL_READY
ACTIVE
RESTRICTED
SUSPENDED
DISPUTED
EXPIRING
EXPIRED
REVOKED
DELISTED
REVERIFICATION_REQUIRED
CLOSED
```

状态转换必须满足明确的前置条件，不允许任意状态跳转。

## 6. Admission Rules

进入 `VERIFIED` 必须满足：

```text
Identity Evidence
+ Rights Evidence
+ Provenance
+ Verification Decision
```

进入 `COMMERCIAL_READY` 必须额外满足：

```text
Sellable Scope
+ Conflict Check
+ Required Risk Checks
+ Required Commercial Metadata
```

进入 `ACTIVE` 必须有明确的正式状态来源。

## 7. Portfolio Semantics

一个 IP 可以属于多个 Portfolio，但 Portfolio 不得成为 Rights Authority。

```text
Portfolio
→ organize / compare / operate

Rights Authority
→ determine legal rights
```

Portfolio 调整不得自动改变法律权利范围。

## 8. Rights Change Detection

必须识别至少：

```text
Ownership Change
Co-owner Change
Agent Change
Authorization Change
Territory Change
Term Change
Media Change
Channel Change
Exclusivity Change
Restriction Change
License Conflict
Dispute / Claim
Registration Status Change
```

检测到变化后必须生成可追踪的 `rightsChangeId`。

## 9. Material Rights Change

下列变化均默认属于 Material Change：

```text
Right Holder
Authority Basis
Territory
Term
Exclusivity
Usage Type
Commercial Scope
Channel
Media
Restriction
Revocation
Confirmed Conflict
```

Material Change 必须触发受影响 SKU、Quote、Admission、Order、Agreement、License、Usage 与 Settlement 的 Impact Assessment。

## 10. Revalidation

```text
Rights Change
→ Impact Assessment
→ Identify Affected Artifacts
→ Freeze New Commercialization when required
→ Revalidate
→ Re-publish / Restrict / Suspend / Delist
```

历史已经完成的合法交易不得因为当前权利变化而被伪造性重写；应依据既有快照和新决定处理影响。

## 11. Commercial Readiness

IP 只有在：

```text
Verified Rights
+ Valid Sellable Scope
+ No Blocking Conflict
+ Required Commercial Metadata
```

全部成立时，才能进入 `COMMERCIAL_READY`。

推荐、曝光、收藏等体验信号不得替代这些准入条件。

## 12. SKU Relationship

SKU 必须引用 IP 的稳定版本与权利范围：

```text
ipId
ipVersion
rightsProfileId
rightsVersion
scopeVersion
skuVersion
```

IP 新版本产生后，旧 SKU 不得被静默修改。

## 13. Active License Impact

权利发生变化时必须能够分类：

```text
NO_IMPACT
DISPLAY_ONLY
REVALIDATE
RESTRICT
SUSPEND
REVOKE
MANUAL_REVIEW
```

具体处置由 Rights / License / Compliance Authority 决定。

IP Asset Lifecycle 不自行创造法律结论。

## 14. Expiry

权利或授权到期必须明确区分：

```text
EXPIRING
EXPIRED
GRACE
RENEWAL_PENDING
RENEWED
```

到期不能被当作正常 ACTIVE 使用。

新的商业化活动必须检查当前有效期。

## 15. Revocation

撤销必须支持：

```text
Revocation Event
→ Effective Time
→ Scope
→ Reason
→ Authority
→ Evidence
→ Impact Assessment
→ Enforcement
```

撤销后不能继续签发新的受影响授权。

## 16. Suspension

Suspension 用于处理：

```text
Pending Verification
Risk Escalation
Rights Conflict
Compliance Incident
Dispute
Operational Protection
```

Suspended IP 不应继续被系统当作正常可交易资产。

## 17. De-listing

`DELISTED` 是平台商业展示状态，不等于法律权利消灭。

因此：

```text
DELISTED ≠ REVOKED RIGHTS
DELISTED ≠ EXPIRED RIGHTS
```

两者必须独立记录。

## 18. Re-admission

被 Suspended / Delisted / Revalidation Required 的 IP，在重新进入商业可用状态前必须重新满足相应准入条件。

```text
New Evidence
+ New Verification
+ Current Rights
+ Current Risk
→ Re-admission Decision
```

不能仅通过恢复旧缓存完成重新启用。

## 19. Historical Immutability

不可变历史事实包括：

```text
IP Version
Rights Evidence Snapshot
Verification Decision
Sellable Scope Snapshot
SKU Version
Trade Admission
Order
Agreement
License
Revocation Decision
Settlement Snapshot
```

修正必须通过新版本、Adjustment 或新 Decision 表达。

## 20. Cross-domain Event Requirements

关键生命周期事件至少包含：

```text
eventId
ipId
ipVersion
eventType
occurredAt
effectiveAt
actorId
authorityRef
evidenceRefs
correlationId
causationId
```

事件必须支持幂等处理和重放。

## 21. Cache Boundary

允许缓存：

```text
Search Metadata
Display Metadata
Non-authoritative Presentation State
```

不得使用缓存绕过实时检查：

```text
Rights Validity
Revocation
Expiry
Conflict
License Validity
Risk Block
```

## 22. Failure Safety

当 Rights / Verification / Evidence 状态未知时：

```text
UNKNOWN
≠ VERIFIED
≠ COMMERCIAL_READY
≠ ACTIVE
```

系统应进入 `REVALIDATION_REQUIRED`、`RESTRICTED`、`SUSPENDED` 或 `MANUAL_REVIEW` 等安全状态。

## 23. Lifecycle Consistency

必须始终满足：

```text
Current IP Version
→ Current Rights Version
→ Current Sellable Scope
→ Current Commercial Readiness
```

任何断链必须可被检测。

## 24. IP Impact Graph

权利变化必须支持影响传播：

```text
IP
↓
Rights
↓
SKU
↓
Quote / Intent
↓
Admission
↓
Order
↓
Agreement
↓
License
↓
Usage
↓
Compliance
↓
Settlement
```

系统必须能够回答：

```text
“This rights change affects which commercial artifacts?”
```

## 25. Governance / Override

人工 Override 必须记录：

```text
actor
role
reason
decision
scope
effectiveAt
expiryAt
evidenceRefs
```

Override 不得删除原始事实，也不得绕过最终 Authority。

## 26. Observability

至少提供：

```text
verificationLatency
revalidationRate
suspensionRate
revocationRate
expiryRate
commercialReadinessRate
rightsConflictRate
affectedLicenseCount
```

## 27. Acceptance Invariants

必须满足：

```text
I1: VERIFIED ⇒ current verification evidence exists
I2: COMMERCIAL_READY ⇒ valid sellable scope exists
I3: ACTIVE ⇒ current rights support exists
I4: REVOKED ⇒ new affected issuance blocked
I5: EXPIRED ⇒ new affected commercialization blocked
I6: Material Rights Change ⇒ Impact Assessment exists
I7: Historical IP Version is immutable
I8: Delist does not imply rights revocation
I9: Unknown authority state cannot become VERIFIED
I10: Re-admission requires current validation
I11: SKU Scope ⊆ Sellable Scope
I12: License Scope ⊆ purchased and legally valid scope
I13: Rights change can locate affected licenses
I14: Manual override has actor + reason + evidence
I15: Lifecycle events are idempotent
```

## 28. L5/L6 Admission Requirement

本合同进入实施前必须生成：

```text
L4-219 IP Asset Lifecycle
→ L5 Lifecycle Execution Units
→ L6 Verification Atomic Units
→ Evidence Registry mappings
→ Machine Admission Rules
```

不存在完整 L5/L6/evidence mapping 时，`IMPLEMENTATION = BLOCKED`。

## 29. Non-goals

本合同不负责：

```text
Pricing Formula
Order Creation
Payment Processing
Ledger Posting
Legal Judgment
Recommendation Ranking
```

这些能力继续由现有合同及对应 Authority 负责。

## 30. Final State

```text
IP Asset
→ Rights
→ Verification
→ Commercialization
→ Change Detection
→ Impact Assessment
→ Revalidation
→ Restrict / Suspend / Revoke / Expire
→ Re-admission
→ Commercialization
```

形成完整、可审计、可恢复、可重建的 IP Asset Lifecycle 闭环。

**IMPLEMENTATION = PENDING**
**CL = NOT RUN**
**CI = NOT RUN**
