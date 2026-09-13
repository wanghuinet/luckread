# LuckRead IP Center Evidence Verification Gate v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同是 IP Center 在 Unified CL 之前的最终 Evidence Verification Gate。

目标：把 229 中定义的 Evidence Requirement 转换为可机械判断的验证流程：

```text
Evidence Required
→ Evidence Located
→ Source Authority Verified
→ Subject / Version Matched
→ Freshness Checked
→ Integrity / Provenance Checked
→ L6 Coverage Checked
→ PASS / FAIL / REVIEW / BLOCKED
```

本合同不新增业务 Authority，不创建新的业务域，不运行 Unified CL。

## 2. Evidence Verification Boundary

Evidence Gate 只判断“证据是否足以支持指定 L6 Claim”，不直接创造业务事实。

```text
Evidence Gate
≠ Rights Authority
≠ License Authority
≠ Commerce Authority
≠ Financial Authority
≠ Risk Authority
≠ Recommendation Authority
```

## 3. Canonical Verification Record

每次 Evidence Verification 至少具备：

```text
evidenceVerificationId
evidenceId
evidenceType
l6ClaimId
subjectId
subjectVersion?
sourceAuthority
sourceReference
capturedAt
validFrom?
validUntil?
freshnessStatus
integrityStatus
provenanceStatus
authorityStatus
mappingStatus
result
reason
correlationId
rootOperationId
verifiedAt
```

验证结果必须可重建。

## 4. Verification State Machine

```text
REQUIRED
→ LOCATED
→ AUTHORITY_CHECKED
→ SUBJECT_CHECKED
→ VERSION_CHECKED
→ FRESHNESS_CHECKED
→ INTEGRITY_CHECKED
→ PROVENANCE_CHECKED
→ L6_MAPPED
→ VERIFIED
```

异常状态：

```text
MISSING
INVALID
STALE
EXPIRED
CONFLICTING
UNAUTHORIZED_SOURCE
SUBJECT_MISMATCH
VERSION_MISMATCH
UNMAPPED
UNKNOWN
```

任何异常状态不得自动成为 `VERIFIED`。

## 5. Source Authority Verification

证据来源必须能定位至明确 Authority：

```text
Rights Fact → Rights Authority
License Fact → License Authority
Commerce Fact → Commerce Authority
Financial Fact → Financial / Ledger Authority
Compliance Fact → Compliance Authority
Growth Metric → Analytics / Growth Authority
```

仅凭低权威缓存、用户自述或未验证外部返回值，不得替代正式 Authority。

## 6. Subject Matching

Evidence 必须与目标 Subject 匹配：

```text
subjectId
subjectType
subjectVersion?
```

例如：

```text
IP Evidence → same IP
License Evidence → same License Version
Payout Evidence → same Payout Instruction / Payment Reference
Dispute Evidence → same Case
```

主体不一致时：

```text
SUBJECT_MISMATCH
→ FAIL / BLOCKED
```

## 7. Version Matching

当 L6 Claim 要求版本确定时，Evidence 必须能够证明：

```text
Expected Version
↔ Evidence Subject Version
```

当前版本证据不得自动证明历史版本。

历史版本证据也不得自动证明当前版本，除非合同明确允许。

## 8. Freshness

Evidence freshness 标准：

```text
CURRENT
STALE
EXPIRED
SUPERSEDED
UNKNOWN
```

具有时效性的：

```text
Rights
Delegation
Tax
Eligibility
Risk
Payment
Provider Status
License
```

必须检查当前有效窗口。

## 9. Integrity

能够验证完整性的 Evidence 至少支持：

```text
hash / document fingerprint
source reference
capture timestamp
immutable reference where required
```

完整性无法验证时，不得自动 PASS 高风险或最终状态 Claim。

## 10. Provenance

Evidence Provenance 至少能够解释：

```text
Who / What produced it
Where it came from
When captured
Which authority supplied it
Which operation generated it
```

来源链无法解释时进入 `REVIEW` 或 `BLOCKED`。

## 11. L6 Mapping

每个 Evidence-required L6 必须明确：

```text
l6ClaimId
requiredEvidenceType
minimumEvidenceCount?
requiredAuthority
requiredFreshness
requiredIntegrity?
requiredProvenance?
```

同一 Evidence 可以支持多个 L6，但每个 L6 必须独立确认覆盖关系。

## 12. Evidence Sufficiency

Evidence Verification 至少判定：

```text
SUFFICIENT
INSUFFICIENT
CONFLICTING
UNKNOWN
```

`SUFFICIENT` 只表示证据满足该 L6 的证据要求，不代表业务事实整体成立。

## 13. Conflicting Evidence

当存在多个同一事实的冲突证据：

```text
Evidence A
≠
Evidence B
↓
CONFLICTING
↓
REVIEW / BLOCKED
```

不得简单按照最新时间覆盖更高权威来源。

## 14. Evidence Revocation / Invalidation

如果原证据被撤销、失效或发现来源错误：

```text
VERIFIED Evidence
→ INVALIDATED
→ Affected L6 Recheck
→ Affected Lifecycle Recheck
```

不能只修改当前 Evidence Status 而不传播影响。

## 15. Evidence Replacement

新证据替换旧证据必须形成：

```text
Old Evidence
→ Superseded By
→ New Evidence
```

历史证据必须保留，除非全局 Data Lifecycle 合同明确要求合法删除。

## 16. Final-State Evidence Rules

以下状态必须有足够 Evidence：

```text
VERIFIED
AUTHORIZED
ACTIVE
PAYOUT_CONFIRMED
FINANCIAL_FINAL
RESOLVED
CLOSED
IMPLEMENTATION-READY
```

