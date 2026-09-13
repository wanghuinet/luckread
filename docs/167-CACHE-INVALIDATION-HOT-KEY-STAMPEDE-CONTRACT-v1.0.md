# LuckRead Cache / Invalidation / Hot-Key / Stampede Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一规定 Cache/KV/derived view 的一致性、版本、失效、热点保护和回源策略。

核心原则：

```text
Cache = derived / acceleration layer
Authority = Domain source of truth
```

## 2. Cache Classes

```text
HTTP/CDN
Application Cache
KV
Materialized View
Local In-memory where applicable
```

所有缓存必须声明 owner、source、freshness 和 invalidation strategy。

## 3. Cache Record

至少关联：

```text
cacheKey
resourceType
resourceId
sourceAuthority
sourceVersion
createdAt
expiresAt
staleAfter
policyVersion
```

## 4. Versioned Read

缓存命中只能在版本/新鲜度满足策略时作为结果来源。

高风险权限、金融、Rights、安全状态不得仅依赖不可验证的 stale cache。

## 5. Invalidation

权威状态变化后必须能够触发：

```text
source mutation
→ version change
→ invalidation event
→ cache purge / mark stale
→ rebuild
```

禁止只有 TTL 而没有业务失效路径的关键缓存。

## 6. Stale Policy

缓存状态至少分：

```text
FRESH
STALE-BUT-SAFE
STALE-DISALLOWED
MISS
```

不同 Domain 必须声明可接受的 stale window。

## 7. Cache Stampede

热点 miss 必须防止大量请求同时回源：

```text
request burst
→ single-flight / bounded refresh
→ cached result
```

可使用 Durable Objects 或其他受控协调方式，但不得建立新的业务权威。

## 8. Hot-Key

必须监测高频 key，并可：

```text
replicate
prewarm
coalesce
rate-limit
serve stale-safe value
```

不能因为单个 hot key 让 D1 或 Worker 被集中击穿。

## 9. Negative Cache

Not Found / restricted / unavailable 等结果可以缓存，但必须具有短且有界的 TTL，并在资源恢复/创建时及时失效。

## 10. Write Path

默认：

```text
Validate
→ Authoritative Mutation
→ Event
→ Invalidate / Update derived cache
```

禁止先写 cache 再把 cache 当成功依据。

## 11. Read-Through / Refresh

回源失败时，只能在策略允许时返回 stale-safe 数据。

不得以 stale data 覆盖已经发生的高风险权威变化。

## 12. Delete Interaction

Data Lifecycle 删除完成后：

```text
invalidate
→ prevent resurrection
→ purge / expire
```

旧 cache entry 不得重新物化已删除资源。

## 13. Cross-Domain Cache

聚合 Center cache 必须记录来源与版本，不得合并多个 authority 成不可解释快照。

## 14. Cost

缓存策略必须比较：

```text
cache hit value
vs
storage cost
vs
invalidation cost
vs
stale risk
```

不能因为追求更高 hit rate 而引入无法维护的复杂状态。

## 15. Observability

至少监测：

```text
hit rate
miss rate
stale rate
invalidation lag
refresh latency
hot-key rate
stampede prevented
origin load
```

## 16. Acceptance

P0 至少验证：

1. normal hit；
2. miss and rebuild；
3. concurrent hot-key miss；
4. stampede protection；
5. stale-safe read；
6. invalidation after update；
7. delete invalidation；
8. negative cache expiry；
9. origin outage；
10. cache corruption/rebuild。

## 17. STOP Conditions

- cache 成为 authority；
- 关键状态只有 TTL 无业务失效；
- stale cache 可绕过安全/Rights/financial restriction；
- delete 后可从 cache 复活；
- hot-key 可无界击穿 origin；
- stampede 无保护；
- cache schema 无版本。

## 18. READY Gate

```text
Owner / Source
→ Version
→ Freshness
→ Invalidation
→ Stampede
→ Hot-Key
→ Failure
→ Delete
→ Cost
→ Observability
→ Acceptance
→ READY
```

## 19. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
