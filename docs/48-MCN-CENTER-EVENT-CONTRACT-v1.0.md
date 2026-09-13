# LuckRead MCN Center Event Contract v1.0

**状态：EVENT-CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：MCN Center 跨域事件、异步处理、幂等、顺序、重试与重建契约。**

## 1. 目标

承接：

- `44-MCN-CENTER-EXPERIENCE-AND-OPERATING-SYSTEM-CONTRACT-v1.0.md`
- `45-MCN-CENTER-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md`
- `46-MCN-CENTER-DATA-CONTRACT-v1.0.md`
- `47-MCN-CENTER-API-CONTRACT-v1.0.md`

核心原则：

```text
Authoritative Command
→ Commit authoritative state
→ Domain Event
→ Queue / Consumer
→ Derived State / Notification / Analytics / Workflow
```

事件是跨域协作机制，不是第二套数据库，也不能替代权威事务状态。

## 2. Event Envelope

所有 MCN Domain Event 使用统一 envelope：

```json
{
  "eventId": "evt_...",
  "eventType": "mcn.creator.affiliation.activated",
  "eventVersion": "1.0",
  "occurredAt": "2026-09-13T00:00:00Z",
  "producer": "mcn-domain",
  "actorId": "user_...",
  "organizationId": "org_...",
  "targetType": "creator_affiliation",
  "targetId": "aff_...",
  "correlationId": "corr_...",
  "causationId": "evt_...",
  "requestId": "req_...",
  "idempotencyKey": "...",
  "schemaVersion": "1.0",
  "payload": {}
}
```

禁止在事件中携带不必要的密码、token、完整支付凭证、内部风险规则或其他敏感原文。

## 3. Event Naming

统一：

```text
<domain>.<aggregate>.<action>
```

例如：

```text
mcn.organization.created
mcn.member.invited
mcn.member.joined
mcn.member.role_changed
mcn.creator.affiliation.created
mcn.creator.affiliation.activated
mcn.creator.affiliation.terminated
mcn.content.assigned
mcn.content.batch_operation.completed
mcn.asset.referenced
mcn.ip.linked
mcn.rights.changed
mcn.collaboration.created
mcn.collaboration.approved
mcn.campaign.started
mcn.campaign.paused
mcn.revenue.attributed
mcn.settlement.created
mcn.settlement.reconciled
mcn.settlement.paid
mcn.task.failed
mcn.moderation.completed
mcn.copyright.incident_created
```

事件名称必须稳定；业务语义变化必须升级 eventVersion/schemaVersion。

## 4. Organization Events

### mcn.organization.created
触发：机构创建成功并提交权威状态后。

用途：
- 初始化派生 Dashboard；
- 创建默认组织配置；
- 通知需要初始化的异步系统。

### mcn.organization.status_changed
payload 最小包含：

```text
organizationId
previousStatus
currentStatus
reasonCode
```

不得暴露内部风控细节。

## 5. Membership / RBAC Events

```text
mcn.member.invited
mcn.member.joined
mcn.member.removed
mcn.member.role_changed
mcn.team.created
mcn.team.member_assigned
mcn.permission.changed
```

敏感权限变更必须先完成权威授权状态提交，再发布事件。

消费者：
- Audit
- Notification
- Access cache invalidation
- Analytics

权限事件不能被客户端直接伪造。

## 6. Creator Affiliation Events

```text
mcn.creator.invited
mcn.creator.affiliation.created
mcn.creator.affiliation.activated
mcn.creator.affiliation.suspended
mcn.creator.affiliation.terminated
mcn.creator.affiliation.disputed
```

用途：
- Creator 机构视图更新；
- 团队分配；
- 权限范围刷新；
- 商务关系刷新；
- 审计；
- 通知。

事件不能创建新的 Creator identity。

## 7. Content Operations Events

```text
mcn.content.assigned
mcn.content.unassigned
mcn.content.batch_operation.created
mcn.content.batch_operation.completed
mcn.content.batch_operation.partially_completed
mcn.content.published
mcn.content.unpublished
mcn.content.restored
```

批量操作必须允许：

```text
Completed
Partial
Failed
Cancelled
```

