# LuckRead IP Center Unified CL Evidence Bundle Manifest v1.0

**状态：MANIFEST-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本 Manifest 固化 IP Center Unified CL 的唯一输入证据包，承接 229 Evidence Population、230 Evidence Verification、231 Unified CL Preflight Contract、232 Preflight Instance Registry。

本文件是证据包定义，不执行 CL，不生成 PASS 结论，不开始代码实现。

## 2. Single Canonical Bundle

每一次 Unified CL 必须绑定唯一：

```text
bundleId
preflightId
releaseId
contractSetVersion
registryVersion
canonicalIdentityMapVersion
authorityMapVersion
evidenceSnapshotId
compatibilityReportId
reconciliationSnapshotId
correlationId
rootOperationId
```

同一个 `bundleId` 不得静默替换核心输入。

## 3. Required Bundle Sections

| Section | Canonical Input | Required | Blocking |
|---|---|---:|---:|
| B01 Contract Status | 231 + all covered contracts | Yes | Yes |
| B02 L4-L6 Coverage | 182 + 183 + 195-228 | Yes | Yes |
| B03 Authority Map | 64 / 65 / 67 / 68 / domain authorities | Yes | Yes |
| B04 Evidence Registry | 229 | Yes | Yes |
| B05 Evidence Verification | 230 | Yes | Yes |
| B06 Empty Evidence Guard | 229 / 230 / 232 | Yes | Yes |
| B07 State Reconciliation | 217 / 224 / 232 | Yes | Yes |
| B08 Scope Reconciliation | 204 / 208 / 209 / 211 / 219 / 232 | Yes | Yes |
| B09 Version Compatibility | 162 / 175 / 218 / 231 / 232 | Yes | Yes |
| B10 Provider Semantics | 214 / 220 / 230 / 232 | Yes | Yes |
| B11 Closure Conditions | 224 / 225 / 226 / 232 | Yes | Yes |
| B12 Cross-Contract Traceability | 217 / 218 / 224 / 230 | Yes | Yes |
| B13 Known Gap Disposition | 226 / 227 / 228 | Yes | Yes |
| B14 Override Records | 227 / 228 / 232 | Yes | Yes |
| B15 Reconciliation Results | 217 / 218 / 220 / 230 / 232 | Yes | Yes |
| B16 Final Readiness Decision | 231 / 232 | Yes | Yes |

## 4. Evidence Item Contract

Every evidence item must contain:

```text
Evidence ID
Subject ID
Subject Type
Source
Authority
Version
Observed At
Freshness Boundary
Integrity Result
Provenance Result
L6 Mapping
Expected Result
Actual Result
Status
Correlation ID
```

Allowed evidence states:

```text
NOT_REQUIRED
REQUIRED
LOCATED
REFERENCED
VERIFIED
INVALID
MISSING
STALE
CONFLICTING
```

## 5. Evidence-to-L6 Rules

### E1
Every evidence-required L6 must map to at least one evidence item.

### E2
An evidence item may support multiple L6 claims only when the mappings are explicit.

### E3
A missing, stale, invalid, conflicting, or unverified required evidence item blocks the dependent L6.

### E4
Synthetic, default, guessed, or fallback evidence is not valid verification evidence.

### E5
An empty Evidence Registry cannot satisfy any evidence-required L6.

### E6
Evidence from a non-authoritative source cannot establish an authoritative business fact.

### E7
Historical evidence must remain linked to its historical version and observation time.

## 6. Required Cross-Domain Lineage

The bundle must be able to reconstruct:

```text
Canonical Identity
→ Authority
→ Rights / Scope
→ License SKU
→ Buyer Intent / Eligibility / Risk
→ Trade Admission
→ Order
→ Agreement / E-Sign
→ Payment / Settlement
→ License Activation
→ Authorization Certificate
→ Usage
→ Compliance
→ Renewal / Expansion / Amendment / Revocation
→ Dispute
→ Payout / Financial Finality
→ Cross-Contract Reconciliation
→ Evidence
```

A broken mandatory lineage blocks readiness.

## 7. Gate Evaluation Model

Each gate emits exactly one state:

```text
PASS
FAIL
BLOCKED
REVIEW
NOT-APPLICABLE
```

`UNKNOWN`, `UNMAPPED`, `MISSING`, `STALE`, `INVALID`, `CONFLICTING`, `INCOMPATIBLE`, or blocking `VARIANCE` MUST NOT be coerced into PASS.

## 8. Final Readiness Formula

```text
CL-READY
=
Contract Complete
AND Coverage Complete
AND Authority Unique
AND Evidence Verified
AND Evidence Registry Non-Empty
AND State Reconciled
AND Scope Reconciled
AND Versions Compatible
AND Provider Semantics Normalized
AND Closure Conditions Satisfied
AND Traceability Complete
AND Known Gaps Dispositioned
AND Overrides Valid
AND Reconciliation Passing
```

Any false condition yields:

```text
NOT CL-READY
```

## 9. Output Package

Unified CL output must reference the same canonical bundle:

```text
bundleId
preflightId
clRunId
contractSetVersion
inputSnapshotHash
coverageResult
authorityResult
evidenceResult
stateResult
scopeResult
compatibilityResult
providerResult
closureResult
traceabilityResult
gapResult
overrideResult
reconciliationResult
finalDecision
failureCodes
blockingItems
reviewItems
```

## 10. Reproducibility Requirements

A CL result is reproducible only when the following remain recoverable:

```text
Manifest
Contract Versions
Registry Versions
Input Snapshot IDs
Evidence IDs
Evidence Versions
Authority Versions
Compatibility Report
Reconciliation Snapshot
Final Decision
```

The final decision cannot depend on an untracked mutable snapshot.

## 11. Admission Boundary

```text
Evidence Bundle Complete
→ Evidence Verified
→ 231 Preflight
→ 232 Instance Registry
→ Unified CL
```

The following are explicitly outside this Manifest's authority:

```text
Business transaction authorization
Financial finality
License issuance
Production acceptance
Runtime health
CI success
```

## 12. Current Disposition

IP Center business contract expansion is closed.

This Manifest closes the missing **single-input-bundle governance layer** between evidence verification and Unified CL execution.

Fixed path:

```text
Populate Evidence
→ Verify Evidence
→ Assemble Manifest 233
→ Validate 231/232
→ Unified CL
→ Implementation Admission
→ Implementation
→ CI
→ Runtime Verification
→ Production Acceptance
```

Current state:

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
