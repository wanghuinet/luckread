# LuckRead Data Lifecycle / Retention / Erasure Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义全平台数据从创建、使用、归档、保留、删除到最终清除的生命周期语义，避免各 Domain 形成互相冲突的 retention / deletion 规则。

本合同不创建业务数据权威；它规定所有 Domain 必须遵守的生命周期边界。

```text
Create → Active Use → Archive → Retention → Erasure / Anonymization → Purge
```

## 2. Scope

适用于：

- authoritative business records;
- derived views / indexes;
- cache / KV entries;
- event records;
- analytics data;
- media/object references;
- logs / telemetry;
- audit/evidence records;
- exports;
- backups and replicas;
- legal-hold data。

## 3. Lifecycle Classes

每类数据必须声明 `retentionClass`：

```text
EPHEMERAL
OPERATIONAL
BUSINESS
FINANCIAL
LEGAL_AUDIT
SECURITY
ANALYTICS
DERIVED
BACKUP
```

Retention class 不得由客户端自由指定。

## 4. Authority

Domain Authority 负责业务事实；本合同负责生命周期政策与传播规则。

```text
Business Authority = what the data means
Lifecycle Contract = how long / where / when it may exist
```

任何派生数据不得拥有比 source 更长的默认业务语义生命周期，除非有明确政策或法律依据。

## 5. Required Record

所有纳入生命周期管理的记录至少应能关联：

```text
resourceId
resourceType
ownerSubjectId
retentionClass
lifecycleState
createdAt
updatedAt
retentionUntil (where applicable)
deletedAt (where applicable)
legalHoldRef (nullable)
policyVersion
sourceAuthority
```

## 6. State Model

```text
ACTIVE
→ ARCHIVED
→ RETENTION
→ DELETE_REQUESTED
→ TOMBSTONED
→ ANONYMIZED / PURGED
```

允许 Domain-specific states，但不得破坏全局终态语义。

## 7. Delete Request

删除请求必须是可追踪的 durable operation：

```text
Delete Request
→ Scope Evaluation
→ Legal Hold Check
→ Dependency Plan
→ Source Mutation
→ Propagation
→ Verification
→ Finalization
```

不得把 HTTP 200 当作删除完成的唯一依据。

## 8. Tombstone / Reference Integrity

源记录删除前后可能仍被关系、事件或索引引用。

平台必须支持稳定 tombstone / unavailable semantics，使消费者能够：

- 识别资源已经删除；
- 防止重新物化已删除资源；
- 触发引用重验证；
- 在最终 purge 后停止新的派生生成。

## 9. Derived Data Erasure

删除 authoritative record 后，以下派生数据必须按政策收敛：

```text
Search Index
Recommendation features
Analytics projections
Personal aggregations
Cache / KV
Materialized views
Webhook subscriptions where applicable
```

Propagation 必须可审计并可重试。

## 10. Media / R2 Lifecycle

R2 对象必须与业务资源生命周期关联。

删除流程：

```text
Business resource state
→ object reference invalidation
→ delayed delete where policy allows
→ retention check
→ object purge
→ verification
```

对象删除不能早于仍被合法业务流程引用的最小保留期限。

## 11. Privacy / User Rights

涉及个人数据时必须支持：

- access/export where applicable;
- correction where applicable;
- deletion request;
- anonymization where deletion is prohibited;
- purpose limitation;
- data minimization;
- retention expiry。

法律、财务、审计、安全或权利保留义务可以限制立即物理删除，但必须有可解释状态。

## 12. Legal Hold

Legal Hold 必须覆盖：

```text
holdId
scope
reason
authority
createdAt
expiresAt (nullable)
releaseActor
releasedAt
```

存在有效 Legal Hold 时，受影响数据不得被自动 purge。

## 13. Export

Export 是独立异步 operation：

```text
Requested → Collecting → Packaging → Ready → Expired / Revoked
```

导出内容必须服从当前授权、隐私和 Legal Hold 规则，不得因为历史快照绕过当前权限。

## 14. Backup Interaction

Backup 不得成为绕过删除政策的隐藏永久副本。

删除完成后：

```text
Online Data = no longer user-accessible
Derived Data = invalidated / purged
Backup Copy = expires according to backup retention policy
```

最终恢复系统不得重新引入已完成删除且无合法保留依据的数据。

## 15. Event Semantics

至少支持：

```text
data.retention.started
data.delete.requested
data.tombstoned
data.anonymized
data.purged
data.delete.blocked_by_hold
data.delete.completed
```

事件必须遵守统一 Event Contract，不得凭事件本身重新生成业务事实。

## 16. Reliability / Recovery

必须处理：

```text
duplicate delete request
partial propagation
consumer outage
retry
out-of-order deletion events
resource recreated during deletion
purge task timeout
```

恢复必须最终收敛到明确终态。

## 17. Security

删除、导出、Legal Hold 和 purge 属于高风险操作，必须进行：

```text
Authentication
→ Scope / Role
→ Resource Authorization
→ Policy Check
→ Audit
```

## 18. Performance / Cost

不得同步扫描所有下游系统完成删除请求。

```text
Request → durable operation → asynchronous propagation → verification
```

高频派生数据应批处理；大规模 purge 必须限速并可暂停/恢复。

## 19. Observability

每个生命周期 operation 至少关联：

```text
requestId
correlationId
operationId
resourceId
policyVersion
result
```

必须可查询删除传播延迟和失败率。

## 20. Acceptance

P0 必须验证：

1. 普通资源删除；
2. 删除请求幂等；
3. 派生索引最终删除；
4. cache/KV 失效；
5. R2 生命周期收敛；
6. Legal Hold 阻止 purge；
7. 合法保留期结束后可 purge；
8. export 权限隔离；
9. 失败可恢复；
10. 删除后不得被 replay 重新生成；
11. 审计证据完整；
12. backup 不成为隐藏永久副本。

## 21. STOP Conditions

- 删除无 durable operation；
- 删除状态无法区分 requested/completed；
- 派生索引长期暴露已删除数据；
- cache 重新返回已删除资源；
- Legal Hold 被绕过；
- export 泄露其他用户数据；
- backup 可无限期恢复已删除数据；
- deletion event 能重新创建已删除业务事实；
- 无审计或无法验证最终收敛。

## 22. READY Gate

```text
Retention Classes
→ State Model
→ Delete / Export
→ Legal Hold
→ Derived Erasure
→ Backup Interaction
→ Security
→ Recovery
→ Acceptance
→ Evidence
→ READY
```

## 23. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
