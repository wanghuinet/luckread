# LuckRead IP Center Structural Repair L5-L6 Instance Registry v1.0

**状态：INSTANCE-REGISTERED / STRUCTURAL-REPAIR-MAPPED / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表把 234 六项结构性修复落实到现有 IP Center L4-L6 Registry。

本文件不创建新的业务 Capability，不创建新的 Authority，不执行 CL/CI。

## 2. Repair Coverage

| Repair | Existing Contracts / Registries | L5 Repair Unit | L6 Atomic Units |
|---|---|---|---|
| P0-01 Authority Uniqueness | 201/204/208/214/220/222/224 | L5-IP-235-AUTHORITY | 001-006 |
| P0-02 License Orthogonal State | 211/212/221 | L5-IP-235-LICENSE-STATE | 007-012 |
| P0-03 Admission Snapshot Binding | 208/209/210 | L5-IP-235-ADMISSION-BINDING | 013-018 |
| P1-04 Impact Propagation | 211/213/217/219/220/222/224 | L5-IP-235-IMPACT | 019-024 |
| P1-05 Legal vs Verification | 204/205/230 | L5-IP-235-LEGAL-VERIFICATION | 025-030 |
| P1-06 Jurisdiction Boundary | 221/222/231 | L5-IP-235-JURISDICTION | 031-036 |

## 3. P0-01 Authority Repair

### L5-IP-235-AUTHORITY

负责检查所有最终业务事实的唯一 Authority。

必须区分：

```text
Authority
Provider
Adapter
Coordinator
Projection
UI
```

### L6

- **L6-IP-235-001**：每个核心业务事实存在唯一 Canonical Authority。
- **L6-IP-235-002**：Provider / Adapter 不得声明最终事实。
- **L6-IP-235-003**：Coordinator / Projection / UI 不得声明最终事实。
- **L6-IP-235-004**：Settlement Authority 与 Ledger / Financial Finality Authority 分离。
- **L6-IP-235-005**：Certificate 不得创建、扩张、延长或撤销 License 权威。
- **L6-IP-235-006**：Financial Finality 只能由 Ledger / Financial Finality Authority 确认。

## 4. P0-02 License State Repair

### L5-IP-235-LICENSE-STATE

License 必须由正交维度表达：

```text
Identity
Version
Lifecycle
Control
Expiry
Effective Scope
```

### L6

- **L6-IP-235-007**：Lifecycle 只使用 PENDING / ACTIVE / EXPIRED / TERMINATED。
- **L6-IP-235-008**：Control 只使用 NORMAL / SUSPENDED / REVOKED / HOLD。
- **L6-IP-235-009**：Expiry 只使用 NOT_EXPIRING / EXPIRING / EXPIRED。
- **L6-IP-235-010**：AMENDED / RENEWED / EXPANDED / SUPERSEDED 通过版本/事件表达，不与 Lifecycle 混用。
- **L6-IP-235-011**：历史 License Version 不可变。
- **L6-IP-235-012**：License 当前状态必须能够从正交字段唯一重建。

## 5. P0-03 Admission Snapshot Binding

### L5-IP-235-ADMISSION-BINDING

Trade Admission 必须形成不可变 Decision Snapshot，并在执行前形成 Execution Binding Snapshot。

### L6

- **L6-IP-235-013**：ALLOW 必须关联具体 decisionId + decisionVersion。
- **L6-IP-235-014**：Buyer / Intent / SKU / Scope / Price / Policy / Approval 快照必须可重建。
- **L6-IP-235-015**：进入 Order / Agreement / License 前必须存在 Execution Binding。
- **L6-IP-235-016**：Material Authority Change 必须触发 Recheck。
- **L6-IP-235-017**：历史 Execution Snapshot 不得被当前 Profile 改写。
- **L6-IP-235-018**：过期/失效 Admission 不得作为当前授权依据。

## 6. P1-04 Unified Impact Propagation

### L5-IP-235-IMPACT

重大变更必须命中统一 Impact Matrix，再由下游 Authority 执行对应动作。

### L6

- **L6-IP-235-019**：Rights Revocation 触发 SKU、Admission、License、Usage、Settlement/Payout 检查。
- **L6-IP-235-020**：Licensor Suspension 触发 SKU、Quote、Trade、License Recheck。
- **L6-IP-235-021**：Confirmed Rights Conflict 阻止相关标准销售。
- **L6-IP-235-022**：Material Dispute 能定位受影响 Trade / Agreement / License / Settlement / Payout。
- **L6-IP-235-023**：Beneficiary Change 能阻止受影响 Pending Payout 并保持历史快照。
- **L6-IP-235-024**：Agreement Termination / Compliance Block 能触发对应 License / Usage / Settlement / Renewal 检查。

