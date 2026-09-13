# LuckRead MCN Center API Contract v1.0

**状态：API-CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：MCN Center 对外稳定 API 边界；不暴露 Payload 内部实现。**

## 1. API 总原则

MCN Center API 面向机构操作、聚合读取与受控命令，不成为新的领域权威层。

```text
Client
→ MCN API
→ Authentication / Authorization / Scope
→ Domain Command / Query
→ Authoritative Domain
→ Event / Derived Read Model
→ API Response
```

统一前缀：

```text
/v1/mcn
```

统一要求：
- requestId
- correlationId
- authenticated actor
- organization context
- permission + resource scope
- DTO/schema validation
- stable error model
- cursor pagination
- idempotency key for mutations
- optimistic concurrency where required
- rate limiting
- audit for sensitive mutations
- no Payload internal types, collections, adapters or implementation details in public response

## 2. API Response Envelope

成功响应建议统一：

```json
{
  "data": {},
  "meta": {
    "requestId": "...",
    "schemaVersion": "1.0"
  }
}
```

列表：

```json
{
  "data": [],
  "meta": {
    "nextCursor": "...",
    "hasMore": true,
    "requestId": "..."
  }
}
```

错误：

```json
{
  "error": {
    "code": "MCN_PERMISSION_DENIED",
    "message": "Permission denied",
    "retryable": false,
    "requestId": "..."
  }
}
```

禁止向客户端暴露内部 SQL、堆栈、Payload internals、风险阈值或安全规则。

## 3. Organization API

### 3.1 Dashboard

```text
GET /v1/mcn/organizations/{organizationId}/dashboard
```

返回机构聚合摘要：
- creator count
- content count
- IP count
- audience summary
- task summary
- revenue/settlement summary
- collaboration summary
- risk/moderation summary

Dashboard 必须读取聚合/缓存模型，不允许请求路径全量扫描 Creator/Content/Event。

### 3.2 Organization Profile

```text
GET   /v1/mcn/organizations/{organizationId}
PATCH /v1/mcn/organizations/{organizationId}
```

PATCH 必须验证 organization scope 和版本冲突。

## 4. Membership / Team / RBAC API

```text
GET    /v1/mcn/organizations/{organizationId}/members
POST   /v1/mcn/organizations/{organizationId}/member-invitations
POST   /v1/mcn/member-invitations/{invitationId}/accept
DELETE /v1/mcn/organizations/{organizationId}/members/{membershipId}
GET    /v1/mcn/organizations/{organizationId}/teams
POST   /v1/mcn/organizations/{organizationId}/teams
PATCH  /v1/mcn/teams/{teamId}
DELETE /v1/mcn/teams/{teamId}
GET    /v1/mcn/organizations/{organizationId}/roles
PUT    /v1/mcn/organizations/{organizationId}/members/{membershipId}/roles
```

敏感角色变更必须：

```text
Authorize → Confirm if required → Idempotency → Audit → Event
```

禁止客户端自行构造 Owner/Admin 权限。

## 5. Creator API

### 查询

```text
GET /v1/mcn/organizations/{organizationId}/creators
GET /v1/mcn/creators/{creatorId}
GET /v1/mcn/creators/{creatorId}/overview
```

支持：
- cursor
- status
- team
- creator search
- growth summary
- content summary
- audience summary
- monetization summary

### 招募 / 绑定

```text
POST /v1/mcn/organizations/{organizationId}/creator-invitations
POST /v1/mcn/creator-invitations/{invitationId}/accept
POST /v1/mcn/organizations/{organizationId}/creators/{creatorId}/affiliation
PATCH /v1/mcn/creator-affiliations/{affiliationId}
POST /v1/mcn/creator-affiliations/{affiliationId}/terminate
```

Creator identity 不由 MCN API 创建第二份权威记录。

## 6. Content Operations API

```text
GET /v1/mcn/organizations/{organizationId}/content
GET /v1/mcn/content/{contentId}
POST /v1/mcn/content/{contentId}/assign
POST /v1/mcn/content/batch-operations
POST /v1/mcn/content/{contentId}/publish
POST /v1/mcn/content/{contentId}/unpublish
POST /v1/mcn/content/{contentId}/restore
```

查询支持：
- creator
- team
- contentType
- lifecycle
- moderationStatus
- copyrightStatus
- createdAt range
- updatedAt range

批量操作必须提供：

```text
operationId
idempotencyKey
selected resource version / filter snapshot
requestedBy
```

超过安全规模时应转异步 Task，而不是同步执行超长请求。

## 7. Asset API

```text
GET  /v1/mcn/organizations/{organizationId}/assets
POST /v1/mcn/assets/{assetId}/reference
PATCH /v1/mcn/assets/{assetId}/metadata
POST /v1/mcn/assets/{assetId}/archive
```

