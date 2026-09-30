# LuckRead Creator System API Contract v1.0

**状态：API-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System API 与控制面合同**

## 1. API 原则

Creator API 只暴露 Creator authority 与安全的跨域 reference/projection，不暴露 Payload internals、D1 schema、Risk internals 或 Ledger internals。

统一：

```text
/v1/creators
```

控制类 mutation 必须具有 authentication、authorization、scope、idempotency、concurrency、audit。

## 2. Resource Surface

### 2.1 Creator

```text
GET    /v1/creators/:creatorId
PATCH  /v1/creators/:creatorId
```

### 2.2 Profile

```text
GET    /v1/creators/:creatorId/profile
PATCH  /v1/creators/:creatorId/profile
```

### 2.3 Qualification

```text
GET /v1/creators/:creatorId/qualifications
POST /v1/creators/:creatorId/qualifications/:type/appeals
```

### 2.4 Verification

```text
GET  /v1/creators/:creatorId/verification
POST /v1/creators/:creatorId/verification/requests
POST /v1/creators/:creatorId/verification/renew
```

敏感证据通过受控服务端流程处理，不直接返回原始 evidence。

### 2.5 Capability

```text
GET /v1/creators/:creatorId/capabilities
```

Capability mutation 原则上只允许受控系统命令，不允许客户端自行授予能力。

### 2.6 Lifecycle

```text
GET  /v1/creators/:creatorId/lifecycle
POST /v1/creators/:creatorId/lifecycle/transition
```

transition 必须校验合法状态图、actor 权限和风险约束。

### 2.7 Collaboration

```text
GET  /v1/creators/:creatorId/collaborations
POST /v1/creators/:creatorId/collaborations
POST /v1/collaborations/:id/accept
POST /v1/collaborations/:id/reject
POST /v1/collaborations/:id/terminate
```

## 3. Common Request Context

每个 API 请求至少具有：

```text
requestId
actorId
sessionId / appContext
creatorId if applicable
scope
schemaVersion
idempotencyKey for mutation
expectedVersion when concurrent update matters
locale / region when policy-dependent
```

## 4. DTO Rules

Public DTO 与 internal persistence model 必须解耦。

Creator DTO 可以返回：

```text
creatorId
publicId
creatorType
status
profile projection
qualification summary
verification summary
capability summary
standing summary
references
version
updatedAt
```

禁止返回：

- password/session/recovery secrets；
- raw verification evidence；
- internal risk features/thresholds；
- internal ranking inputs；
- ledger private data；
- private organizational secrets。

## 5. Mutation Semantics

所有可重试 mutation 默认使用：

```text
Idempotency-Key
→ validate actor/scope
→ validate expectedVersion
→ execute once
→ persist authority
→ emit event
→ return stable result
```

重复请求必须返回同一业务结果或稳定的 idempotency conflict，不得产生重复事实。

## 6. Pagination / Filtering

集合接口统一 cursor pagination：

```text
cursor
limit
sort
filter
```

默认 limit 必须有上限；禁止无界查询。

## 7. Error Model

统一错误结构：

```json
{
  "code": "CREATOR_VERSION_CONFLICT",
  "message": "safe message",
  "requestId": "...",
  "retryable": false,
  "details": {}
}
```

错误码至少覆盖：

```text
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
QUALIFICATION_REQUIRED
VERIFICATION_REQUIRED
CAPABILITY_UNAVAILABLE
INVALID_LIFECYCLE_TRANSITION
CREATOR_RESTRICTED
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

不得把 D1、Payload、第三方身份服务内部错误原样泄露。

## 8. Authorization

统一链：

```text
Authentication
→ Actor
→ App / Session
→ Scope
→ Creator relation
→ Domain authorization
→ Risk / Policy checks
→ Audit
```

Creator Center、Public Profile、MCN、Open Platform 均必须经过同一 Creator domain authorization，不得各自实现一套绕过规则。

## 9. Cross-Domain API Boundary

| 操作 | API Owner | Authority |
|---|---|---|
| creator profile | Creator | Creator |
| publish content | Content | Content |
| follow | Social | Social |
| membership | Commerce/Membership | Membership/Commerce |
| grant rights | Rights | Rights |
| risk decision | Risk | Risk |
| moderation decision | Moderation | Moderation |
| revenue/settlement | Commerce/Ledger | Ledger |

Creator API 只发起 command 或读取 projection，不伪造跨域事实。

## 10. Rate / Quota

按 actor、creator、app、IP、endpoint 分类限流；高成本操作必须有更严格 quota。

以下操作必须受保护：

- verification request；
- lifecycle transition；
- collaboration creation；
- bulk profile mutation；
- appeal submission。

## 11. Observability

每次 mutation 必须可关联：

```text
requestId
correlationId
actorId
creatorId
action
result
latency
failureClass
```

敏感字段必须 redact。

## 12. Runtime

默认通过 Cloudflare Workers 提供 API。  
D1 为 Creator authority；Cache/KV 为 derived/hot；Queues 用于异步事件；必要时使用 Durable Objects 做强协调。

客户端不得直接访问 D1、R2、Payload internals、Queue 或内部 key。

## 13. API Acceptance

必须验证：

- 未登录无法访问受保护资源；
- 非 owner/operator 无权修改 Creator；
- MCN scope 只允许所属组织资源；
- Open Platform scope 不越权；
- version conflict 被稳定拒绝；
- 重试不会产生重复事实；
- 删除/停用正确传播；
- verification evidence 不泄露；
- Risk/Moderation/Ledger 内部数据不泄露；
- pagination 无法绕过上限；
- 限流生效；
- dependency failure 不泄露内部错误。

## 14. STOP

- API 直接绑定数据库模型；
- 暴露 Payload internals；
- 客户端直接修改 capability；
- API 绕过 domain authorization；
- 无 idempotency；
- 无 concurrency control；
- 返回敏感证据；
- 将 projection 当 authority。

## 15. Status

```text
API CONTRACT = COMPLETE
IMPLEMENTATION = PENDING
CL / CI = NOT RUN
```
