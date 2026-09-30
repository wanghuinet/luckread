# LuckRead L3-L6 Hierarchy Reconciliation Addendum v1.0

**状态：RECONCILIATION-READY / SUPERSEDES-HIERARCHY-INTERPRETATION-ONLY**

## 0. Purpose

本 Addendum 只修正层级语义，不新增产品能力。

既有 34/35/36 保持业务能力清单与父子关系；本文件明确后续工程层级的边界，消除“禁止 L5”与“需要执行规格”的语义冲突。

## 1. Final hierarchy

```text
L1 = Domain
L2 = Capability
L3 = Atomic Capability
L4 = Implementation Responsibility
L5 = Execution Specification
L6 = Verification / Evidence Atomic Unit
```

## 2. Boundary rule

L1-L4 是产品/架构能力层。

L5-L6 是工程执行与验证层，不属于新的产品能力目录。

因此：

```text
禁止新增未登记 Product Capability at L5/L6
允许为既有 L4 定义 L5 Execution Specification
允许为既有 L5 定义 L6 Verification Claim
```

## 3. Interpretation of prior L5 prohibition

既有合同中“no L5 capability is introduced”的要求继续有效，其含义统一解释为：

```text
NO NEW PRODUCT CAPABILITY AT L5
```

而不是禁止 L5 工程规格实体。

## 4. Mandatory parentage

```text
L5 → exactly one parent L4
L6 → exactly one parent L5
```

不得存在 orphan L5/L6。

## 5. Product capability completeness

L1/L2 的产品边界仍以 37 为准。

34/35/36 负责既有层级库存；178 负责新增产品边界的 L3/L4 traceability closure。

## 6. Engineering closure

```text
L4
→ L5 Input/Output/Preconditions/State/Authorization/Side Effects/Recovery
→ L6 Testable Claim
→ Evidence
```

## 7. Contract closure

L5/L6 不能绕过：

```text
Data Contract
API Contract
Event Contract
Permission/Security
Cost/Runtime
Test/Acceptance
Evidence
```

## 8. Admission status

```text
L1/L2 = PRODUCT-CLOSED
L3/L4 = TRACEABILITY-CLOSURE REQUIRED until 178 evidence is accepted
L5 = ENGINEERING-SPECIFICATION layer
L6 = VERIFICATION/EVIDENCE layer
```

## 9. STOP conditions

- L5 creates a new L1/L2 capability;
- L6 is used as a product feature;
- parent mapping is missing;
- L4 has no L5 for implementation admission;
- L5 has no L6/evidence plan for acceptance;
- L6 cannot be mapped to a reproducible verification.

## 10. Final sequence

```text
37 Product Boundary
→ 35 L3
→ 36 L4
→ 178 Traceability Closure
→ 179 L5 Execution Specification
→ 180 L6 Verification
→ 176 Evidence Registry
→ 74 Reconciliation
→ 75 Unified Preflight
→ Unified CL
→ CI
→ Implementation Admission
```

本 Addendum 不执行 CL/CI。
