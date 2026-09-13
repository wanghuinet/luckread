# LuckRead L5-L6 IP Licensor Onboarding / Rights Provenance / Verification Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本注册表将 204 合同中的 IP 供给侧准入、权利来源、授权资格、可售范围、冲突、争议、撤销与 SKU 再验证要求实例化为可执行的 L5 Engineering Units 与 L6 Verification Atomic Units。

规则：

```text
L4 Product Contract
→ L5 Execution Unit
→ L6 Verification Atomic Unit
→ Evidence
```

本文件不新增产品能力，不改变 Rights Authority，也不授权实现。

## 2. L5/L6 Coverage Registry

| L4 | L5 Execution Unit | L6 Atomic Units | 状态 |
|---|---|---|---|
| Licensor Onboarding | L5-IP-205-ONBOARD | 001-003 | PENDING |
| Subject Verification | L5-IP-205-SUBJECT | 004-005 | PENDING |
| IP Identity | L5-IP-205-IPID | 006-007 | PENDING |
| Rights Provenance | L5-IP-205-PROVENANCE | 008-009 | PENDING |
| Chain of Title | L5-IP-205-CHAIN | 010-011 | PENDING |
| Authorization Basis | L5-IP-205-AUTHORITY | 012-013 | PENDING |
| Sellable Scope | L5-IP-205-SCOPE | 014-015 | PENDING |
| Rights-to-Sell Check | L5-IP-205-SELLCHECK | 016-017 | PENDING |
| Conflict Detection | L5-IP-205-CONFLICT | 018-019 | PENDING |
| Authorization Capacity | L5-IP-205-CAPACITY | 020-021 | PENDING |
| Co-Licensing | L5-IP-205-COLICENSE | 022-023 | PENDING |
| Approval Rights | L5-IP-205-APPROVAL | 024-025 | PENDING |
| Evidence Confidence | L5-IP-205-CONFIDENCE | 026-027 | PENDING |
| Verification State | L5-IP-205-STATE | 028-029 | PENDING |
| Dispute Handling | L5-IP-205-DISPUTE | 030-031 | PENDING |
| Revocation | L5-IP-205-REVOKE | 032-033 | PENDING |
| Expiration | L5-IP-205-EXPIRE | 034-035 | PENDING |
| Change Detection | L5-IP-205-CHANGE | 036-037 | PENDING |
| SKU Revalidation | L5-IP-205-REVALIDATE | 038-039 | PENDING |
| Enterprise Portfolio Import | L5-IP-205-PORTFOLIO | 040-041 | PENDING |
| Public Verification Boundary | L5-IP-205-PUBLICVERIFY | 042-043 | PENDING |
| Security / Permission | L5-IP-205-PERMISSION | 044-045 | PENDING |
| Audit | L5-IP-205-AUDIT | 046-047 | PENDING |

## 3. L5 Execution Unit Requirements

每个 L5 Unit MUST 明确：

```text
Intent
Input
Output
Preconditions
Validation
Authority
Scope
State Transition
Data Boundary
Concurrency / Version
Idempotency
Transaction
Events
Async Behavior
Cache Behavior
Error Taxonomy
Recovery
Audit
Observability
Cost
Test Plan
Evidence Requirement
```

## 4. L5-IP-205-ONBOARD

Intent：建立待验证 Licensor 入驻申请。

Input：

```text
subjectId
role
organizationId?
ipRefs
requestedScopes
submittedEvidenceRefs
```

Preconditions：主体存在，申请人具备提交权限。

State：

```text
DRAFT → SUBMITTED
```

Idempotency：同一主体、同一申请版本不得重复创建活动申请。

## 5. L5-IP-205-SUBJECT

验证主体身份、组织关系及授权角色。

Rule：

```text
Registered User ≠ Verified Licensor
```

必须生成可审计 Verification Result，并关联 Evidence。

## 6. L5-IP-205-IPID

建立 Canonical IP Identity：

```text
ipId
canonicalName
aliases
ipType
originRef
creatorRefs
ownerRefs
status
```

重复或冲突身份必须进入 reconciliation，而不是创建第二个事实 IP。

## 7. L5-IP-205-PROVENANCE

记录权利来源链：

```text
Origin
→ Creator
→ Owner
→ Transfer / Assignment
→ Current Authority
```

每个节点必须引用来源证据。

## 8. L5-IP-205-CHAIN

Chain of Title 必须 append-only。

允许：

```text
ADD
CORRECT
REVOKE
```

禁止直接覆盖历史权属事实。

## 9. L5-IP-205-AUTHORITY

计算 Licensor 的授权资格：

```text
OWNERSHIP
EXCLUSIVE_RIGHTS
NON_EXCLUSIVE_RIGHTS
AGENCY
DISTRIBUTION
SUBLICENSING
CONTRACTUAL_AUTHORITY
```

