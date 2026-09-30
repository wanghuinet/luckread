# LuckRead IP Center Implementation Admission Checklist v1.0

**状态：ADMISSION-CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本清单把 `226 L4-L6 IP Center Reverse Coverage Audit` 中剩余的实现前条件固化为唯一准入清单。

目标：

```text
Contract Complete
→ Coverage Complete
→ Instance Complete
→ Evidence Complete
→ Admission Checklist
→ Implementation
```

本清单不新增 IP 业务 Authority，不新增新的业务域，不替代 224/225 Master Closure。

## 2. Mandatory Admission Scope

实现前必须检查：

```text
G01 Portfolio Composition
G02 Multi-Party Rights / Representation
G03 Cross-Border Tax / Withholding Dependency
G04 Beneficiary Change Propagation
G07 IP Retirement / Permanent Closure
G09 External Provider Reconciliation
G10 Cross-Contract Release Compatibility
```

`G08 Privacy / Data Lifecycle` 继续作为全局 Cross-Cutting Dependency，不在 IP Center 创建第二套规则。

## 3. G01 Portfolio Composition

必须能够重建：

```text
Portfolio
→ IP
→ Rights Profile
→ Right Holder / Co-right Holder
→ Licensor / Representative
→ License
→ Commercial Outcome
```

### Acceptance

- Portfolio 只能聚合，不得成为 Rights Authority。
- 每个 Portfolio Member 有稳定 `ipId` / `ipVersion`。
- Co-right Holder 关系可追踪。
- License 与 Portfolio Membership 可反向查询。
- Portfolio 变更不会修改历史交易事实。

## 4. G02 Multi-Party Rights / Representation

必须支持并可验证：

```text
Principal
→ Representative
→ Delegation / Authorization
→ Scope
→ Effective Time
→ Expiry
→ Revocation
```

### Acceptance

- 代理关系必须引用 Principal。
- 代理 Scope 不得超过 Principal 授权 Scope。
- 到期代理不得继续用于标准交易。
- Revoked Delegation 必须传播到受影响 SKU / Admission / License 流程。
- 联合权利人的批准关系必须能够重建。

## 5. G03 Cross-Border Tax / Withholding Dependency

IP Center 只提供交易上下文，不成为税务权威。

必须能够传递：

```text
Party
→ Jurisdiction
→ Tax Classification
→ Withholding Requirement
→ Applicable Tax Reference
→ Tax Evidence
→ Payout Impact
```

### Acceptance

- Tax / withholding 数据来源可识别。
- UNKNOWN Tax State 不得自动放款。
- Tax 变化能够触发 Payout Recheck。
- 历史 Settlement / Payout 保留当时版本。
- 税务最终事实由 Financial / Tax Authority 确认。

## 6. G04 Beneficiary Change Propagation

Beneficiary 资料发生 Material Change 时必须检查：

```text
Beneficiary Profile
→ Pending Allocation
→ Payout Instruction
→ Hold
→ Revalidation
→ Reconciliation
```

### Acceptance

- 已生成的 Payout Instruction 保存 immutable beneficiary snapshot。
- Pending Payout 可以被自动标记为 Recheck / Hold。
- 历史 Payout 不被当前收款资料覆盖。
- 变更具备 actor / reason / evidence。

## 7. G07 IP Retirement / Permanent Closure

最终 `PERMANENTLY_CLOSED` 之前必须满足：

```text
No Active License
+ No Open Dispute
+ No Pending Payout
+ No Blocking Compliance
+ No Required Revalidation
+ Historical Retention Complete
+ Required Evidence Closure Complete
```

### Acceptance

- `DELISTED` 不等于永久关闭。
- `REVOKED` 不等于自动删除历史。
- Permanent Closure 是生命周期终点，不得删除历史证据。
- 发现新合法权利事实时必须通过 Re-admission / Reverification。

## 8. G09 External Provider Reconciliation

所有外部 Provider 必须使用统一结果语义：

```text
REQUEST_ACCEPTED
PROCESSING
CONFIRMED
UNKNOWN
FAILED
```

适用：

```text
Identity Verification
E-Sign
Payment
Payout
Other External Financial / Compliance Provider
```

### Acceptance

- `REQUEST_ACCEPTED ≠ CONFIRMED`。
- `PROVIDER_ACCEPTED ≠ FINANCIAL_FINAL`。
- `UNKNOWN` 必须进入 Query / Reconciliation。
- UNKNOWN 结果不得盲目重复执行可能产生经济后果的操作。
- Provider 状态必须能关联 trade / license / payout / case。

## 9. G10 Cross-Contract Release Compatibility

以下任一契约发生版本升级时，必须执行兼容性检查：

```text
204
205
206
207
208
210
212
214
216
217
218
219
220
221
222
223
224
225
226
227
```

至少检查：

```text
Canonical IDs
Version Lineage
Authority Boundary
Scope Semantics
State Machine
Event Schema
Evidence References
L5/L6 IDs
Closure Conditions
```

### Acceptance

- 单合同升级不得静默破坏下游引用。
- L5/L6 ID 变更必须具有 migration / compatibility 说明。
- Event Schema 变化必须明确 backward / forward compatibility。
- Evidence 引用变化必须保持历史可验证。
- Master Closure 与 Instance Registry 必须同步检查。

## 10. G08 Global Privacy Dependency

IP Center 不定义新的 Privacy Authority。

实现必须引用全局：

```text
Data Lifecycle
Retention
Erasure
Access Control
Privacy
Regional Compliance
```

至少覆盖：

