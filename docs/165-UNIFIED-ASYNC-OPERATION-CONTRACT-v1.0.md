# LuckRead Unified Async Operation Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义所有长时、异步、可恢复操作的身份、状态、进度、查询、取消、重试与最终完成语义。

## 2. Applicable Operations

包括但不限于：

```text
upload
media processing
export
publish
moderation
appeal
settlement
payout
backfill
migration
deployment
report generation
support case processing
bulk operations
```

## 3. Core Principle

```text
HTTP Request Result
≠
Operation Final Result
```

请求只表示操作是否被接受；最终结果必须由 durable operation state 表示。

## 4. Operation Record

统一字段至少包含：

```text
operationId
operationType
resourceType
resourceId
actorId / subjectId
scope
state
progress
createdAt
startedAt
updatedAt
completedAt
expiresAt
idempotencyKey
correlationId
errorCode
resultRef
owner
```

## 5. State Machine

```text
ACCEPTED
→ QUEUED
→ RUNNING
→ SUCCEEDED
```

异常/终态：

```text
FAILED
CANCEL_REQUESTED
CANCELLED
EXPIRED
PARTIALLY_COMPLETED
REQUIRES_ACTION
```

`UNKNOWN` outcome 必须允许存在，直到 authoritative reconciliation 完成。

## 6. Idempotency

同一业务意图重复提交必须映射到同一 operation 或得到确定的 dedupe 结果。

```text
business intent
→ idempotency key
→ operation
```

## 7. Progress

进度必须区分：

```text
accepted
started
work completed
verification completed
finalized
```

百分比只能在有可靠分母时提供，不得伪造确定性进度。

## 8. Query Contract

统一查询至少支持：

```text
GET /v1/operations/{operationId}
```

返回必须包含：

```text
state
safe status explanation
next action where applicable
retryable
cancelable
updatedAt
```

## 9. Cancellation

取消不是保证立即停止执行。

状态必须能够表示：

```text
CANCEL_REQUESTED
→ STOPPING
→ CANCELLED
```

若已经完成且无法取消，应返回明确 final state。

## 10. Retry

Retry 必须由 operation policy 定义：

```text
retryable
maxAttempts
backoff
safeRetryCommand
sideEffect protection
```

对 unknown outcome，必须先查询 authoritative result，再决定 retry/compensate。

## 11. Failure Model

错误至少分为：

```text
VALIDATION
AUTHORIZATION
TRANSIENT
DEPENDENCY
RESOURCE
POLICY
TIMEOUT
UNKNOWN_OUTCOME
SYSTEM
```

客户端只能得到安全可解释的 error code / reason category；内部敏感细节不得泄露。

## 12. Partial Completion

批量/多阶段 operation 可以进入：

```text
PARTIALLY_COMPLETED
```

必须列出：

```text
completed scope
pending scope
failed scope
next recovery action
```

## 13. Operation Expiration

临时 operation 必须定义 `expiresAt` 和结果保留期。

过期后查询必须返回明确 expired semantics，不得返回“404 就当没发生”。

## 14. Security / Scope

Operation 必须绑定原始 actor 与 scope。

任何读取 operation 状态的请求也必须经过授权；不能因为知道 operationId 就获得敏感结果。

## 15. Storage / Runtime

Cloudflare-first：

```text
Workers
→ D1 authoritative operation state
→ Queues / Workflows async execution
→ Cache/KV derived progress where safe
→ R2 result artifact where applicable
```

## 16. Recovery

平台必须支持：

```text
resume
retry
reconcile
compensate
manual intervention
```

操作 worker 重启后不得丢失 operation identity。

## 17. Observability

至少关联：

```text
operationId
requestId
correlationId
resourceId
eventId
owner
latency
state transitions
```

## 18. Acceptance

P0 至少验证：

1. request accepted then worker delayed；
2. duplicate submit；
3. worker restart；
4. timeout；
5. unknown outcome；
6. retry safety；
7. cancellation；
8. partial completion；
9. expiration；
10. authorized query；
11. recovery/resume；
12. final state verification。

## 19. STOP Conditions

- 长任务没有 operationId；
- HTTP success 被当最终成功；
- retry 可重复副作用；
- unknown outcome 被直接判失败；
- operation 状态不可查询；
- operation 查询绕过授权；
- worker 重启导致任务丢失；
- partial completion 无恢复路径。

## 20. READY Gate

```text
Operation Identity
→ State Machine
→ Idempotency
→ Progress
→ Query
→ Cancel
→ Retry
→ Failure
→ Recovery
→ Security
→ Observability
→ Acceptance Evidence
→ READY
```

## 21. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
