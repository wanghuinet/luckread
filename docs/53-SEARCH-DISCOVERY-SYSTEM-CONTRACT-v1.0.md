# LuckRead Search / Discovery System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Search / Discovery 是全站发现系统，负责让用户通过关键词、实体、关系和兴趣找到 User、Creator、Content、IP、Topic、Live、Series、Community、Product 等对象。

它不是数据库的简单 LIKE 查询，也不是 Recommendation 的替代品。

## 2. 边界

```text
Query
→ Normalize
→ Intent / Entity Understanding
→ Candidate Retrieval
→ Eligibility / Privacy / Safety
→ Ranking
→ Result Composition
→ Feedback
```

Search 负责“用户主动寻找”；Discovery 负责“用户探索相关内容”。Recommendation 负责个性化排序。

## 3. 核心能力

- 全站搜索
- 用户/作者搜索
- 内容搜索
- IP/Series/Universe 搜索
- Topic/Hot Topic
- Live/Community 搜索
- 联想词
- 搜索历史
- 热门搜索
- 纠错与同义词
- Filter / Sort / Facet
- 相关推荐与探索
- 多语言/本地化准备
- 安全与版权过滤

## 4. 数据权威

Search Index 是派生数据，不是权威事实。

```text
Authoritative Domain
→ Domain Event
→ Indexing Pipeline
→ Search Index
→ Query
```

索引损坏必须可从权威数据重建。

## 5. API

统一 `/v1/search`，必须具备 requestId、cursor、schemaVersion、稳定错误模型、rate limit、权限过滤和查询超时预算。

禁止公开内部搜索引擎实现细节。

## 6. Event

至少覆盖：content.created/updated/published/hidden/deleted、creator.updated、ip.updated、topic.updated、live.started/ended、community.updated。

索引消费必须 at-least-once + idempotent。

## 7. 安全 / 隐私 / 权利

搜索结果必须经过 visibility、block/mute、地域政策、moderation、copyright、account restriction 过滤。

不得因为索引而绕过原始资源权限。

## 8. 性能 / 成本

- autocomplete 必须有严格延迟预算
- 默认 cursor pagination
- 禁止无界 full scan
- 热门 query 可缓存
- 搜索索引异步更新
- 高峰流量优先缓存热门结果

## 9. UX

必须覆盖：空查询、无结果、纠错、加载、超时、部分结果、权限受限、删除内容、弱网、返回原位置。

## 10. Acceptance

P0 必须验证：关键词搜索、实体搜索、过滤、分页、联想、热门搜索、权限过滤、删除后索引收敛、索引重建、超时恢复、恶意查询限流、跨用户隐私隔离。

## 11. STOP

- Search Index 被当作权威状态
- 绕过权限/隐私
- 无法重建索引
- 无界查询
- Recommendation 与 Search 职责混淆
- 删除/隐藏内容继续稳定暴露
- 无查询限流
- API 暴露内部搜索引擎 schema

## 12. READY

```text
Product Boundary
→ L1-L4 Traceability
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security
→ Test/Acceptance
→ Performance/Cost
→ Observability
→ CI Evidence
→ User Acceptance
→ READY
```

当前：**IMPLEMENTATION PENDING**。