资格必须映射至 Rights Authority Ref。

## 10. L5-IP-205-SCOPE

计算可出售范围：

```text
rights × usage × media × channel × territory × language
× term × exclusivity × derivative × sublicense
```

输出：

```text
SELLABLE_SCOPE
RESTRICTED_SCOPE
BLOCKED_SCOPE
```

## 11. L5-IP-205-SELLCHECK

SKU 发布之前执行：

```text
Licensor Verification
+ Rights Authority
+ Scope Intersection
+ Conflict
+ Risk / Compliance
→ Sellable Decision
```

任何关键失败都不能自动进入标准销售。

## 12. L5-IP-205-CONFLICT

重点检测独家冲突：

```text
same IP
same right
same territory
overlapping term
same channel / usage
```

结果必须可解释：

```text
NO_CONFLICT
POTENTIAL_CONFLICT
CONFIRMED_CONFLICT
MANUAL_REVIEW_REQUIRED
```

## 13. L5-IP-205-CAPACITY

对于有限授权容量维护：

```text
capacity
reserved
committed
available
consumed
released
```

容量计算必须可重放，不得只依赖页面显示值。

## 14. L5-IP-205-COLICENSE

多主体交易必须明确：

```text
PRIMARY_LICENSOR
CO_LICENSOR
APPROVAL_PARTY
AGENT
DISTRIBUTOR
```

签约资格必须满足所有必要参与方的授权要求。

## 15. L5-IP-205-APPROVAL

SKU/License 可声明：

```text
brandApprovalRequired
contentApprovalRequired
characterApprovalRequired
packagingApprovalRequired
campaignApprovalRequired
```

审批要求不得被营销文案隐藏。

## 16. L5-IP-205-CONFIDENCE

证据可信度至少分层：

```text
SELF_DECLARED
THIRD_PARTY_SUBMITTED
PLATFORM_CHECKED
CONTRACT_VERIFIED
LEGAL_VERIFIED
AUTHORITATIVE_RECORD
```

不同交易等级可配置最低可信级别。

## 17. L5-IP-205-STATE

状态机：

```text
DRAFT
→ SUBMITTED
→ UNDER_REVIEW
→ VERIFIED
→ PUBLISHED
```

异常：

```text
REJECTED
SUSPENDED
DISPUTED
EXPIRED
REVOKED
```

## 18. L5-IP-205-DISPUTE

权属争议发生后，相关范围必须重新计算交易资格。

高风险状态可导致：

```text
SKU → SUSPENDED
```

争议不能只记录在客服备注中。

## 19. L5-IP-205-REVOKE

授权资格撤销必须形成传播事件，并驱动重新计算：

```text
Licensor
→ Sellable Scope
→ SKU Availability
→ Quotes
→ Orders
→ Licenses
→ Authorization Certificates
```

具体交易后果由 Rights / Commerce / Agreement / License 合同决定。

## 20. L5-IP-205-EXPIRE

权利和授权资格都必须支持有效期。

过期后：

```text
New Sale = BLOCKED
```

除非已有合法续期或替代权利来源。

## 21. L5-IP-205-CHANGE

监听：

```text
Ownership
Scope
Territory
Term
Exclusivity
Agency
Dispute
Risk
```

任何实质变化都必须触发受影响 SKU 的重新评估。

## 22. L5-IP-205-REVALIDATE

SKU 再验证必须检查：

```text
Current Licensor Status
Current Rights
Current Scope
Current Conflicts
Current Risk
Current Policy
```

旧验证结果不得被当成永久许可。

## 23. L5-IP-205-PORTFOLIO

企业批量导入必须保留：

```text
importBatchId
sourceSystem
sourceRecordRef
importedAt
mappingVersion
validationResult
```

历史数据不能直接成为无来源的当前权利事实。

## 24. L5-IP-205-PUBLICVERIFY

公开授权验证只返回最小必要字段：

```text
authorizationNumber
status
ipIdentity
licensorName
licenseeReference
scopeSummary
territory
term
issuedAt
```

禁止暴露内部风险、私有证据、合同全文。

## 25. L5-IP-205-PERMISSION

最小角色：

```text
LICENSOR_ADMIN
RIGHTS_OPERATOR
LEGAL_REVIEWER
COMPLIANCE_REVIEWER
DEAL_MANAGER
PLATFORM_OPERATOR
AUDITOR
```

Evidence 与权利数据按最小权限访问。

## 26. L5-IP-205-AUDIT

所有关键决策必须记录：

```text
actor
action
timestamp
before
after
reason
evidenceRef
```

重点包括验证、范围改变、冲突解除、争议处理、撤销与恢复。

## 27. L6 Verification Atomic Units

### L6-IP-205-001

提交已完成的 Licensor Onboarding 可产生唯一申请记录。

### L6-IP-205-002

