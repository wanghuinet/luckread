# LuckRead Canonical ID / Entity Reference / Uniqueness Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一资源 ID、实体引用、跨 Domain 标识映射和唯一性规则，保证同一逻辑实体不会因不同系统或 Center 产生多个无法解释的身份。

## 2. Canonical Identity

每个 authoritative resource 必须拥有稳定 canonical ID：

```text
immutable
unique within declared authority
non-reused after retirement
opaque to implementation where appropriate
```

## 3. ID Namespaces

资源必须声明 namespace / authority：

```text
user
creator
content
media
ip
order
ledger
community
app
operation
```

不同 authority 可以有同样的局部字符串，但 canonical identity 必须可区分。

## 4. Resource Reference

跨域引用建议使用稳定结构：

```text
resourceType
resourceId
authority
version where required
```

不得依赖数据库表名、内部主键组合或 Payload internal ID 作为长期公共合同。

## 5. External Reference

第三方对象映射必须记录：

```text
externalSystem
externalType
externalId
mappingVersion
source
createdAt
```

外部 ID 不得直接成为 LuckRead canonical authority。

## 6. Uniqueness

每项需要唯一的业务事实必须定义 unique key。

例如：

```text
creator handle
membership subscription
order idempotency
relationship key
app identifier
webhook endpoint ownership
```

## 7. ID Reuse

已删除/退休的 canonical ID 默认不得复用。

特殊例外必须记录原因、范围和风险。

## 8. Mapping Lifecycle

```text
UNMAPPED
→ MAPPED
→ VERIFIED
→ DEPRECATED
→ RETIRED
```

Mapping 失效不得静默指向另一个资源。

## 9. Cross-Domain References

引用方只保存稳定 reference，不复制被引用 Domain 的完整权威事实。

被引用资源删除后，引用状态必须进入：

```text
VALID
UNAVAILABLE
RETIRED
BROKEN
REQUIRES_REVALIDATION
```

## 10. Security

ID 是定位符，不是权限凭证。

```text
resourceId known
≠ authorized
```

## 11. Privacy

不要在 ID 中编码敏感个人信息。

公开 URI 不得通过 ID 规则泄露不应暴露的用户属性。

## 12. Event Interaction

事件 resourceRef 必须能够稳定解析到 canonical identity。

schema/version 变化不得改变历史 resourceId 含义。

## 13. Cache / Search

Cache key / search document ID 可以不同于 canonical ID，但必须存在明确 mapping，且可由 authority 重建。

## 14. Migration

改变 ID scheme 属于高风险 migration，必须支持：

```text
old ID
→ mapping
→ new ID
→ compatibility window
→ verification
→ old retirement
```

## 15. Observability

关键 trace/log 应优先携带 canonical resource ID，而不是数据库内部 rowid。

## 16. Acceptance

验证 uniqueness、non-reuse、cross-domain reference、external mapping、deleted-resource reference、migration mapping、event reference、cache/search mapping 和 authorization separation。

## 17. STOP Conditions

- ID 可复用导致历史记录歧义；
- 内部数据库键成为公共长期合同；
- 外部 ID 成为权威 identity；
- resourceId 可直接绕过 authorization；
- 删除资源后引用无状态；
- migration 无 mapping/verification。

## 18. READY Gate

```text
Canonical ID
→ Namespace
→ Reference
→ Uniqueness
→ Non-reuse
→ External Mapping
→ Deletion Interaction
→ Security
→ Migration
→ Acceptance Evidence
→ READY
```

## 19. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
