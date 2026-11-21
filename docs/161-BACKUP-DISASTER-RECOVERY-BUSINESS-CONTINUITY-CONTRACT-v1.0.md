# LuckRead Backup / Disaster Recovery / Business Continuity Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义平台在数据损坏、区域/基础设施故障、错误发布、外部依赖中断或灾难事件下的恢复目标、备份、重建和业务连续性。

目标：恢复的不只是服务进程，而是**权威业务状态、派生状态、事件链和可审计性**。

## 2. Recovery Objectives

所有 P0/P1 业务域必须声明：

```text
RPO = Recovery Point Objective
RTO = Recovery Time Objective
MTTR target
maximum acceptable data loss
maximum acceptable inconsistency window
```

未定义 RPO/RTO 的关键系统不得进入生产准入。

## 3. Failure Classes

```text
F1 single request failure
F2 Worker/runtime failure
F3 dependency outage
F4 regional/platform incident
F5 data corruption
F6 accidental deletion / operator error
F7 compromised credential / security incident
F8 catastrophic loss
```

每类故障必须有 detection、containment、recovery、verification 和 closure。

## 4. Backup Scope

至少考虑：

- authoritative D1 data;
- required configuration and policy;
- migration metadata;
- durable event/replay records where required;
- critical R2 object metadata and retention state;
- audit/evidence records;
- deployment/configuration state required for recovery。

Cache/KV 等可重建派生状态不要求成为主备份源，但必须具备 rebuild path。

## 5. D1 / Structured Data Recovery

```text
Detect corruption
→ Freeze unsafe mutation
→ Identify last known-good point
→ Restore / reconstruct authoritative state
→ Apply approved migrations
→ Replay allowed durable events
→ Validate invariants
→ Rebuild derived state
→ Resume traffic
```

恢复不得通过猜测或手工“修正”无法追溯的业务事实。

## 6. R2 / Object Recovery

必须区分：

```text
object exists
object reference valid
object authorized
object lifecycle valid
```

恢复过程中不得因为对象存在就自动重新暴露已删除、受限或无权访问资源。

## 7. Restore Ordering

跨组件恢复必须遵循依赖顺序：

```text
Identity / Security
→ authoritative business state
→ policy / permission state
→ event/replay capability
→ derived indexes/cache
→ external integrations
→ user-facing traffic
```

具体 Domain 可定义更细顺序，但不能先恢复派生层再宣称业务恢复完成。

## 8. Rebuild vs Restore

平台必须明确每个数据对象属于：

```text
RESTORE_REQUIRED
REBUILD_REQUIRED
REBUILD_PREFERRED
EPHEMERAL
```

所有 derived state 必须优先支持重建；不能把缓存备份误当业务备份。

## 9. Backup Integrity

备份必须支持：

```text
backupId
createdAt
sourceVersion
integrity verification
retentionUntil
restore eligibility
restore test result
```

“备份成功”不等于“可恢复”。

## 10. Restore Drills

P0 恢复方案必须定期执行验证性演练，至少覆盖：

- restore success;
- restore duration;
- data integrity;
- permission integrity;
- derived-state rebuild;
- event replay safety;
- deletion/Legal Hold semantics;
- rollback after failed restore。

演练结果必须留存证据。

## 11. Degraded Continuity

灾难或依赖故障期间允许进入明确 degraded mode：

```text
READ_ONLY
PARTIAL_WRITE
ASYNC_ONLY
FEATURE_DEGRADED
MAINTENANCE
```

用户必须看到安全、可解释的状态，不得假装操作已经完成。

## 12. Security Incident Interaction

若灾难由凭据泄露、安全攻击或篡改引起，恢复必须包含：

```text
Contain
→ Credential Revocation
→ Scope Reduction
→ Evidence Preservation
→ Clean Restore
→ Integrity Verification
→ Credential Rotation
→ Controlled Resume
```

## 13. External Dependency Recovery

Live/RTC、Search、Media Processing、Analytics 等外部能力故障不得自动破坏权威业务状态。

恢复后应通过 adapter replay/rebuild 使派生系统重新收敛。

## 14. Business Continuity Priorities

P0 优先级至少：

```text
Authentication / Account Safety
→ Content Read / Publish State Visibility
→ Core Interaction
→ Commerce / Financial Integrity
→ Creator Operations
→ Search / Discovery
→ Analytics / Non-critical Features
```

具体排序必须在 Domain/Incident runbook 中冻结。

## 15. API / Operation Semantics

恢复期间仍必须保持统一 Operation 与 Error 语义。

恢复后重复提交必须不会产生第二次业务副作用。

## 16. Observability / Incident Evidence

恢复过程必须记录：

```text
incidentId
operationId
affectedScope
startAt
detectionAt
containmentAt
restoreAt
verificationAt
resumeAt
result
```

## 17. Acceptance

P0 至少验证：

1. D1 数据恢复；
2. R2 引用与权限一致；
3. 恢复期间安全 degraded mode；
4. 备份完整性校验；
5. restore drill；
6. event replay 不重复副作用；
7. deleted/legal-hold 数据不会错误复活；
8. 依赖恢复后派生状态可重建；
9. rollback 可用；
10. RPO/RTO 有实际证据。

## 18. STOP Conditions

- 没有 P0 RPO/RTO；
- 只有“备份存在”没有 restore evidence；
- 恢复会复活已删除数据；
- 恢复会破坏权限/安全状态；
- event replay 产生重复业务副作用；
- cache 被误当成恢复源；
- 灾难期间无法解释业务状态；
- 没有恢复后的完整性验证。

## 19. READY Gate

```text
RPO/RTO
→ Backup Scope
→ Restore Ordering
→ Integrity
→ Drill
→ Degraded Mode
→ Security Recovery
→ Rebuild
→ Acceptance Evidence
→ READY
```

## 20. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
