# LuckRead MCN Center 数据契约 v1.0

**状态：DATA-CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：MCN Center 核心权威数据边界与关系模型；不授权直接实现业务代码。**

## 1. 目标

本契约承接：

- `44-MCN-CENTER-EXPERIENCE-AND-OPERATING-SYSTEM-CONTRACT-v1.0.md`
- `45-MCN-CENTER-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md`

目标是冻结 MCN Center 的数据责任、实体关系、生命周期、唯一性、幂等、审计、隐私、权利和结算边界，避免后续开发过程中重复建模或形成第二套权威状态。

核心原则：

```text
MCN Center = Organization Operations + Aggregated Read/Command Surface

Authority belongs to domain owners.
MCN Center must not duplicate authoritative state.
```

## 2. 权威数据边界

| Entity | Authority | MCN Center 权限 |
|---|---|---|
| Organization | Organization Domain | command/read |
| Membership | Organization Domain | command/read |
| Team | Organization Domain | command/read |
| Creator | Creator Domain | reference/read/affiliation command |
| Creator Affiliation | Organization/Creator relationship domain | command/read |
| Content | Content Domain | command/read/batch operation |
| Draft | Creator/Creation Domain | command/read |
| Media Asset | Media Domain | reference/read/asset operation |
| IP | IP Domain | command/read |
| Rights/License | Rights Domain | command/read |
| Audience Relationship | Social/Audience Domain | read/authorized operations |
| Membership Entitlement | Membership Domain | read/authorized command |
| Collaboration | Business Domain | command/read |
| Campaign | Advertising/Business Domain | command/read |
| Revenue Fact | Ledger Domain | read/reference |
| Settlement | Settlement/Ledger Domain | command/read |
| Moderation Decision | Safety/Moderation Domain | read/authorized action |
| Risk Decision | Risk Domain | reference/read where policy permits |
| Analytics | Derived Analytics Domain | read |
| Audit Record | Audit/Governance Domain | append/read by scope |

禁止 MCN Center 自建第二份 authoritative Creator、Content、IP、Ledger 或 Risk 数据。

## 3. Organization

### 3.1 Organization

核心字段：

```text
id
name
slug
status
organizationType
ownerUserId
verificationStatus
locale
timezone
createdAt
updatedAt
```

约束：

- `id` 不可变；
- `slug` 在平台范围唯一；
- owner 必须是有效用户；
- suspended/closed 机构禁止新的高风险业务写入；
- 状态变更必须审计。

### 3.2 Organization Membership

```text
id
organizationId
userId
status
joinedAt
leftAt
createdAt
updatedAt
```

唯一性：

```text
organizationId + userId
```

成员不能通过普通客户端自行提升为 Owner/Admin。

## 4. Team

```text
id
organizationId
name
status
createdBy
createdAt
updatedAt
```

唯一性：

```text
organizationId + normalized(name)
```

Team 是权限与工作协作范围，不是 Creator 或 Content 的第二权威归属。

## 5. Role / Permission Binding

建议关系：

```text
Organization
→ Role
→ Permission
→ Resource Scope
→ Membership
```

核心字段：

```text
id
organizationId
roleKey
permissionKey
scopeType
scopeId
createdAt
updatedAt
```

敏感权限必须支持 scope，例如：

```text
organization-wide
team
creator
content
campaign
finance
```

权限变化必须写 Audit Event。

## 6. Creator Affiliation

MCN 与 Creator 的合作关系不能直接修改 Creator 身份。

```text
id
organizationId
creatorId
status
relationshipType
startAt
endAt
contractReference
createdAt
updatedAt
```

生命周期：

```text
INVITED
→ PENDING
→ ACTIVE
→ SUSPENDED
→ TERMINATED
```

特殊状态：`DISPUTED`。

唯一性规则：

```text
organizationId + creatorId + active affiliation
```

同一有效合作关系不得重复创建。

## 7. Creator Contract Reference

合同正文不应由 MCN Center 随意复制成另一份权威实体。

MCN 数据只保存：

