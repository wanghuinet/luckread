# LuckRead IP Center Evidence Population and Unified CL Preparation L5-L6 Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表完成 IP Center 实现前最后一层证据准备，将 `228 Implementation Admission Instance Registry` 的每个准入单元映射到：

```text
L5
→ L6
→ Evidence Requirement
→ Authority Reference
→ Expected Result
→ Unified CL Input
```

本文件不运行 CL，不创建新的业务 Authority，也不开始代码实现。

## 2. Covered Scope

```text
219 Asset Lifecycle
220 Payout / Financial Finality
221 Renewal / Expansion / Amendment
222 Dispute / Claims / Resolution
223 Commercial Growth / IP Value
224 Master Closure
225 Master Closure Instance Registry
226 Reverse Coverage Audit
227 Implementation Admission Checklist
228 Implementation Admission Instance Registry
```

## 3. Evidence State Model

统一 Evidence 状态：

```text
NOT_REQUIRED
REQUIRED
REFERENCED
VERIFIED
INVALID
MISSING
STALE
CONFLICTING
```

终态规则：

```text
REQUIRED + MISSING
→ NOT PASSABLE

REQUIRED + INVALID
→ NOT PASSABLE

REQUIRED + STALE
→ NOT PASSABLE

REQUIRED + CONFLICTING
→ REVIEW / BLOCKED
```

## 4. Canonical Evidence Record

每项 Evidence 至少具备：

```text
evidenceId
evidenceType
sourceAuthority
subjectId
subjectVersion?
sourceReference
integrityReference?
provenanceReference?
capturedAt
validFrom?
validUntil?
status
correlationId
```

历史 Evidence 不得被新证据静默覆盖。

## 5. L5 Evidence Mapping

| L5 | Evidence Requirement | Authority | Blocking |
|---|---|---|---|
| L5-IP-229-G01-PORTFOLIO | Portfolio/IP/Rights lineage | IP/Rights Authority | Yes |
| L5-IP-229-G02-REPRESENTATION | Principal/delegation/expiry/revocation | Rights/Eligibility Authority | Yes |
| L5-IP-229-G03-TAX | Tax/withholding reference | Tax/Financial Authority | Yes |
| L5-IP-229-G04-BENEFICIARY | Change + hold + snapshot evidence | Financial/Payout Authority | Yes |
| L5-IP-229-G07-RETIREMENT | Closure blockers + retention evidence | IP/License/Compliance/Financial Authorities | Yes |
| L5-IP-229-G08-PRIVACY | Global privacy/data lifecycle references | Cross-Cutting Privacy Authority | Yes |
| L5-IP-229-G09-PROVIDER | Normalized provider result evidence | Provider / Domain Authority | Yes |
| L5-IP-229-G10-COMPATIBILITY | Contract/event/evidence compatibility report | Governance Authority | Yes |
| L5-IP-229-EVIDENCE-GATE | Evidence Registry mapping | Evidence Authority | Yes |
| L5-IP-229-OVERRIDE-GUARD | Actor/reason/evidence/expiry | Governance Authority | Yes |
| L5-IP-229-FINAL-GATE | Complete admission package | Governance Authority | Yes |

## 6. L6 Evidence Atomic Units

### L6-IP-229-001
Every mandatory admission result has a declared evidence requirement.

### L6-IP-229-002
Evidence-required item cannot PASS when registry mapping is missing.

### L6-IP-229-003
Portfolio composition evidence can reconstruct IP and rights relationships.

### L6-IP-229-004
Representation evidence proves principal, delegation scope, expiry and revocation state.

### L6-IP-229-005
Tax evidence identifies authoritative tax/financial source.

### L6-IP-229-006
Unknown tax evidence blocks automatic payout readiness.

### L6-IP-229-007
Beneficiary change evidence can identify affected pending payouts.

### L6-IP-229-008
Historical beneficiary snapshots remain verifiable.

### L6-IP-229-009
Permanent closure evidence proves all declared blockers are resolved.

### L6-IP-229-010
Privacy evidence points to global lifecycle controls.

### L6-IP-229-011
Provider evidence distinguishes accepted, processing, confirmed, unknown and failed.

