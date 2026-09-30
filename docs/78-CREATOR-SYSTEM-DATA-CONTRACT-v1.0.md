# LuckRead Creator System Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System 数据权威与持久化合同**

## 1. 目的

本合同定义 Creator System 的权威数据边界、实体、状态、关系、版本、删除、隐私和派生数据规则。

Creator System 只拥有 Creator 业务事实；其他领域通过稳定 reference 关联，不复制第二份权威事实。

## 2. Authority Model

| 数据 | Authority |
|---|---|
| creator | Creator System |
| creator profile | Creator System |
| creator type | Creator System |
| creator lifecycle | Creator System |
| qualification state | Creator System |
| verification state | Creator System |
| capability state | Creator System |
| creator-side authorship relation | Creator System |
| creator-side collaboration state | Creator System |
| organization membership | Organization / MCN |
| content | Content |
| social graph | Social |
| rights | Copyright / Rights |
| risk decision | Risk / Trust |
| moderation decision | Moderation / Appeals |
| financial fact | Wallet / Ledger |
| analytics metric | Analytics |

## 3. Core Entities

### 3.1 Creator

最小权威字段：

```text
creatorId
userId
creatorType
publicId
status
createdAt
updatedAt
version
```

规则：creatorId 全局稳定且不可复用；userId 绑定必须唯一；status 变化必须可审计。

### 3.2 CreatorProfile

```text
creatorId
displayName
username
avatarRef
coverRef
bio
category
expertise
tags
language
region
publicLinks
businessContactRef
visibility
version
updatedAt
```

大型媒体对象只保存 R2/object reference，不把二进制写入 D1。

### 3.3 Qualification

```text
creatorId
qualificationType
state
sourceRuleRef
evaluatedAt
expiresAt
version
reasonCode
```

reasonCode 必须是对外安全摘要，不暴露内部风控阈值。

### 3.4 Verification

```text
verificationId
creatorId
type
state
providerRef
evidenceRef
verifiedAt
expiresAt
revokedAt
version
```

原始敏感证据必须最小化保存；普通 Creator API 只返回 verification state/reference。

### 3.5 Capability

```text
creatorId
capabilityKey
state
source
expiresAt
version
updatedAt
```

Capability 是授权输入，不替代每次请求的 authorization。

### 3.6 CreatorLifecycle

```text
creatorId
state
previousState
transitionCode
effectiveAt
actorRef
reasonCode
version
```

状态迁移必须有合法 transition graph，不允许任意状态跳转。

### 3.7 CreatorAuthorshipRelation

```text
relationId
creatorId
contentRef
role
attributionState
provenanceRef
createdAt
endedAt
version
```

Content 事实与 Rights 法律权利不复制到本实体。

### 3.8 CreatorCollaboration

```text
collaborationId
creatorId
counterpartyRef
role
state
contentRef
contributionRef
splitRef
startedAt
endedAt
version
```

splitRef 仅引用商业/账务域，不成为金额事实。

### 3.9 CreatorStandingProjection

```text
creatorId
standing
healthSummary
programStanding
noticeRef
sourceVersion
updatedAt
```

这是 Creator-facing projection；Risk/Trust 仍拥有风险决定。

## 4. Relationships

```text
User 1 ── 0..1 Creator
Creator 1 ── 1 Profile
Creator 1 ── N Qualification
Creator 1 ── N Verification
Creator 1 ── N Capability
Creator 1 ── 1 Lifecycle
Creator 1 ── N AuthorshipRelation
Creator 1 ── N Collaboration
Creator N ── N OrganizationReference
Creator N ── N AudienceReference
Creator N ── N RightsReference
```

所有跨域关系必须使用稳定 reference，不把其他领域对象整体嵌入 Creator authority。

## 5. State / Version Rules

所有可变权威实体必须具有：

```text
version
updatedAt
createdAt
```

需要并发控制的 mutation 使用 optimistic concurrency：

```text
expectedVersion
→ compare-and-write
→ version + 1
```

版本冲突必须返回稳定错误，不允许静默覆盖。

## 6. Identity / Uniqueness

必须唯一：

- creatorId；
- userId 与 active creator 绑定；
- publicId；
- username（按平台规则区分大小写处理）；
- active capability `(creatorId, capabilityKey)`；
- active lifecycle state 只有一条；
- 每个 collaborationId 唯一。

CreatorId、历史 username、历史 publicId 均不得被不透明复用导致归属混乱。

## 7. Privacy / Data Minimization

默认分级：

```text
PUBLIC
CREATOR_PRIVATE
ORG_SCOPED
ADMIN_ONLY
HIGH_SENSITIVITY
```

禁止通过公共 Creator DTO 暴露：

- 密码；
- session secret；
- recovery secret；
- 原始身份文件；
- 内部风控阈值；
- 内部排序特征；
- 支付凭证原文。

## 8. Delete / Retention

Creator 删除必须遵循：

```text
delete request
→ retention / legal hold check
→ reversible deactivation where applicable
→ dependent-reference handling
→ irreversible deletion when permitted
→ audit evidence
```

删除 Creator 不得非法删除仍被其他领域权威引用的 Content、Rights、Ledger 或审计记录。

## 9. Derived Data

允许派生：

- creator statistics；
- audience summaries；
- creator health summary；
- growth projections；
- search indexes；
- cached profiles。

派生数据必须可重建，禁止成为 Creator authority。

## 10. Runtime Mapping

Cloudflare-first：

```text
D1      = authoritative structured creator state
R2      = large evidence/media/object references where appropriate
Cache   = hot creator read models
KV      = small derived state where justified
Queues  = async propagation / indexing / aggregation
DO      = only when strong creator-scoped coordination is genuinely required
```

## 11. Consistency

权威 mutation：同步确认成功或明确失败。  
派生传播：允许 at-least-once + eventual consistency。  
状态恢复：必须支持 replay/backfill/rebuild。

禁止通过缓存、事件或索引反向制造 Creator 权威事实。

## 12. Acceptance

P0 数据验收至少包括：

- Creator 创建唯一性；
- user/creator 一对零或一绑定；
- profile 版本冲突保护；
- qualification expiry；
- verification revoke/expire；
- capability 状态变化；
- lifecycle 合法迁移；
- authorship provenance；
- collaboration 幂等；
- 私有数据隔离；
- 删除/恢复规则；
- 派生数据可重建；
- 跨域 reference 不生成第二 authority。

## 13. STOP

- 第二 Creator authority；
- 用 Payload collection 取代 Creator domain authority；
- Cache/KV/R2/Event 成为 Creator 事实；
- 复制 Content/Rights/Ledger/Risk 事实；
- 无版本控制；
- 静默覆盖；
- 敏感证据进入普通 API；
- 删除破坏其他领域权威；
- 派生数据不可重建。

## 14. Status

```text
DATA CONTRACT = COMPLETE
IMPLEMENTATION = PENDING
CL / CI = NOT RUN
```
