# LuckRead Unified Error / State Taxonomy Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一所有 API、异步 Operation、Domain、Center 和 Worker 的错误与状态表达，保证系统行为和用户反馈可解释、可机器处理、可安全恢复。

## 2. Error Envelope

所有对外错误必须使用稳定 envelope：

```text
requestId
code
category
severity
message
userSafeReason
retryable
retryAfter
operationId (nullable)
detailsRef (nullable)
```

禁止直接返回数据库、第三方服务或内部 stack trace。

## 3. Error Categories

统一分类：

```text
VALIDATION
AUTHENTICATION
AUTHORIZATION
NOT_FOUND
CONFLICT
POLICY
RATE_LIMIT
DEPENDENCY
TIMEOUT
UNKNOWN_OUTCOME
RESOURCE_EXHAUSTED
INTERNAL
UNAVAILABLE
```

Domain 可以增加子码，但不得改变顶层语义。

## 4. Severity

```text
INFO
WARN
ERROR
CRITICAL
```

Severity 描述影响，不代表 HTTP status。

## 5. Retryability

错误必须明确：

```text
RETRY_SAFE
RETRY_AFTER
DO_NOT_RETRY
UNKNOWN_RESULT
```

`UNKNOWN_RESULT` 必须优先查询 authoritative state。

## 6. Business State Vocabulary

跨系统通用状态包括：

```text
DRAFT
PENDING
PROCESSING
ACTIVE
PAUSED
SUCCEEDED
FAILED
CANCELLED
EXPIRED
RESTRICTED
SUSPENDED
DELETED
ARCHIVED
```

Domain 可以扩展，但必须声明映射关系。

## 7. State ≠ Error

```text
PENDING + HTTP 202 = operation ongoing
FAILED + HTTP 200 = semantically invalid unless explicitly query result envelope
```

HTTP status 不能取代业务状态。

## 8. State Transition Rules

关键状态转换必须：

```text
versioned
validated
auditable
idempotent where applicable
```

非法转换必须稳定返回 `CONFLICT` 或专用 state-transition error。

## 9. User-Safe Explanation

用户可见失败至少回答：

```text
What happened?
Why?
Impact?
Can retry?
Next action?
Recovery?
```

敏感安全信息不得暴露内部规则、风控阈值或凭据细节。

## 10. Partial State

聚合系统必须能够表达：

```text
PARTIAL_SUCCESS
PARTIAL_FAILURE
DEGRADED
STALE
```

不能把缺失的下游数据伪装成正常完整数据。

## 11. Domain Extension Rule

Domain 可以定义：

```text
DomainErrorCode
DomainState
```

但必须映射到平台公共 category/severity/retry semantics。

## 12. API Contract

所有 API 至少定义：

```text
success schema
error schema
HTTP mapping
business state mapping
retryability
idempotency interaction
```

## 13. Async Operation Interaction

异步 API 必须优先返回：

```text
accepted
operationId
currentState
```

最终成功/失败通过 Operation state 查询。

## 14. Event Interaction

事件失败不应被直接变成 API 错误，除非权威操作尚未完成。

消费者内部错误必须记录 failure classification 并进入 retry/DLQ/recovery 链。

## 15. Security / Privacy

错误信息不得泄露：

- password/token;
- secret keys;
- internal risk scores;
- moderation evidence;
- private resource existence when enumeration-sensitive;
- internal infrastructure topology。

## 16. Localization

机器稳定 `code` 不得随语言变化。

`message/userSafeReason` 可本地化。

## 17. Observability

错误至少可关联：

```text
requestId
correlationId
traceId
operationId
resourceId
code
category
```

## 18. Acceptance

P0 至少验证：

1. validation error；
2. authorization error；
3. conflict；
4. rate limit；
5. dependency outage；
6. timeout unknown outcome；
7. partial aggregation；
8. async operation failure；
9. localized safe reason；
10. sensitive-error redaction。

## 19. STOP Conditions

- API 没有稳定 error code；
- 客户端依赖内部错误文本；
- retryability 未定义；
- timeout 结果未知却被当确定失败；
- partial data 被伪装成完整；
- 错误暴露 secrets/internal topology；
- Domain 自定义错误无法映射公共语义。

## 20. READY Gate

```text
Envelope
→ Category
→ Severity
→ Retryability
→ State Vocabulary
→ Transition Rules
→ User-safe Explanation
→ Async Mapping
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