任何需要 Evidence 的最终状态都必须能够沿 Evidence Chain 重建。

## 17. Evidence Empty-State Guard

核心不变量：

```text
Evidence Registry = EMPTY
        ↓
Evidence-required L6 = NOT PASSABLE
        ↓
Final Gate = BLOCKED / NOT READY
```

不得存在“虽然 Evidence Registry 为空，但 Validator 根据默认值 PASS”的路径。

## 18. Unknown Safety

以下均不得自动升级：

```text
MISSING
INVALID
STALE
EXPIRED
CONFLICTING
UNKNOWN
UNMAPPED
```

到：

```text
VERIFIED
PASS
READY
ACTIVE
FINANCIAL_FINAL
```

## 19. Verification Result Model

统一结果：

```text
PASS
FAIL
REVIEW
BLOCKED
UNKNOWN
NOT-APPLICABLE
```

规则：

```text
Evidence-required + no valid evidence
→ FAIL / BLOCKED

Conflicting authoritative evidence
→ REVIEW / BLOCKED

Unknown authority
→ UNKNOWN / BLOCKED
```

## 20. Recheck Triggers

Evidence Verification 必须在以下情况重新执行：

```text
Evidence Expired
Evidence Revoked
Authority Change
Subject Version Change
Material Scope Change
Rights Change
License Change
Payment / Payout State Change
Dispute Decision
Contract Version Change
```

## 21. Auditability

每次验证必须回答：

```text
Which Evidence?
For Which L6?
For Which Subject?
Which Version?
Which Authority?
When Verified?
What Result?
Why?
```

## 22. Machine Invariants

### I1
Evidence-required L6 cannot PASS without valid Evidence Registry mapping.

### I2
Empty Evidence Registry cannot yield PASS for evidence-required claims.

### I3
STALE / EXPIRED evidence cannot satisfy current-state verification.

### I4
Subject mismatch blocks verification.

### I5
Version mismatch blocks verification where version-specific evidence is required.

### I6
Conflicting authoritative evidence requires REVIEW or BLOCKED.

### I7
Unknown authority state cannot produce VERIFIED.

### I8
Evidence invalidation propagates to affected L6 claims.

### I9
Evidence replacement preserves historical lineage.

### I10
Final implementation readiness requires all blocking evidence checks to PASS.

### I11
Verification result is itself auditable and reproducible.

### I12
Manual override cannot silently remove a failed evidence requirement.

## 23. L5 Execution Units

```text
L5-IP-230-EVIDENCE-LOCATE
L5-IP-230-SOURCE-AUTHORITY
L5-IP-230-SUBJECT-MATCH
L5-IP-230-VERSION-MATCH
L5-IP-230-FRESHNESS
L5-IP-230-INTEGRITY
L5-IP-230-PROVENANCE
L5-IP-230-L6-MAPPING
L5-IP-230-SUFFICIENCY
L5-IP-230-CONFLICT
L5-IP-230-INVALIDATION
L5-IP-230-REPLACEMENT
L5-IP-230-FINAL-STATE-GUARD
L5-IP-230-EMPTY-REGISTRY-GUARD
L5-IP-230-UNKNOWN-SAFETY
L5-IP-230-RECHECK
L5-IP-230-AUDIT
L5-IP-230-CL-INPUT
```

## 24. L6 Acceptance Atoms

### L6-IP-230-001
Every evidence-required L6 has explicit evidence requirements.

### L6-IP-230-002
Missing evidence cannot produce PASS.

### L6-IP-230-003
Evidence source authority is identifiable.

### L6-IP-230-004
Evidence subject matches the target claim.

### L6-IP-230-005
Version matching is enforced where required.

### L6-IP-230-006
Current-state claims require current evidence where applicable.

### L6-IP-230-007
Evidence integrity status is explicit.

### L6-IP-230-008
Evidence provenance is explicit where required.

### L6-IP-230-009
Each L6 has a reconstructable evidence mapping.

### L6-IP-230-010
Conflicting evidence does not silently resolve to PASS.

### L6-IP-230-011
Invalidated evidence triggers affected-claim recheck.

### L6-IP-230-012
Replaced evidence preserves historical lineage.

### L6-IP-230-013
Final-state claims have sufficient evidence.

### L6-IP-230-014
Empty Evidence Registry blocks evidence-required finalization.

### L6-IP-230-015
UNKNOWN evidence or authority cannot become VERIFIED automatically.

### L6-IP-230-016
Evidence Verification results are auditable.

### L6-IP-230-017
Evidence checks re-run on declared lifecycle triggers.

### L6-IP-230-018
Manual override does not erase evidence failure history.

### L6-IP-230-019
CL input contains evidence verification results.

### L6-IP-230-020
Implementation readiness requires every blocking evidence gate to pass.

## 25. Unified CL Input

230 输出给 Unified CL 的固定输入：

```text
Evidence Verification Results
Evidence Registry References
Authority Verification Results
L6 Coverage Results
Freshness Results
Integrity Results
Provenance Results
Conflict Results
Invalidation / Recheck Results
Known Blocking Items
```

## 26. Final Implementation Gate

进入 Unified CL 前必须满足：

```text
229 Evidence Requirements = COMPLETE
230 Evidence Verification = COMPLETE
No Missing Blocking Evidence
No Conflicting Blocking Evidence
No Unknown Blocking Authority
No Unmapped Evidence-required L6
```

本文件不宣称上述条件已经 PASS；仅定义验证机制。

## 27. Final Disposition

IP Center 后续不再新增业务合同。

固定顺序：

```text
Populate Evidence
→ Verify Evidence
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