消费者必须能根据 operationId 查询最终结果，不得假设一次事件代表所有资源都成功。

## 8. Asset Events

```text
mcn.asset.referenced
mcn.asset.metadata_changed
mcn.asset.archived
mcn.asset.rights_conflict
```

大文件不进入事件 payload；使用稳定 assetId/reference。

## 9. IP / Rights Events

```text
mcn.ip.linked
mcn.ip.unlinked
mcn.rights.granted
mcn.rights.revoked
mcn.rights.expired
mcn.rights.conflict_detected
mcn.copyright.incident_created
mcn.copyright.restriction_applied
mcn.copyright.restored
```

Rights-sensitive 事件必须包含 provenance/reference 信息，使消费者能够追溯授权来源。

权利撤销事件必须支持下游重新计算受影响资源。

## 10. Audience / Membership Events

MCN 不生产粉丝关系权威事件，只消费相关领域事件并形成机构聚合。

允许订阅：

```text
social.follow.created
social.follow.removed
membership.created
membership.changed
membership.cancelled
community.member.joined
community.member.left
```

MCN 派生：

```text
Creator Audience Summary
Organization Audience Summary
Membership Summary
```

禁止把聚合结果反向当成 Social/Membership 权威事实。

## 11. Collaboration / Campaign Events

```text
mcn.collaboration.created
mcn.collaboration.proposed
mcn.collaboration.approved
mcn.collaboration.rejected
mcn.collaboration.cancelled
mcn.campaign.created
mcn.campaign.started
mcn.campaign.paused
mcn.campaign.resumed
mcn.campaign.completed
```

消费者：
- Creator assignment
- Content workflow
- Analytics
- Notification
- Settlement

## 12. Revenue / Settlement Events

资金事件必须来自 Ledger/Settlement 权威域，而不是由 UI 自己产生。

```text
ledger.revenue.attributed
ledger.entry.created
settlement.created
settlement.calculation.completed
settlement.reconciled
settlement.approved
settlement.paid
settlement.disputed
```

事件 payload 只提供业务所需最小引用与金额语义，不暴露支付敏感信息。

消费者可以更新：
- MCN revenue read model；
- Creator revenue read model；
- Dashboard；
- Notification；
- Audit；
- Reconciliation state。

## 13. Moderation / Risk Events

```text
moderation.submitted
moderation.completed
moderation.restricted
moderation.restored
moderation.appeal.created
moderation.appeal.resolved
risk.enforcement.applied
risk.enforcement.released
```

事件可以携带：

```text
decisionId
policyVersion
status
reasonCode
```

禁止携带内部风险模型、阈值、规则权重或安全检测细节。

## 14. Task Events

```text
mcn.task.created
mcn.task.started
mcn.task.progressed
mcn.task.succeeded
mcn.task.failed
mcn.task.retry_scheduled
mcn.task.cancelled
```

长任务必须可恢复。

Task consumer 不得把重复 `succeeded` 事件解释为第二次业务成功。

## 15. Event Delivery Semantics

默认采用：

**at-least-once delivery + consumer idempotency**。

因此每个消费者必须拥有：

```text
consumerName
→ eventId dedupe
→ handler state
→ retry state
```

禁止依赖“事件只投递一次”。

## 16. Idempotency

消费者处理必须满足：

```text
same eventId
→ same consumer
→ process once logically
```

推荐唯一键：

```text
consumerName + eventId
```

对于需要业务幂等的操作，还应使用：

```text
businessKey + eventVersion
```

重复事件只能：
- 返回已处理结果；或
- 安全忽略；或
- 重新读取权威状态进行 reconcile。

## 17. Ordering

不能假设全局事件顺序。

只在必要时保证同一 aggregate key 的顺序，例如：

```text
organizationId
creatorAffiliationId
contentId
campaignId
settlementId
```

消费者遇到版本倒退：

```text
old version
→ ignore / reconcile
```

不能覆盖较新的权威状态。

## 18. Retry / Backoff

失败分类：

```text
Transient
Permanent
Authorization
Conflict
DependencyUnavailable
PoisonMessage
```

