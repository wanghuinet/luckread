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

## 5. 搜索基础设施集成

### 5.1 Meilisearch

LuckRead 不自行实现全文检索、纠错、同义词、基础 Facet/Filter 等通用搜索引擎能力。优先通过 **Meilisearch** 提供搜索索引能力；Meilisearch 的索引始终属于派生层，可从 D1/其他权威域重建。Meilisearch 官方资料确认其支持全文搜索、过滤、联邦/混合检索能力，并可自托管开源引擎。 citeturn1search8turn1search14

集成边界：

```text
D1 / Domain Authority
→ Domain Event / Queue
→ Search Index Adapter
→ Meilisearch
→ Search API Adapter
→ /v1/search
```

要求：

- Worker 不直接暴露 Meilisearch 管理 API；
- master/admin key 只能存在服务端；
- index schema 与 LuckRead Search DTO 解耦；
- 索引写入至少一次 + 幂等；
- delete/hide 必须最终收敛；
- index 可全量重建；
- 热门查询可由 Cloudflare Cache/KV 做结果缓存；
- Meilisearch 故障不得阻断 Content/User 等权威写入；
- Search API 必须能够返回 degraded/partial 状态，而不是泄露内部引擎错误。

### 5.2 Semantic / Vector Search

语义检索属于 Search/Discovery 的派生检索能力，不建立第二套内容权威库。初期可以保留 Vector Search Adapter 接口；需要独立向量数据库时再接入 Qdrant 等成熟 OSS。Cloudflare 自身也提供 Vectorize，因此在引入外部向量数据库前应优先评估 Cloudflare 原生能力。 citeturn0search2

```text
Authoritative Content
→ Embedding / Index Pipeline
→ Vector Adapter
→ Vector Index
→ Candidate Retrieval
→ Eligibility / Ranking
```

禁止把向量索引当作 Content/IP/User 的最终事实。

## 6. API

统一 `/v1/search`，必须具备 requestId、cursor、schemaVersion、稳定错误模型、rate limit、权限过滤和查询超时预算。

禁止公开内部搜索引擎实现细节。

## 7. Event

至少覆盖：content.created/updated/published/hidden/deleted、creator.updated、ip.updated、topic.updated、live.started/ended、community.updated。

索引消费必须 at-least-once + idempotent。

## 8. 安全 / 隐私 / 权利

搜索结果必须经过 visibility、block/mute、地域政策、moderation、copyright、account restriction 过滤。

不得因为索引而绕过原始资源权限。

## 9. 性能 / 成本

- autocomplete 必须有严格延迟预算
- 默认 cursor pagination
- 禁止无界 full scan
- 热门 query 可缓存
- 搜索索引异步更新
- 高峰流量优先缓存热门结果
- Search Engine 不得成为 D1 写入链路的同步依赖

## 10. UX

必须覆盖：空查询、无结果、纠错、加载、超时、部分结果、权限受限、删除内容、弱网、返回原位置。

## 11. Acceptance

P0 必须验证：关键词搜索、实体搜索、过滤、分页、联想、热门搜索、权限过滤、删除后索引收敛、索引重建、超时恢复、恶意查询限流、跨用户隐私隔离。

## 12. STOP

- Search Index 被当作权威状态
- 绕过权限/隐私
- 无法重建索引
- 无界查询
- Recommendation 与 Search 职责混淆
- 删除/隐藏内容继续稳定暴露
- 无查询限流
- API 暴露内部搜索引擎 schema
- Search Engine 故障阻断权威写入

## 13. READY

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