重复提交相同幂等键不会产生第二个活动申请。

### L6-IP-205-003

只有具备提交权限的主体才能提交入驻申请。

### L6-IP-205-004

主体验证结果必须绑定有效 Evidence。

### L6-IP-205-005

已注册账号不会自动获得 Verified Licensor 状态。

### L6-IP-205-006

相同事实 IP 不会因别名或展示页产生第二个 Canonical IP。

### L6-IP-205-007

IP Identity 与 Rights Authority Reference 可以被追踪关联。

### L6-IP-205-008

每个 Provenance 节点都具有 source evidence reference。

### L6-IP-205-009

无证据的权利来源不能被判定为完整 Provenance。

### L6-IP-205-010

Chain of Title 历史记录不能被原地覆盖。

### L6-IP-205-011

Chain 修正会保留原记录与修正关系。

### L6-IP-205-012

Licensor Authorization Basis 必须映射至 Rights Authority。

### L6-IP-205-013

没有合法授权基础不能生成 SELLABLE_SCOPE。

### L6-IP-205-014

Sellable Scope 必须能够逐维解释授权边界。

### L6-IP-205-015

Restricted / Blocked Scope 不得作为标准可售范围发布。

### L6-IP-205-016

SKU 发布前必须完成 Rights-to-Sell Check。

### L6-IP-205-017

关键检查失败时 Sellable Decision 必须为 BLOCKED 或 MANUAL_REVIEW。

### L6-IP-205-018

确认的独家冲突不得自动通过。

### L6-IP-205-019

冲突结果必须能够定位发生冲突的权利范围。

### L6-IP-205-020

有限授权容量必须能够计算 available。

### L6-IP-205-021

reserved / committed / consumed 状态计算必须可重放。

### L6-IP-205-022

Co-Licensor 角色不能自动获得独立签约权。

### L6-IP-205-023

需要联合批准的授权不能跳过 Approval Party。

### L6-IP-205-024

SKU 必须能够声明必要审批类型。

### L6-IP-205-025

审批要求不能由自由文本隐藏。

### L6-IP-205-026

Evidence Confidence 必须记录证据等级。

### L6-IP-205-027

高风险交易可以要求最低 Evidence Confidence。

### L6-IP-205-028

Verification State 的状态迁移必须符合定义状态机。

### L6-IP-205-029

关键状态变更必须留下历史记录。

### L6-IP-205-030

高风险权属争议会阻止标准授权交易。

### L6-IP-205-031

争议解决后必须重新计算受影响范围。

### L6-IP-205-032

撤销授权资格后禁止新的相关授权签发。

### L6-IP-205-033

撤销必须传播到受影响 SKU/交易投影。

### L6-IP-205-034

过期授权资格不能产生新的授权交易。

### L6-IP-205-035

续期后必须使用新版本权利状态进行判断。

### L6-IP-205-036

权属变化能够被识别并进入 Change Detection。

### L6-IP-205-037

实质权利变化会触发 SKU Revalidation。

### L6-IP-205-038

再验证必须使用当前 Rights 状态。

### L6-IP-205-039

旧验证结果不能无限期继续作为授权依据。

### L6-IP-205-040

企业批量导入保留 source system 与 import batch。

### L6-IP-205-041

导入映射失败的记录不能直接成为当前权利事实。

### L6-IP-205-042

公开验证只暴露最小必要信息。

### L6-IP-205-043

公开验证不能泄露私有证据或内部风险信息。

### L6-IP-205-044

敏感 Evidence 访问必须符合最小权限。

### L6-IP-205-045

不同角色不能跨越其授权边界访问权利证据。

### L6-IP-205-046

关键权利决策都有 audit record。

### L6-IP-205-047

审计记录能够关联 decision evidence。

## 28. Cross-Contract Traceability

```text
204 IP Licensor / Rights Provenance
        ↓
205 L5-L6 Instance Registry
        ↓
64 Rights Authority
        ↓
201 IP Trading Center
        ↓
203 SKU / Pricing / Deal Desk
        ↓
200 Transaction / E-Sign / Authorization
        ↓
176 Evidence Registry
```

任何 L5/L6 PASS 都必须能够回指上游 L4 Contract 与 Evidence。

## 29. Stop Conditions

以下任一情况存在时，相关 L5/L6 不得标记 READY：

```text
Rights Authority reference missing
Evidence missing
Scope not machine-checkable
Exclusive conflict unresolved
Dispute status unknown
Revocation propagation undefined
Revalidation undefined
Public verification leaks restricted data
Audit evidence missing
```

## 30. Final Status

```text
L4 COVERAGE = REGISTERED
L5 COVERAGE = 24 UNITS
L6 COVERAGE = 47 ATOMIC CLAIMS
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```

本注册表完成实例化，但所有 L6 目前均等待真实实现、测试与 Evidence。
