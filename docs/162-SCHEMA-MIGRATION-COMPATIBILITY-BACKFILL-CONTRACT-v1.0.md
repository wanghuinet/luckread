# LuckRead Schema / Migration / Compatibility / Backfill Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一规定数据库、API、事件、派生数据和外部集成发生结构变化时的兼容、迁移、回滚和 backfill 规则。

目标是保证 schema 变化不会造成静默数据丢失、跨版本不兼容或无法恢复的半迁移状态。

## 2. Change Classes

所有结构变化必须先分类：

```text
COMPATIBLE
EXPANSIVE
MIGRATORY
BREAKING
EMERGENCY
```

Breaking/Emergency 变化必须具有额外审批与回滚方案。

## 3. Compatibility Principles

默认策略：

```text
Add before Remove
Read old + new before write new-only
Migrate before deprecate
Verify before destructive cleanup
```

不得直接删除仍被生产版本读取的字段、事件或 API 语义。

## 4. Version Domains

以下对象必须独立记录版本：

```text
database schema
API contract
DTO schema
event schema
policy schema
projection/index schema
migration version
pipeline/backfill version
```

## 5. Migration Record

每个 migration 至少包含：

```text
migrationId
sourceVersion
targetVersion
owner
reason
scope
preconditions
steps
validation
rollbackPlan
estimatedCost
startedAt
completedAt
status
```

## 6. State Machine

```text
PLANNED
→ APPROVED
→ READY
→ RUNNING
→ VALIDATING
→ COMPLETED
```

异常：

```text
PAUSED
FAILED
ROLLED_BACK
CANCELLED
```

不得把 migration process exit=0 直接等价为业务迁移完成。

## 7. Expand / Migrate / Contract

推荐：

```text
Expand
→ Dual Read / Compatible Read
→ Backfill
→ Verification
→ Switch Read Path
→ Stop Old Write
→ Cleanup
```

任何 dual-write 必须定义：

- consistency rule;
- source of truth;
- divergence detection;
- repair method;
- termination condition。

## 8. D1 Migration

D1 schema changes 必须：

- 使用版本化 migration；
- 在生产前通过 deterministic validation；
- 明确索引、约束和数据量影响；
- 避免长事务阻塞关键请求；
- 具备失败恢复路径。

不可逆 migration 必须在执行前生成恢复方案或经过明确审批。

## 9. API Compatibility

公共 API 必须支持明确的 compatibility window。

Breaking change 必须：

```text
new version
→ migration notice
→ coexistence window
→ consumer verification
→ old version retirement
```

客户端不能依赖内部 persistence schema。

## 10. Event Compatibility

生产者变更事件 schema 时必须：

- 增量兼容优先；
- schemaVersion 明确；
- consumer compatibility verified；
- replay/backfill 规则明确。

禁止让同一 `eventType` 在无版本变化时改变既有字段语义。

## 11. Backfill Contract

Backfill 是可控的异步 operation：

```text
Plan
→ Scope Freeze
→ Execute
→ Validate
→ Reconcile
→ Close
```

必须支持：

```text
batching
rate limit
pause/resume
checkpoint
retry
idempotency
progress
final count
error count
reconciliation
```

## 12. Backfill Safety

Backfill 不得覆盖未预期的新数据。

必须定义：

```text
selection boundary
snapshot time / watermark
write policy
conflict policy
```

冲突必须进入显式 reconciliation，不得静默以旧数据覆盖新数据。

## 13. Rollback

Migration rollback 必须明确属于：

```text
FULL_ROLLBACK
PARTIAL_ROLLBACK
FORWARD_FIX
NO_ROLLBACK_ALLOWED
```

“No rollback” 必须具有替代恢复路径和批准记录。

## 14. Derived Data Migration

Search index、analytics projection、cache、materialized views 等优先支持：

```text
DROP / REBUILD
```

不得为了保护派生数据而扭曲 authoritative schema。

## 15. Cross-Domain Migration

涉及多个 Domain 时必须定义：

```text
dependency order
compatibility window
cross-domain readiness
failure boundary
reconciliation owner
rollback/forward-fix owner
```

不允许多个 Domain 各自迁移却没有统一收敛判定。

## 16. Deployment Interaction

代码与 schema 必须遵循兼容发布顺序：

```text
Schema Expand
→ Compatible Code
→ Backfill
→ Validation
→ Traffic / Feature Switch
→ Cleanup
```

禁止先部署只理解新 schema 的代码，再执行旧 schema migration。

## 17. Observability

Migration 必须观察：

```text
throughput
latency
error rate
lag
rows processed
rows failed
conflicts
divergence
resource pressure
```

## 18. Cost

大规模 backfill 必须有：

```text
estimated D1 reads/writes
Worker execution budget
Queue usage
R2/network impact where applicable
expected duration
rate cap
```

不得因为迁移一次性制造不可控成本尖峰。

## 19. Acceptance

P0 至少验证：

1. compatible schema change；
2. breaking API version；
3. event versioning；
4. backfill pause/resume；
5. retry idempotency；
6. conflict detection；
7. verification failure；
8. rollback/forward-fix；
9. mixed-version deployment；
10. derived rebuild；
11. production cleanup only after validation。

## 20. STOP Conditions

- migration 无版本/owner；
- 无 compatibility plan；
- 无 rollback/forward-fix；
- backfill 无 checkpoint；
- backfill 可覆盖新数据；
- mixed-version 不兼容；
- event schema 语义静默变化；
- cleanup 早于验证；
- 无 reconciliation owner。

## 21. READY Gate

```text
Change Classification
→ Versioning
→ Compatibility
→ Migration Plan
→ Backfill Safety
→ Validation
→ Rollback / Forward Fix
→ Observability
→ Cost
→ Acceptance Evidence
→ READY
```

## 22. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