Transient：指数退避 + jitter。  
Permanent：进入失败状态，不无限重试。  
Poison message：隔离到 DLQ / quarantine，并保留诊断引用。

禁止无限快速重试。

## 19. Dead Letter / Recovery

DLQ 事件至少保留：

```text
eventId
consumerName
attemptCount
firstFailedAt
lastFailedAt
errorClass
safeErrorSummary
```

恢复流程：

```text
DLQ
→ Diagnose
→ Fix / Approve Replay
→ Replay with same eventId
→ Idempotent Consumer
→ Reconcile
```

Replay 必须可审计。

## 20. Event Schema Evolution

事件必须向后兼容演进：

```text
v1
→ additive changes
→ compatibility window
→ v2 when breaking
```

禁止静默改变：
- 字段语义；
- 金额单位；
- 状态含义；
- ID 类型；
- nullable semantics。

## 21. Event Security / Privacy

事件 payload 默认最小化。

禁止：
- password
- access token
- refresh token
- payment credential
- raw sensitive risk features
- unnecessary private profile fields

跨域消费者必须根据自身权限获取额外数据，而不是事件默认携带全部对象。

## 22. Event → Derived State

推荐模式：

```text
Authoritative Event
→ Consumer
→ Validate
→ Deduplicate
→ Apply
→ Emit metric/audit if needed
→ Checkpoint
```

Derived read model 必须能够通过：

```text
Authoritative State
+ Event History / Rebuild Input
```

重新生成。

## 23. Event → Analytics

高频行为不能直接作为商业化/推荐事实：

```text
Raw Event
→ Admission
→ Risk / Trust
→ Valid Signal
→ Aggregation
→ Analytics / Recommendation / Growth
```

例如播放、曝光、点赞、分享等事件需要防刷/可信度处理后再进入高价值指标。

## 24. Event Observability

必须监控：

- publish rate
- consumer lag
- processing latency p50/p95/p99
- retry rate
- DLQ count
- duplicate rate
- ordering conflicts
- schema errors
- consumer failure rate
- replay count
- event-to-derived-state freshness

关键事件必须能够通过 `eventId → correlationId → requestId` 追踪完整链路。

## 25. Event Acceptance

P0 必须验证：

1. Creator affiliation 变更产生正确事件；
2. RBAC 变化可被 Audit/Cache consumer 正确消费；
3. 内容批量操作支持 partial result；
4. 重复事件不会重复业务事实；
5. 同 aggregate 的版本倒退不会覆盖新状态；
6. transient failure 会退避重试；
7. poison message 进入隔离；
8. DLQ replay 可审计且幂等；
9. rights revoke 可以触发下游重新计算；
10. settlement 状态事件来自权威 Settlement/Ledger；
11. 高并发事件经过 Trust/Aggregation 后才进入高价值派生；
12. 事件 payload 不包含敏感凭证；
13. schema version 可以演进；
14. consumer lag 和失败可观测；
15. derived read model 可重建。

## 26. STOP Conditions

任一成立，禁止 Event Contract 进入 IMPLEMENTING：

1. Event 没有明确 producer；
2. Event 没有明确 aggregate/target；
3. Event 代替 authoritative transaction；
4. Consumer 没有 idempotency；
5. 默认假设 exactly-once；
6. 没有 retry classification；
7. 没有 DLQ/recovery；
8. sensitive data 直接进入 payload；
9. financial event 不来自 Ledger/Settlement authority；
10. rights event 无 provenance；
11. derived state 无 rebuild path；
12. schema 无 version；
13. external webhook 直接暴露内部 event contract；
14. 高价值指标直接信任 raw high-frequency event；
15. 无 event observability。

## 27. READY Gate

```text
Event Inventory
→ Producer Ownership PASS
→ Envelope PASS
→ Schema PASS
→ Idempotency PASS
→ Ordering PASS
→ Retry PASS
→ DLQ / Replay PASS
→ Security / Privacy PASS
→ Rebuildability PASS
→ Observability PASS
→ Acceptance PASS
→ EVENT-CONTRACT-READY
```

**结论：MCN Center Event Contract v1.0 完成，进入 Permission/Security Contract 阶段；仍保持 IMPLEMENTATION PENDING。**