媒体二进制不通过 MCN API 作为大响应体传输；API 返回授权后的媒体引用/URL 或 upload session reference。

## 8. IP / Rights API

```text
GET  /v1/mcn/organizations/{organizationId}/ips
GET  /v1/mcn/ips/{ipId}
POST /v1/mcn/ips/{ipId}/relationships
PATCH /v1/mcn/ip-relationships/{relationshipId}
POST /v1/mcn/ip-relationships/{relationshipId}/revoke
GET  /v1/mcn/ips/{ipId}/rights
GET  /v1/mcn/ips/{ipId}/provenance
```

版权和授权操作必须经过 Rights/Authorization boundary。

禁止用普通 Creator/Content API 绕过 Rights。

## 9. Audience / Membership API

```text
GET /v1/mcn/organizations/{organizationId}/audience/summary
GET /v1/mcn/creators/{creatorId}/audience/summary
GET /v1/mcn/creators/{creatorId}/memberships
GET /v1/mcn/creators/{creatorId}/community/summary
```

不提供默认的“下载全部粉丝隐私数据”接口。

导出必须单独授权、审计，并遵守隐私/区域政策。

## 10. Collaboration / Campaign API

```text
GET  /v1/mcn/organizations/{organizationId}/collaborations
POST /v1/mcn/organizations/{organizationId}/collaborations
GET  /v1/mcn/collaborations/{collaborationId}
PATCH /v1/mcn/collaborations/{collaborationId}
POST /v1/mcn/collaborations/{collaborationId}/approve
POST /v1/mcn/collaborations/{collaborationId}/cancel

GET  /v1/mcn/organizations/{organizationId}/campaigns
POST /v1/mcn/organizations/{organizationId}/campaigns
GET  /v1/mcn/campaigns/{campaignId}
PATCH /v1/mcn/campaigns/{campaignId}
POST /v1/mcn/campaigns/{campaignId}/pause
POST /v1/mcn/campaigns/{campaignId}/resume
```

预算、扣款、结算等资金事实不得由 Campaign API 直接写余额。

## 11. Revenue / Settlement API

```text
GET /v1/mcn/organizations/{organizationId}/revenue/summary
GET /v1/mcn/organizations/{organizationId}/revenue/attributions
GET /v1/mcn/organizations/{organizationId}/settlements
GET /v1/mcn/settlements/{settlementId}
POST /v1/mcn/settlements/{settlementId}/approve
POST /v1/mcn/settlements/{settlementId}/dispute
GET /v1/mcn/settlements/{settlementId}/statement
```

Payout 等高风险金融操作必须使用明确的 financial authorization，并通过 Ledger/Settlement domain。

禁止：

```text
PATCH /balance
POST /balance/increment
```

## 12. Analytics API

```text
GET /v1/mcn/organizations/{organizationId}/analytics/overview
GET /v1/mcn/organizations/{organizationId}/analytics/creators
GET /v1/mcn/organizations/{organizationId}/analytics/content
GET /v1/mcn/organizations/{organizationId}/analytics/ip
GET /v1/mcn/organizations/{organizationId}/analytics/revenue
```

所有指标响应必须至少具备：

```text
metricKey
value
windowStart
windowEnd
metricVersion
calculatedAt
```

禁止把 analytics endpoint 当成 authoritative mutation endpoint。

## 13. Task Center API

```text
GET  /v1/mcn/organizations/{organizationId}/tasks
GET  /v1/mcn/tasks/{taskId}
POST /v1/mcn/tasks/{taskId}/retry
POST /v1/mcn/tasks/{taskId}/cancel
```

Task 查询必须支持 cursor。

Retry 必须检查：
- retryable
- actor permission
- current task version
- idempotency
- dependency state

## 14. Audit API

```text
GET /v1/mcn/organizations/{organizationId}/audit
GET /v1/mcn/audit/{auditId}
```

默认只允许有 Audit 权限的角色读取。

敏感字段应脱敏；Audit 本身不能被普通成员删除/修改。

## 15. Batch API Contract

MCN Center 必须支持批量运营，但批量不等于无限制同步写入。

```text
POST /v1/mcn/batch-operations
GET  /v1/mcn/batch-operations/{operationId}
POST /v1/mcn/batch-operations/{operationId}/cancel
```

流程：

```text
Validate Scope
→ Freeze Operation Intent
→ Create Operation ID
→ Queue
→ Execute with Idempotency
→ Partial Result
→ Reconcile
→ Final Result
```

必须支持部分成功/失败，不允许把整个批量操作简单视为单个数据库事务。

## 16. Webhook / External Integration

未来开放平台可以提供：

```text
POST /v1/mcn/integrations
GET  /v1/mcn/integrations
DELETE /v1/mcn/integrations/{integrationId}
```