```text
Buyer Data
Licensor Data
Payment Metadata
Dispute Evidence
Commercial Analytics
```

## 11. Unified Pre-Implementation Gate

所有实现代码进入前必须满足：

```text
[PASS] L4 Contract Complete
[PASS] L5 Registry Complete
[PASS] L6 Registry Complete
[PASS] Authority Boundary Complete
[PASS] Evidence Mapping Complete
[PASS] Cross-Contract Traceability Complete
[PASS] G01 Portfolio
[PASS] G02 Representation
[PASS] G03 Tax Dependency
[PASS] G04 Beneficiary Propagation
[PASS] G07 Permanent Closure
[PASS] G08 Global Privacy Dependency
[PASS] G09 Provider Reconciliation
[PASS] G10 Release Compatibility
```

任一项 `FAIL / UNKNOWN / UNMAPPED` 时：

```text
IMPLEMENTATION = BLOCKED
```

## 12. No-Silent-Override Rule

实现准入不得通过人工编辑状态直接绕过失败项。

任何 override 必须记录：

```text
actor
reason
scope
evidence
approval
expiresAt
```

并且不得将：

```text
UNKNOWN
FAIL
UNMAPPED
```

直接转换成：

```text
PASS
READY
ACTIVE
FINANCIAL_FINAL
```

## 13. Evidence Gate

任何 Evidence-required Checklist Item 必须满足：

```text
Evidence Reference
+ Evidence Type
+ Source Authority
+ Integrity / Provenance
+ Expected L6 Coverage
```

当 Evidence Registry 为空时：

```text
Evidence-required Item = NOT PASSABLE
```

## 14. Closure Gate

IP Center 只有在：

```text
No Unresolved P0 Gap
No Orphan L5
No Orphan L6
No Duplicate Authority
No Broken Mandatory Lineage
No Unresolved Blocking Impact
Evidence Gate Satisfied
Release Compatibility Satisfied
```

后才能进入代码实现准入。

## 15. Traceability Matrix

```text
226 G01
→ 227 G01 Checklist

226 G02
→ 227 G02 Checklist

226 G03
→ 227 G03 Checklist

226 G04
→ 227 G04 Checklist

226 G07
→ 227 G07 Checklist

226 G08
→ Global Cross-Cutting Contracts

226 G09
→ 227 G09 Checklist

226 G10
→ 227 G10 Checklist
```

## 16. Machine Invariants

### I1
No implementation-ready state without all mandatory checklist items passing.

### I2
UNKNOWN checklist result cannot produce READY.

### I3
Evidence-required item cannot pass without Evidence Registry mapping.

### I4
Portfolio cannot become Rights Authority.

### I5
Representation scope cannot exceed principal authority.

### I6
Unknown tax state cannot authorize automatic payout.

### I7
Beneficiary change can invalidate pending payout readiness.

### I8
Permanent closure requires declared downstream conditions.

### I9
Provider acceptance cannot become final business success implicitly.

### I10
Contract version changes require compatibility assessment.

### I11
History cannot be rewritten to satisfy a failed checklist item.

### I12
Manual override requires actor, reason, evidence and expiry / review boundary.

## 17. L5 Execution Units

```text
L5-IP-227-ADMISSION-CHECKLIST
L5-IP-227-G01-PORTFOLIO
L5-IP-227-G02-REPRESENTATION
L5-IP-227-G03-TAX-DEPENDENCY
L5-IP-227-G04-BENEFICIARY-PROPAGATION
L5-IP-227-G07-PERMANENT-CLOSURE
L5-IP-227-G08-PRIVACY-DEPENDENCY
L5-IP-227-G09-PROVIDER-RECONCILIATION
L5-IP-227-G10-RELEASE-COMPATIBILITY
L5-IP-227-EVIDENCE-GATE
L5-IP-227-OVERRIDE-GUARD
L5-IP-227-FINAL-IMPLEMENTATION-GATE
```

## 18. L6 Acceptance Atoms

### L6-IP-227-001
All mandatory admission checklist items have explicit result states.

### L6-IP-227-002
A failed or unknown item blocks implementation readiness.

### L6-IP-227-003
Portfolio composition is reconstructable.

### L6-IP-227-004
Representation and delegation lineage is reconstructable.

### L6-IP-227-005
Delegation expiry and revocation affect downstream readiness.

### L6-IP-227-006
Tax dependency is sourced from an external authoritative domain.

### L6-IP-227-007
Unknown tax state cannot authorize automatic payout.

### L6-IP-227-008
Beneficiary change propagates to pending payout checks.

### L6-IP-227-009
Historical payout beneficiary snapshots remain immutable.

### L6-IP-227-010
Permanent closure checks all declared blocking conditions.

### L6-IP-227-011
Permanent closure preserves historical evidence.

### L6-IP-227-012
Provider response states use explicit normalized semantics.

### L6-IP-227-013
Provider acceptance cannot imply final confirmation.

### L6-IP-227-014
Unknown provider results enter reconciliation.

### L6-IP-227-015
Cross-contract version changes trigger compatibility review.

### L6-IP-227-016
Event schema compatibility is assessed before release.

### L6-IP-227-017
Evidence references remain valid across contract upgrades.

### L6-IP-227-018
Evidence-required checklist items cannot pass with empty registry mapping.

### L6-IP-227-019
Manual overrides are attributable and bounded.

### L6-IP-227-020
Implementation readiness requires every mandatory gate to pass.

## 19. Final Disposition

完成本清单后，不再继续无限新增 IP Center 业务合同。

后续顺序固定为：

```text
227 Admission Checklist
→ Instance / Evidence Verification
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