### L6-IP-229-012
Unknown provider results are routed to reconciliation evidence.

### L6-IP-229-013
Compatibility evidence covers contract versions, events and L5/L6 identifiers.

### L6-IP-229-014
Evidence-required claims have valid Evidence Registry references.

### L6-IP-229-015
Manual override evidence contains actor, reason, scope and expiry/review boundary.

### L6-IP-229-016
Final readiness evidence is reconstructable from canonical IDs and authority references.

## 7. Evidence Freshness

Evidence must distinguish:

```text
CURRENT
STALE
EXPIRED
SUPERSEDED
INVALID
```

权利、代理、税务、支付、Provider 状态等具有有效期的证据不能因历史存在而永久视为当前有效。

## 8. Evidence Conflict

当同一事实出现冲突 Evidence：

```text
Evidence A ≠ Evidence B
        ↓
CONFLICTING
        ↓
REVIEW / BLOCKED
```

不得由低权威来源自动覆盖高权威来源。

## 9. Source Authority Rule

Evidence 的可信度必须能够追溯至 Source Authority：

```text
Rights Fact → Rights Authority
Financial Fact → Financial / Ledger Authority
License Fact → License Authority
Compliance Fact → Compliance Authority
Growth Metric → Analytics / Growth Authority
```

IP Center 只引用这些事实，不重新定义其权威。

## 10. Unified CL Input Package

后续 Unified CL 的 IP Center 输入包固定为：

```text
Contract Set
Instance Registry Set
Evidence Registry Mapping
Authority References
Cross-Contract Matrix
L6 Expected Results
Known Gaps
Override Records
Compatibility Result
```

## 11. CL Result Vocabulary

Unified CL 对 IP Center 至少支持：

```text
PASS
FAIL
BLOCKED
REVIEW
UNKNOWN
UNMAPPED
INCOMPATIBLE
NOT-APPLICABLE
```

其中：

```text
UNKNOWN ≠ PASS
UNMAPPED ≠ PASS
INCOMPATIBLE ≠ PASS
```

## 12. Pre-CL Invariants

### I1
No evidence-required L6 may be considered passable without Evidence Registry mapping.

### I2
Evidence Registry empty state cannot generate automatic PASS.

### I3
Stale or expired evidence cannot satisfy current-state verification.

### I4
Conflicting authoritative evidence requires REVIEW or BLOCKED.

### I5
Every final business state has a Source Authority reference.

### I6
Historical evidence remains immutable and reconstructable.

### I7
Manual overrides require bounded, auditable evidence.

### I8
The Unified CL input package is reconstructable from canonical IDs.

### I9
Cross-contract compatibility results are part of the implementation gate.

### I10
This registry does not itself assert PASS; it defines inputs and requirements for CL.

## 13. Readiness State Machine

```text
INSTANCE-REGISTERED
→ EVIDENCE-REQUIRED
→ EVIDENCE-REFERENCED
→ EVIDENCE-VERIFIED
→ AUTHORITY-VERIFIED
→ CL-READY
→ IMPLEMENTATION-READY
```

异常：

```text
MISSING
STALE
INVALID
CONFLICTING
UNKNOWN
UNMAPPED
INCOMPATIBLE
```

## 14. Cross-Registry Traceability

```text
226 Reverse Audit
→ 227 Admission Checklist
→ 228 Admission Instance Registry
→ 229 Evidence Population Registry
→ 176 Evidence Registry
→ Unified CL
```

同时：

```text
219–225 lifecycle instances
→ 229 evidence inputs
→ final implementation gate
```

## 15. Implementation Gate

进入代码实现前，IP Center 必须满足：

```text
227 = COMPLETE
228 = REGISTERED
229 = COMPLETE
Evidence Mapping = COMPLETE
Authority References = COMPLETE
Known Blocking Gaps = NONE
Compatibility = PASS
Unified CL = PASS
```

注意：本文件只定义 CL 输入与证据要求；当前 Unified CL 尚未运行。

## 16. Final Disposition

IP Center 后续不再新增业务合同或业务 Authority。

仅允许按固定顺序推进：

```text
Evidence Population
→ Evidence Verification
→ Unified CL
→ Implementation
→ CI
→ Production Acceptance
```

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