```text
contractReference
contractVersion
effectiveAt
expiresAt
status
```

真正合同系统如果未来独立化，MCN Center 只引用其 ID/version。

## 8. Content Assignment

Content 本身属于 Content Domain。

MCN 的责任是记录运营关系：

```text
id
organizationId
contentId
creatorId
teamId
assignedBy
status
createdAt
updatedAt
```

唯一性建议：

```text
organizationId + contentId + active assignment
```

内容归属与 MCN 运营 assignment 必须严格区分。

## 9. Asset Reference

素材实际二进制对象由 Media/Object Storage 管理。

MCN 只保存引用：

```text
id
organizationId
assetId
ownerCreatorId
usageType
rightsReference
createdAt
updatedAt
```

禁止 MCN Center 复制大型媒体正文作为权威内容。

## 10. IP Relationship

MCN 只建立机构运营关系：

```text
id
organizationId
ipId
relationshipType
scope
status
createdAt
updatedAt
```

例如：

```text
MANAGED_BY
REPRESENTED_BY
LICENSED_TO
CO_PRODUCED
DISTRIBUTED_BY
```

权属本身仍由 Rights/IP Domain 权威化。

## 11. Audience / Membership Reference

MCN 不复制全部粉丝关系。

支持聚合引用：

```text
organizationId
creatorId
period
followers
activeFans
members
retention
sourceVersion
calculatedAt
```

这是 Derived Read Model，不是粉丝关系权威事实。

## 12. Brand Collaboration

核心实体：

```text
id
organizationId
brandId
campaignId
status
ownerUserId
startAt
endAt
contractReference
createdAt
updatedAt
```

状态：

```text
DRAFT
→ PROPOSED
→ NEGOTIATING
→ APPROVED
→ IN_DELIVERY
→ DELIVERED
→ SETTLED
→ CLOSED
```

失败状态：

```text
REJECTED
CANCELLED
DISPUTED
```

## 13. Campaign

```text
id
organizationId
campaignType
status
budgetReference
targetingReference
startAt
endAt
createdBy
createdAt
updatedAt
```

预算金额的最终权威事实不能仅存于 Campaign UI 数据，必须由 Ledger/Financial domain 管理。

## 14. Revenue Attribution

收益归因不是余额。

```text
id
sourceEventId
organizationId
creatorId
contentId optional
ipId optional
campaignId optional
revenueType
grossAmount
currency
creatorShare
organizationShare
platformShare
attributionVersion
occurredAt
createdAt
```

同一 `sourceEventId + attributionVersion` 必须幂等。

## 15. Ledger / Settlement Reference

Ledger 是资金事实权威。

MCN 只引用：

```text
ledgerEntryId
settlementId
statementId
payoutId
```

Settlement：

```text
id
organizationId
periodStart
periodEnd
status
statementReference
totalReference
createdAt
updatedAt
```

状态：

```text
OPEN
→ CALCULATING
→ PENDING_RECONCILIATION
→ RECONCILED
→ APPROVED
→ PAID
→ CLOSED
```

禁止 UI 直接修改余额。

## 16. Task

MCN Task Center 记录长任务状态：

```text
id
organizationId
taskType
targetType
targetId
status
progress
attempt
errorCode
safeErrorSummary
createdAt
updatedAt
completedAt
```

状态：

```text
PENDING
→ RUNNING
→ SUCCEEDED
```

失败：

```text
FAILED
RETRYABLE
CANCELLED
```

任务必须支持幂等与安全重试。

## 17. Audit

```text
id
organizationId
actorUserId
action
targetType
targetId
beforeSummary
afterSummary
requestId
correlationId
ipReference
deviceReference
result
createdAt
```

不得保存不必要的敏感原文。

敏感操作至少覆盖：

- permission change
- creator affiliation
- content bulk mutation
- rights
- campaign financial operation
- settlement
- payout
- moderation action
- API credential

## 18. Analytics Read Model

Analytics 数据必须显式区分：

```text
Authoritative Fact
Derived Metric
Snapshot
Aggregation
Experiment Result
```

核心字段：

