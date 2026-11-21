# LuckRead Content Relationship & Provenance System Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：L1-04 Content Relationship & Provenance / P0 横向关系领域**

## 1. 目的

本合同定义内容之间的结构关系、来源谱系、衍生链、引用链、转载链、翻译链、版本关系及 IP/Series/Collection 归属关系。

它不是 Content、Creator、Rights、IP、Search 或 Analytics 的第二权威。

```text
Content Relationship = relationship / provenance authority
Content               = content fact authority
Creator               = creator fact authority
Rights                = legal rights authority
IP                    = IP entity authority
Search                = derived index
Analytics             = derived projection
```

## 2. L1-L4 能力模型

### L2-01 Relationship Identity
- L3 Relationship Key
  - L4 relationshipId
  - L4 sourceId
  - L4 targetId
  - L4 relationType
- L3 Direction
  - L4 source→target
  - L4 inverse projection
- L3 Uniqueness
  - L4 unique relation key
  - L4 duplicate detection

### L2-02 Reference Relationships
- L3 Quote
  - L4 quoted-from
  - L4 quote location reference
- L3 Reference
  - L4 references
  - L4 referenced-by projection
- L3 Repost
  - L4 repost source
  - L4 repost attribution

### L2-03 Derivative Relationships
- L3 Remix
  - L4 remix source
  - L4 remix creator reference
  - L4 authorization reference
- L3 Derivative
  - L4 derivative source
  - L4 derivative type
  - L4 derivation provenance
- L3 Adaptation
  - L4 adapted-from
  - L4 adaptation metadata

### L2-04 Transformation Relationships
- L3 Translation
  - L4 translated-from
  - L4 language pair
- L3 Localization
  - L4 locale source
  - L4 localized variant
- L3 Re-edit
  - L4 source version
  - L4 edit lineage

### L2-05 Version & Lifecycle Graph
- L3 Content Version
  - L4 versionId
  - L4 parentVersion
  - L4 canonicalVersion
- L3 Revision
  - L4 revision source
  - L4 revision actor reference
- L3 Rollback
  - L4 rollback target
  - L4 rollback provenance

### L2-06 Collection & Series Graph
- L3 Series
  - L4 series membership
  - L4 episode ordering
- L3 Collection
  - L4 collection membership
  - L4 ordering
- L3 Channel / Space
  - L4 channel membership
  - L4 display position

### L2-07 IP Association Graph
- L3 Content-IP
  - L4 belongs-to-IP
  - L4 associated-with-IP
- L3 Series-IP
  - L4 series association
- L3 Character / Entity
  - L4 entity appearance reference
  - L4 character relationship reference

### L2-08 Creator Attribution Graph
- L3 Authorship
  - L4 primary creator reference
  - L4 co-creator reference
- L3 Production
  - L4 editor reference
  - L4 producer reference
  - L4 publisher reference
- L3 Attribution
  - L4 visible attribution
  - L4 source attribution

### L2-09 Provenance Chain
- L3 Origin
  - L4 original source reference
  - L4 source type
- L3 Transformation History
  - L4 transformation step
  - L4 actor reference
  - L4 timestamp
- L3 Chain Integrity
  - L4 immutable relation event
  - L4 provenance hash/reference
  - L4 broken-chain detection

### L2-10 Relationship Governance
- L3 Visibility
  - L4 public relation
  - L4 private relation
  - L4 restricted relation
- L3 Validity
  - L4 active
  - L4 revoked
  - L4 superseded
- L3 Dispute
  - L4 relation dispute
  - L4 provenance dispute reference
  - L4 resolution reference

## 3. Authority Rules

关系系统只拥有：

```text
relationship existence
relationship type
source/target linkage
provenance sequence
creator attribution reference
relationship lifecycle
```

禁止拥有：

```text
Content body as sole authority
legal ownership decision
license grant decision
creator identity
financial balance
recommendation score
search index
```

法律授权必须由 Rights 系统决定；关系系统只保存授权引用。