## 7. P1-05 Legal Fact vs Platform Verification

### L5-IP-235-LEGAL-VERIFICATION

四类事实必须分离：

```text
LEGAL / RIGHTS FACT
PLATFORM VERIFICATION FACT
COMMERCIAL ELIGIBILITY
MARKETPLACE TRUST SIGNAL
```

### L6

- **L6-IP-235-025**：Platform Verification ≠ Legal Ownership Finality。
- **L6-IP-235-026**：Verification Confidence 只描述证据/验证强度。
- **L6-IP-235-027**：Commercial Eligibility 可以独立为 BLOCKED / REVIEW。
- **L6-IP-235-028**：Trust Signal 不得创建 Rights 或 License 权利。
- **L6-IP-235-029**：Legal Fact = UNKNOWN 时不得被 VERIFIED 状态静默替换。
- **L6-IP-235-030**：Rights Finality 仍由 Rights Authority 决定。

## 8. P1-06 Jurisdiction Boundary

### L5-IP-235-JURISDICTION

必须独立表达：

```text
Buyer Jurisdiction
Licensor Jurisdiction
Rights Territory
Usage Territory
Tax Jurisdiction
Governing Law
Dispute Forum
Arbitration Seat
Enforcement Territory
Sanctions / Export Controls
Local Regulatory Restrictions
```

### L6

- **L6-IP-235-031**：Usage Territory 不得替代 Governing Law。
- **L6-IP-235-032**：Rights Territory 与 Contract Jurisdiction 独立存储。
- **L6-IP-235-033**：Tax Jurisdiction 不得由 Usage Territory 推导为唯一事实。
- **L6-IP-235-034**：复杂交易可绑定 Dispute Forum / Arbitration Seat / Enforcement Territory。
- **L6-IP-235-035**：Sanctions / Export / Local Regulatory Policy 必须可版本化引用。
- **L6-IP-235-036**：IP Center 只能保存法律上下文和引用，不得替代法律 Authority。

## 9. Cross-Registry Mapping

```text
204/205 → P0-01 + P1-05
208      → P0-01 + P0-03
209/210  → P0-03
211/212  → P0-02 + P1-04
213      → P1-04
214/216  → P0-01 + P1-04
217      → P1-04
219      → P1-04
220      → P0-01 + P1-04
221      → P0-02 + P1-06
222      → P0-01 + P1-04 + P1-06
224/225  → all repaired closure semantics
229/230  → P1-05 + evidence semantics
231/232/233 → all repaired preflight semantics
```

## 10. Machine Invariants

```text
R1: No duplicate canonical Authority.
R2: Provider / Adapter / Coordinator / Projection cannot create final facts.
R3: Certificate cannot become License authority.
R4: License state reconstruction is deterministic from orthogonal dimensions.
R5: Admission execution requires exact Snapshot + Binding.
R6: Material change requires recheck.
R7: Impact Matrix must exist for material cross-domain change.
R8: Legal Fact cannot be inferred from Platform Verification.
R9: Trust signal cannot grant Rights.
R10: Jurisdiction must not be collapsed into Territory.
R11: Historical snapshots remain immutable.
R12: Unknown / stale / incompatible inputs cannot become final success implicitly.
```

## 11. Repair Gate

```text
[ ] P0-01 Authority uniqueness mapped
[ ] P0-02 License state mapped
[ ] P0-03 Admission binding mapped
[ ] P1-04 Impact propagation mapped
[ ] P1-05 Legal/verification separation mapped
[ ] P1-06 Jurisdiction boundary mapped
[ ] Certificate boundary locked
[ ] Existing L5/L6 registries have repair references
[ ] Reverse audit can consume repaired semantics
```

## 12. Final Disposition

本注册表完成后，不新增 IP Center 业务合同。

下一步：

```text
Repair Registry Reconciliation
→ Reverse Coverage Audit
→ Evidence Population
→ Evidence Verification
→ Unified CL
```

当前：

```text
STRUCTURAL REPAIR = COMPLETE
INSTANCE MAPPING = COMPLETE
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
