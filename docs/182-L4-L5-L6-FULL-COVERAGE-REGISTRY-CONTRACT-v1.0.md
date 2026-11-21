# LuckRead L4-L5-L6 Full Coverage Registry Contract v1.0

**状态：REGISTRY-CONTRACT / INSTANCE-CLOSURE-PENDING / IMPLEMENTATION-BLOCKED**

## 0. Purpose

本合同把能力层从“规则已经定义”推进到“每个实现责任都必须登记、映射和验证”。

```text
L1 → L2 → L3 → L4 → L5 → L6 → Evidence
```

本文件不新增产品能力；它规定如何对现有 L4 逐项生成并审计 L5/L6 实例。

## 1. Registry Rule

每一个进入实现范围的 L4 必须有一条可机器解析的 registry record。

```text
one L4
→ one or more L5
→ one or more L6
```

每一个 L5 只能有一个父 L4；每一个 L6 只能有一个父 L5。

禁止：

```text
orphan L4
orphan L5
orphan L6
duplicate identity
ambiguous parentage
untracked implementation item
```

## 2. Required Record

最小字段：

```text
l1Id
l2Id
l3Id
l4Id
l5Id
l6Id
owner
status
authoritativeSource
dataRef
apiRef
eventRef
permissionRef
securityRef
runtimeRef
costRef
testRef
evidenceRef
```

身份链必须稳定，不得通过显示名称代替唯一 ID。

## 3. Status Vocabulary

```text
INVENTORIED
TRACEABILITY-PENDING
L5-PENDING
L6-PENDING
CONTRACT-PENDING
TEST-PENDING
EVIDENCE-PENDING
READY
IMPLEMENTED
CI-PASS
ACCEPTED
BLOCKED
NOT-APPLICABLE
```

`NOT-APPLICABLE` 必须具备机器可审计理由。

## 4. L5 Generation Rule

每个 L4 必须拆成足够小、可独立执行的 L5，但不得过度拆分成没有独立责任的函数列表。

L5 必须覆盖：

```text
Input
Output
Preconditions
Validation
Authorization
State transition
Data/query boundary
Concurrency
Idempotency
Transaction boundary
Event side effects
Async operation
Cache/derived state
Error mapping
Recovery
Audit
Observability
Cost/runtime
Test mapping
Evidence plan
```

## 5. L6 Generation Rule

每个 L5 至少产生一个原子验证 claim；高风险或多分支 L5 必须产生多个 claims。

最低覆盖：

```text
happy path
validation
authorization
state transition
idempotency/concurrency where applicable
side effects
error mapping
recovery
observability
```

高风险领域必须额外覆盖：

```text
security
privacy
rights
financial integrity
cross-tenant isolation
```

## 6. Coverage Matrix

### 6.1 Identity / Access

L4 examples requiring L5/L6 closure：

```text
username reservation
email verification
session issuance
session rotation
logout-all
credential revocation
ownership authorization
consent withdrawal
account deletion
account restoration
```

### 6.2 Creator / Organization

```text
creator creation
verification decision
ownership transfer
delegated operator grant/revoke
organization membership
workspace permission
representation lifecycle
contract lifecycle
campaign assignment
```

### 6.3 Content / Production

```text
draft creation
autosave checkpoint
preview generation
publish validation
publish execution
scheduled publish
version restore
content deletion
content export
bulk mutation
remix provenance
```

### 6.4 Media

```text
upload session
multipart completion
checksum validation
processing admission
transcode
thumbnail generation
subtitle binding
signed delivery
private delivery
object deletion
```

### 6.5 Social / Community / Interaction

```text
follow
block
mute
audience mutation
join/leave
membership restriction
comment
reply
reaction
favorite
share
report
```

### 6.6 Feed / Recommendation / Personalization / Trending

```text
candidate recall
eligibility filtering
ranking
feed assembly
cursor continuation
fallback/degraded feed
feedback admission
feature generation
model/version selection
risk-aware suppression
interest update
preference decay
trend candidate admission
trend ranking
anti-manipulation suppression
```

### 6.7 Risk / Moderation / Rights

```text
risk scoring
challenge
throttle
quarantine
moderation queue
moderator decision
enforcement
appeal
ownership evidence
license authorization
provenance
rights restriction
```

### 6.8 Membership / Commerce / Advertising / Ledger

```text
membership enrollment
entitlement issue/revoke
order creation
payment intent
fulfillment state
refund
ad campaign mutation
budget enforcement
auction decision
conversion attribution
ledger posting
settlement
wallet withdrawal
```

### 6.9 Messaging / Live / Audio / Series

```text
notification creation
notification delivery
message send
read receipt
realtime presence
room admission
live-state transition
podcast creation
episode publication
series ordering
schedule release
```

### 6.10 Centers / Platform / Open Platform

```text
Center entry
Center mutation
Center aggregation
cross-center state resolution
developer App lifecycle
OAuth scope
webhook delivery
quota enforcement
platform configuration
release
deployment
rollback
support ticket lifecycle
```

上述只是 coverage anchors；不得解释为替代 34/35/36 的完整 L3/L4 清单。

## 7. Cross-Cutting Inheritance

每个 registry record 必须声明适用的：

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

不适用项必须 `NOT-APPLICABLE`。

## 8. Reverse Audit

机器治理必须支持以下查询：

```text
L1 → all descendants
L4 → all L5
L5 → all L6
L6 → Evidence
Evidence → L6 → L5 → L4 → L3 → L2 → L1
```

并能够发现：

```text
orphan
missing
duplicate
stale
unmapped
conflicting
```

## 9. Implementation Gate

```text
L4 inventoried
AND L5 complete
AND L6 mapped
AND contract refs complete
AND test refs complete
AND evidence plan complete
→ READY FOR IMPLEMENTATION
```

任何一个条件缺失均不得标记 `READY`。

## 10. Acceptance Gate

```text
implementation exists
AND tests executed
AND L6 results recorded
AND Evidence Registry updated
AND CI PASS
AND no unresolved blocker
→ ACCEPTED
```

## 11. No New Product Capability Rule

L5/L6 只能描述和验证已有 L4。

发现无法映射的新产品能力时：

```text
STOP
→ create/extend L1/L2 contract
→ create L3/L4
→ create L5/L6
→ reconcile
```

不得在 L5/L6 偷渡产品设计。

## 12. Final Decision

当前文档体系已经完成 L1-L6 的规则、边界和准入定义。

真正的实例闭环工作以本 registry 为准：

```text
34/35/36
→ 178 closure
→ 182 registry
→ 179 L5 instances
→ 180 L6 instances
→ 176 evidence
→ 74/75 admission
→ CL
→ CI
```

**本合同不执行 CL/CI，不授权生产实现。**