```text
organizationId
subjectType
subjectId
metricKey
metricValue
windowStart
windowEnd
metricVersion
sourceVersion
calculatedAt
```

禁止把 Derived Metric 当成 Creator/Content/Revenue 权威状态。

## 19. Privacy / Data Classification

建议分类：

```text
PUBLIC
INTERNAL
SENSITIVE
RESTRICTED
FINANCIAL
SECURITY-SENSITIVE
```

例如：

- Organization public profile → PUBLIC/INTERNAL
- Member relation → INTERNAL
- Creator contract reference → SENSITIVE
- Settlement → FINANCIAL
- Risk signal → SECURITY-SENSITIVE
- Credentials → RESTRICTED

最小权限访问；不得把安全敏感字段发送到普通 Dashboard API。

## 20. Common Invariants

### Identity
任何关系必须引用稳定 ID，不以 username/displayName 作为权威外键。

### Ownership
Creator、Content、IP、Money、Rights 的 owner 必须明确。

### Lifecycle
所有状态变化必须符合定义的状态机。

### Idempotency
Mutation 必须具备稳定幂等键或唯一约束。

### Auditability
敏感状态变化必须产生 Audit。

### Provenance
版权、Remix、授权关系必须可追溯来源。

### Rebuildability
Analytics、Dashboard、Cache 等派生数据必须可以重建。

### Money
所有资金事实最终进入 Ledger。

### Privacy
MCN 聚合查询不能绕过 subject-level authorization。

### Portability
核心实体不得绑定 Payload 内部实现细节。

## 21. Storage Strategy

默认策略：

```text
Structured Authoritative State
→ D1

Large Media / Blobs
→ R2

Hot Derived State
→ Cache

Async Domain Events
→ Queue

Analytics / Aggregates
→ Derived Read Models
```

MCN Center 不得因为 Dashboard 便利而重复持久化完整 Content、Media、Creator 或 IP 数据。

## 22. Versioning

所有跨域引用应包含必要的：

```text
schemaVersion
contractVersion
sourceVersion
```

破坏性字段变化必须：

```text
New Version
→ Compatibility Window
→ Migration
→ Deprecation
→ Removal
```

禁止静默改变字段语义。

## 23. Data Contract Acceptance

P0 数据契约通过条件：

- Organization 唯一且生命周期明确；
- Membership 唯一且权限可追溯；
- Creator affiliation 不复制 Creator 权威身份；
- Content assignment 与 Content ownership 分离；
- IP relation 与 Rights ownership 分离；
- Analytics 明确为 derived；
- Revenue attribution 与 Ledger 分离；
- Settlement 可对账；
- Task 支持恢复；
- Audit 覆盖敏感操作；
- Privacy classification 明确；
- 所有跨域 ID 稳定；
- 所有关键 mutation 幂等；
- 无第二套 authoritative state。

## 24. STOP Conditions

以下任一条件出现，禁止进入 API/实现阶段：

1. 新实体没有 authority owner；
2. 一个实体存在两个 authoritative owner；
3. Creator identity 被 MCN 复制为权威；
4. Content/IP/Rights ownership 混淆；
5. Revenue/Balance 绕过 Ledger；
6. Analytics 被当作事实；
7. 敏感数据没有 classification；
8. 关键 mutation 没有 idempotency；
9. 生命周期没有状态机；
10. 删除操作无法恢复或审计；
11. 跨域引用依赖 displayName/username 等可变字段；
12. 数据模型直接绑定 Payload internal API。

## 25. READY Gate

```text
Data Entities
→ Authority Ownership PASS
→ Relationships PASS
→ Lifecycle PASS
→ Idempotency PASS
→ Privacy Classification PASS
→ Rights / Provenance PASS
→ Ledger Boundary PASS
→ Audit PASS
→ Rebuildability PASS
→ Versioning PASS
→ Acceptance PASS
→ DATA-CONTRACT-READY
```

**结论：MCN Center 数据模型现在进入冻结候选状态。下一步应在本契约基础上建立 API Contract，而不是直接编写 MCN 业务代码。**
