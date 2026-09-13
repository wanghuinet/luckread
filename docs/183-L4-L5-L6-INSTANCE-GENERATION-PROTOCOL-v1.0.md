# LuckRead L4-L5-L6 Instance Generation Protocol v1.0

**状态：INSTANCE-GENERATION-CONTRACT / IMPLEMENTATION-BLOCKED / CL-CI-NOT-RUN**

## 0. Purpose

本合同规定如何把现有 34/35/36 与 178 中已经登记的 L4，系统化生成对应的 L5 Execution Specification 与 L6 Verification / Evidence Atomic Unit。

本文件不是新的产品能力清单，不新增 L1/L2/L3/L4。它解决的是：

```text
L4 已登记
→ 如何保证每个 L4 都有 L5
→ 如何保证每个 L5 都有 L6
→ 如何保证没有 orphan / duplicate / unmapped
```

## 1. Generation Rule

所有实现范围内的 L4 必须生成：

```text
L4
→ minimum 1 L5
→ minimum 1 L6
```

复杂 L4 可以有多个 L5；复杂 L5 可以有多个 L6。

禁止为了“看起来完整”机械拆成无独立责任的细小函数。

## 2. Stable Identity

每个实例必须具有稳定 ID：

```text
L4: l4Id
L5: l5Id
L6: l6Id
```

推荐层级编码：

```text
L1-CONTENT
L2-PUBLISHING
L3-PUBLISH-VALIDATION
L4-VALIDATE-PUBLISH-COMMAND
L5-VALIDATE-PUBLISH-COMMAND-01
L6-VALIDATE-PUBLISH-COMMAND-01-AUTH
```

显示名称不得作为唯一身份。

## 3. L5 Generation Template

每个 L5 至少填写：

```text
l5Id
parentL4Id
owner
version
intent
input
output
preconditions
validation
authorization
stateTransition
dataBoundary
concurrency
idempotency
transactionBoundary
eventEffects
asyncOperation
cacheEffects
errorMapping
recovery
audit
observability
costRuntime
testRefs
evidencePlan
```

## 4. L6 Generation Template

每个 L6 至少填写：

```text
l6Id
parentL5Id
claim
verificationType
owner
expectedResult
precondition
input/reference
acceptanceThreshold
failureClassification
testRef
evidenceRef
```

## 5. Mandatory L5→L6 Coverage

每个 L5 至少检查：

```text
happy path
validation failure
authorization failure
state transition
idempotency/concurrency where applicable
side effect
error mapping
recovery
observability
```

以下能力额外检查：

```text
Security → authorization bypass / secret leakage
Privacy → sensitive-field isolation / export safety
Rights → ownership / provenance / license boundary
Financial → ledger integrity / duplicate settlement
Tenant → cross-tenant deny
Migration → compatibility / rollback
Event → ordering / replay / DLQ
Async → operation state / retry / timeout
```

## 6. L4 Classification

每个 L4 在生成前必须分类：

```text
COMMAND
QUERY
STATE_TRANSITION
ASYNC_OPERATION
EVENT_HANDLER
DERIVED_PROJECTION
POLICY_DECISION
BATCH_JOB
EXTERNAL_ADAPTER
```

分类决定 L5/L6 所需字段，但不得减少强制字段。

## 7. Full Capability Coverage Domains

Registry generation 必须覆盖既有 L1/L2/L3/L4 全库存，至少包括：

```text
Identity / Access
Device / Session / Privacy
Creator / Creator Studio
Organization / MCN
Content / Content Graph / Production
IP Graph / IP Economy
Media / Media Processing
Social Graph / Community / Interaction
Events / Feed / Recommendation / Personalization / Trending
Risk / Moderation / Appeals / Rights
Membership / Commerce / Advertising / Wallet / Ledger
Messaging / Live / Audio / Show / Series
Centers / Platform Operations / Open Platform
Search / Discovery / Analytics / Growth
```

新增 178 闭环域也必须包含在生成范围内。

## 8. Completeness Invariants

机器检查必须满足：

```text
∀ L2: exists L3
∀ L3: exists L4
∀ implementation-scoped L4: exists L5
∀ implementation-scoped L5: exists L6
∀ L6: exists Evidence mapping before PASS
```

同时：

```text
no orphan
no duplicate ID
no duplicate parent ownership
no unmapped capability
no missing authority
no missing owner
```

## 9. Registry Diff Rule

每次增加、删除、拆分、合并 L4 时必须重新计算：

```text
L4 descendants
L5 coverage
L6 coverage
contract refs
test refs
evidence refs
```

不允许只更新名称而不更新子树。

## 10. Contract Inheritance

L5/L6 必须继承适用合同：

```text
160 Lifecycle
161 DR/BCP
162 Migration
163 Event
164 Saga
165 Async
166 Error/State
167 Cache
168 Scope/Tenant
169 Security
170 Rate/Quota
171 Observability
172 Localization
173 Accessibility
174 Canonical ID
175 Configuration/Policy
176 Evidence
```

任何 NOT-APPLICABLE 都必须有理由。

## 11. Readiness State Machine

实例状态统一为：

```text
INVENTORIED
→ L5-PENDING
→ L6-PENDING
→ CONTRACT-PENDING
→ TEST-PENDING
→ EVIDENCE-PENDING
→ READY
→ IMPLEMENTED
→ CI-PASS
→ ACCEPTED
```

发生阻断时：

```text
→ BLOCKED
```

## 12. STOP Conditions

以下任一情况都不得进入 READY：

- L4 无父级；
- L4 无 owner / authority；
- L4 无 L5；
- L5 无父 L4；
- L5 无执行规格；
- L5 无 L6；
- L6 claim 不可验证；
- test/evidence mapping 缺失；
- cross-cutting inheritance 未判定；
- duplicate ID；
- orphan instance；
- L5/L6 偷渡新的产品能力。

## 13. Relationship to Existing Contracts

```text
34/35/36 Existing Inventory
→ 178 L3/L4 Closure
→ 183 Instance Generation Protocol
→ 182 Full Coverage Registry
→ 179 L5 Specification
→ 180 L6 Verification
→ 176 Evidence Registry
→ 74 Reconciliation
→ 75 Unified Preflight
→ Unified CL
→ CI
```

## 14. Current Status

```text
L1-L4 RULES       = CLOSED
L5 STANDARD       = CLOSED
L6 STANDARD       = CLOSED
INSTANCE PROTOCOL = DEFINED
FULL INSTANCE     = PENDING GENERATION
CL                 = NOT RUN
CI                 = NOT RUN
IMPLEMENTATION     = BLOCKED
```

**本文件不生成代码，不执行 CL/CI。**