## 4. Data Contract

核心实体最少包含：

```text
relationshipId
sourceType
sourceId
targetType
targetId
relationType
relationVersion
status
actorId (nullable)
provenanceRef
authorizationRef (nullable)
createdAt
updatedAt
```

约束：

- source/target 必须存在或处于允许的延迟引用状态；
- relationType 必须注册；
- 同一唯一关系键不得产生重复权威记录；
- 删除 source/target 必须触发关系重验证；
- derived projection 必须可由关系权威数据重建；
- relationship history 不得通过 UI 静默覆盖；
- 敏感关系遵循 visibility/privacy policy。

## 5. API Contract

统一版本前缀：

```text
/v1/content/:id/relationships
/v1/content/:id/provenance
/v1/content/:id/attribution
/v1/content/:id/versions
/v1/ip/:id/relationships
/v1/relationships/:id
```

Mutation 至少要求：

```text
authentication
authorization
resource scope
idempotency key
expected version
stable error model
request/correlation ID
audit requirement
```

不得暴露 Payload internals、内部 D1 表结构或内部 graph storage schema。

## 6. Event Contract

至少定义：

```text
content.relationship.created
content.relationship.updated
content.relationship.revoked
content.provenance.recorded
content.provenance.disputed
content.provenance.resolved
content.version.created
content.version.superseded
content.attribution.changed
content.translation.created
content.remix.created
content.derivative.created
content.series.attached
content.ip.attached
```

统一事件封装：

```text
eventId
eventType
schemaVersion
producer
resourceRef
actorId
occurredAt
correlationId
idempotencyKey
```

异步消费者必须 at-least-once + idempotent；失败进入重试/DLQ/replay 链。

## 7. Permission / Security

权限链：

```text
Actor
→ Session/App Scope
→ Creator/Owner Scope
→ Relationship Permission
→ Rights Check where required
→ Mutation
→ Audit
```

以下操作必须增强保护：

- 创建 Remix/Derivative；
- 修改 attribution；
- 修改 provenance；
- 撤销关键关系；
- 修改 IP/Series 归属；
- 大规模关系删除。

不得因为“来源关系”存在就自动推断具有法律使用权。

## 8. Runtime / Cost

Cloudflare-first：

```text
Workers
→ D1 authoritative relationship state
→ Queues async propagation
→ Cache/KV hot relationship views
→ R2 large provenance evidence when necessary
```

高频关系查询必须优先读取派生/缓存视图；禁止每次请求扫描全关系表。

## 9. Consistency / Reliability

必须处理：

```text
duplicate submission
concurrent relation creation
stale version
out-of-order events
source deletion
rights revocation
replay
partial downstream failure
```

关系创建成功与下游索引成功必须分离；Search/Recommendation/Analytics 故障不得阻断关系权威写入。

## 10. Acceptance

P0 至少验证：

1. quote/reference/repost 可正确建立；
2. remix/derivative 必须保存来源与 provenance；
3. translation/adaptation 可形成有向关系；
4. 同一关系键幂等；
5. concurrent mutation 不产生重复 authority；
6. source 删除后关系进入可审计状态；
7. rights revoke 可触发关系消费方重新校验；
8. attribution 修改可追溯；
9. relationship projection 可重建；
10. 私有关系不会被越权查询；
11. Search/Analytics 故障不阻断关系写入；
12. 不修改或复制 Payload Core。

## 11. STOP Conditions

- Relationship 与 Content 重复成为 authority；
- Provenance 与 Rights 混淆；
- Creator attribution 越权修改 Creator authority；
- duplicate relation；
- 无 source/target 校验；
- 无幂等；
- 删除/撤销后派生视图长期错误；
- 事件不可 replay；
- 外部索引成为同步写入依赖；
- Payload internals 泄漏；
- 关系被错误解释为法律许可。

## 12. Status

```text
CAPABILITY = COMPLETE
CONTRACT   = READY
IMPLEMENTATION = PENDING
```
