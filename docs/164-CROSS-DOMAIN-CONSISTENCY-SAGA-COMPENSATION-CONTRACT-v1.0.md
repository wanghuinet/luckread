# LuckRead Cross-Domain Consistency / Saga / Compensation Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一规定跨 Domain 业务流程如何在没有共享事务的前提下保持可解释、可恢复、最终收敛的一致性。

```text
Cross-Domain Transaction
≠ shared database transaction
```

平台优先采用命令、事件、Saga、补偿与 reconciliation。

## 2. Scope

适用于涉及两个及以上业务 Domain 的流程，例如：

```text
Content → Rights → Moderation → Distribution
Order → Payment → Entitlement → Ledger
Creator → Commerce → Settlement
Membership → Payment → Entitlement
Content → Search / Recommendation / Analytics
Account Deletion → Content / Social / Commerce / Rights
```

## 3. Authority Rule

每一步只能由对应 Domain 修改自身权威事实。

Orchestrator / Saga Coordinator：

- 协调；
- 记录流程状态；
- 发送 commands/events；
- 触发补偿；
- 不得成为业务事实第二权威。

## 4. Saga Record

每个跨域 Saga 至少包含：

```text
sagaId
sagaType
initiator
correlationId
currentStep
state
startedAt
updatedAt
completedAt
failureClass
compensationState
```

## 5. Step Contract

每一步必须定义：

```text
stepId
domainOwner
command
precondition
authoritativeMutation
successEvent
failureEvent
compensationAction
timeout
retryPolicy
```

## 6. State Machine

```text
STARTED
→ EXECUTING
→ WAITING_DEPENDENCY
→ COMPLETED
```

异常：

```text
FAILED
COMPENSATING
COMPENSATED
PARTIALLY_COMPENSATED
RECONCILING
MANUAL_REVIEW
```

不能长期停留在“成功但部分完成”而无下一步。

## 7. Consistency Levels

跨域流程必须声明：

```text
STRONG_REQUIRED
EVENTUAL
BEST_EFFORT
HUMAN_REVIEW_REQUIRED
```

金融、权限、权益、删除等高风险场景不得未经批准使用不可解释的 best-effort。

## 8. Compensation

补偿不是简单反向执行，必须按业务语义定义。

例如：

```text
Payment authorized
but entitlement grant failed
→ revoke/void/refund according to payment state
```

必须避免补偿本身产生第二次副作用。

## 9. Timeout

Saga step timeout 后：

```text
stop unsafe retry
→ determine whether outcome is unknown
→ query authoritative status
→ continue / compensate / reconcile
```

不得把 timeout 直接解释成“失败”而忽略服务端可能已经成功。

## 10. Unknown Outcome

所有外部调用必须能够表达：

```text
SUCCESS
FAILURE
UNKNOWN
```

UNKNOWN 必须进入查询、reconciliation 或人工处理路径。

## 11. Idempotency

Saga、step、command、compensation 都必须具有幂等边界。

```text
sagaId + stepId + operation key
```

重试不能产生第二次资金、库存、权益、发布或权限副作用。

## 12. Cross-Domain Event Boundary

成功步骤通过事件通知下游：

```text
Domain A authoritative mutation
→ Event
→ Domain B reaction
```

Domain B 不得直接修改 Domain A 数据。

## 13. Reconciliation

每个关键跨域流程必须定义可重算的 reconciliation：

```text
Expected State
vs
Observed Authoritative State
```

发现 divergence 后必须：

```text
classify
→ repair / compensate
→ verify
→ close
```

## 14. Financial / Rights / Security Priority

以下场景必须优先保证正确性：

```text
Money
Entitlement
Rights
Identity / Security
Deletion / Privacy
```

即使牺牲即时 UX，也不得产生无法追溯的错误事实。

## 15. Partial Success UX

跨域流程部分完成时，用户看到：

```text
Completed steps
Pending steps
Failed steps
Next action
Expected resolution
```

不得显示“全部成功”除非所有 required steps 已完成。

## 16. Recovery

恢复流程必须支持：

```text
resume
retry safe step
compensate
reconcile
manual escalation
```

## 17. Security

Saga command 必须沿用原始 actor/scope context；内部协调器不能通过“内部身份”绕过原始授权。

敏感流程必须审计：

```text
actor
scope
sagaId
stepId
action
result
reason
```

## 18. Performance / Cost

高并发流程不得建立跨域同步链式 fan-out。

优先：

```text
command
→ authoritative mutation
→ event
→ async reaction
```

## 19. Observability

整个 Saga 必须能够通过：

```text
sagaId
correlationId
stepId
resourceId
eventId
```

重建完整时间线。

## 20. Acceptance

P0 至少验证：

1. dependency success；
2. dependency failure；
3. timeout with unknown outcome；
4. duplicate command；
5. duplicate event；
6. partial completion；
7. compensation；
8. compensation failure；
9. reconciliation；
10. restart/resume；
11. financial correctness；
12. rights/entitlement correctness。

## 21. STOP Conditions

- 跨域共享数据库事务成为默认方案；
- Saga coordinator 修改业务事实；
- timeout 被错误当成 definitive failure；
- compensation 无幂等；
- partial success 无状态；
- divergence 无 reconciliation；
- 内部协调身份绕过授权；
- 金融/权限/权益错误无法追溯。

## 22. READY Gate

```text
Saga Definition
→ Step Ownership
→ Consistency Level
→ Idempotency
→ Timeout / UNKNOWN
→ Compensation
→ Reconciliation
→ Security
→ Observability
→ Acceptance Evidence
→ READY
```

## 23. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
