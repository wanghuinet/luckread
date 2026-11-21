# LuckRead Content Relationship API Contract v1.0

**状态：API-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Public API

```text
GET  /v1/content/:id/relationships
POST /v1/content/:id/relationships
GET  /v1/content/:id/provenance
GET  /v1/content/:id/versions
POST /v1/content/:id/attribution
GET  /v1/ip/:id/relationships
GET  /v1/relationships/:id
POST /v1/relationships/:id/revoke
```

## 2. Mutation Contract

每个 mutation 必须携带：

```text
requestId
actorId/session context
resource scope
schemaVersion
idempotencyKey
expectedVersion
```

并返回：

```text
resourceId
relationVersion
status
requestId
```

## 3. Rules

- DTO 与 Payload document/internal schema 解耦；
- relationship type 必须经过 registry validation；
- source/target ownership 与 visibility 必须校验；
- remix/derivative/adaptation 在需要时必须验证 Rights authorization reference；
- concurrent writes 使用 optimistic concurrency；
- duplicate idempotency key 返回同一业务结果，不产生第二关系；
- cursor pagination 用于关系列表；
- rate limit 用于公开关系读取和写入；
- 内部 graph storage 不进入公开 API。

## 4. Error Model

统一错误分类至少包括：

```text
RELATION_TYPE_INVALID
SOURCE_NOT_FOUND
TARGET_NOT_FOUND
VISIBILITY_DENIED
OWNER_SCOPE_DENIED
RIGHTS_AUTHORIZATION_REQUIRED
RELATION_CONFLICT
VERSION_CONFLICT
DUPLICATE_REQUEST
RATE_LIMITED
SERVICE_UNAVAILABLE
```

## 5. Security

客户端不得直接指定任意 actor、owner 或 authority 字段；服务端从认证上下文解析。管理接口需要更高 scope 与 audit。

## 6. Compatibility

API version 与 relation schema version 独立管理。新增 relationType 不得破坏现有 DTO；breaking change 必须升级 API version 并提供迁移/兼容窗口。