Webhook 事件必须：
- signed
- versioned
- replay-safe
- retryable
- observable

不得把内部事件结构直接作为长期外部合同。

## 17. Pagination / Filtering

默认使用 cursor pagination：

```text
?cursor=...
&limit=50
```

限制：
- server-defined max page size
- stable ordering
- filter validation
- no arbitrary expensive sort
- no unbounded offset scan for large datasets

## 18. Concurrency / Idempotency

Mutation 必须支持：

```text
Idempotency-Key
If-Match / version
requestId
```

典型场景：
- creator attach
- batch publish
- batch delete
- campaign approve
- settlement approve
- payout request
- rights grant/revoke

重复请求必须返回相同业务结果或明确的 conflict，而不能产生重复事实。

## 19. Authorization Model

每次请求至少验证：

```text
Actor
→ Organization Membership
→ Role
→ Permission
→ Resource Scope
→ Resource State
→ Action Policy
```

不能只检查：

```text
user.role === admin
```

资源级授权必须在服务端执行。

## 20. Error Contract

核心错误类别：

```text
MCN_AUTH_REQUIRED
MCN_PERMISSION_DENIED
MCN_SCOPE_DENIED
MCN_RESOURCE_NOT_FOUND
MCN_RESOURCE_VERSION_CONFLICT
MCN_INVALID_STATE
MCN_IDEMPOTENCY_CONFLICT
MCN_RATE_LIMITED
MCN_TASK_IN_PROGRESS
MCN_TASK_NOT_RETRYABLE
MCN_RIGHTS_CONFLICT
MCN_MODERATION_BLOCKED
MCN_FINANCIAL_REVIEW_REQUIRED
MCN_SERVICE_DEGRADED
```

错误必须告诉客户端“能否重试”和“下一步是什么”，但不得泄露安全敏感内部原因。

## 21. API Security

P0：
- authentication
- authorization
- CSRF protection where applicable
- rate limiting
- request size limits
- input validation
- output filtering
- audit
- credential rotation
- secure webhook signing
- replay protection

API credential 不得通过普通日志输出。

## 22. API Compatibility

规则：

```text
/v1
→ backward compatible evolution
```

禁止静默：
- 改变字段含义；
- 删除必需字段；
- 改变状态语义；
- 改变金额单位；
- 改变分页顺序；
- 改变权限含义。

破坏性变更必须新版本或明确迁移窗口。

## 23. API Observability

每个请求至少关联：

```text
requestId
correlationId
actorId
organizationId
route
result
latency
status
```

关键指标：
- p50/p95/p99 latency
- error rate
- authorization denial rate
- idempotency conflict rate
- batch success/failure
- task duration
- dashboard query cost
- rate-limit events

## 24. P0 API Acceptance

必须可执行验证：

1. MCN 登录后可读取 Dashboard；
2. 无权限成员不能读取受保护 Creator；
3. Creator invitation 可幂等；
4. Creator affiliation 不创建重复关系；
5. 内容批量操作支持异步 Task；
6. 重复发布不会产生重复业务事实；
7. IP/版权操作经过授权边界；
8. Campaign 不直接修改余额；
9. Settlement 可读取并审计；
10. Analytics 明确为 derived；
11. Task 支持失败恢复；
12. Audit 可追踪敏感操作；
13. 大列表使用 cursor；
14. API 不暴露 Payload internals；
15. API 在高数据量下不依赖全表扫描；
16. 错误响应稳定且不泄露内部安全信息。

## 25. STOP Conditions

任何一个条件出现都禁止 API 进入 IMPLEMENTING：

1. endpoint 没有明确 domain owner；
2. endpoint 创建第二套权威状态；
3. mutation 没有 idempotency；
4. 资源级授权缺失；
5. 财务操作绕过 Ledger；
6. Rights 操作绕过 Rights domain；
7. analytics API 被当作事实写入口；
8. 大列表使用无限 offset/full scan；
9. batch 没有 Task/partial failure 模型；
10. Payload internal types 出现在 response contract；
11. 外部 webhook 直接复用内部 event schema；
12. error 暴露 SQL/stack/risk/security internals；
13. API 破坏兼容性没有版本策略；
14. acceptance test 不可执行。

## 26. READY Gate

```text
API Surface Inventory
→ Domain Ownership PASS
→ DTO / Schema PASS
→ Authorization / Scope PASS
→ Idempotency PASS
→ Pagination PASS
→ Error Contract PASS
→ Security PASS
→ Audit PASS
→ Event Boundary PASS
→ Compatibility PASS
→ Observability PASS
→ Acceptance PASS
→ API-CONTRACT-READY
```

**结论：MCN Center API 边界冻结为候选 v1.0。下一阶段应建立 Event Contract，随后完成 Permission/Security Contract 与 executable acceptance，再进入 READY。**
