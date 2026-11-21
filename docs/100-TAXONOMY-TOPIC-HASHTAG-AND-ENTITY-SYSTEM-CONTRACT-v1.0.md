# LuckRead Taxonomy / Topic / Hashtag / Entity System Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：L1-06 Taxonomy / Topic / Hashtag / Entity / Classification**

## 1. 目的

统一管理平台内容、Creator、IP、Series、Community、Product 等对象使用的分类、Topic、Hashtag、Entity 与标签语义。

本系统提供“分类与主题事实”，不承担 Search Index、Recommendation Ranking 或 Content Authority。

```text
Taxonomy / Topic = classification authority
Content          = content authority
Search           = derived retrieval
Recommendation   = derived ranking
```

## 2. L1-L4 能力模型

### L2-01 Taxonomy
- L3 Taxonomy Tree
  - L4 root category
  - L4 child category
  - L4 category ordering
- L3 Classification
  - L4 content classification
  - L4 creator classification
  - L4 IP classification
  - L4 community classification
- L3 Lifecycle
  - L4 active
  - L4 deprecated
  - L4 replaced

### L2-02 Topic
- L3 Topic Identity
  - L4 topicId
  - L4 canonical name
  - L4 aliases
- L3 Topic Scope
  - L4 global topic
  - L4 regional topic
  - L4 community topic
  - L4 creator-defined topic
- L3 Topic Lifecycle
  - L4 proposed
  - L4 active
  - L4 restricted
  - L4 archived

### L2-03 Hashtag
- L3 Hashtag Identity
  - L4 normalized hashtag
  - L4 display hashtag
  - L4 alias
- L3 Hashtag Relationship
  - L4 content tagging
  - L4 topic mapping
  - L4 creator tagging
- L3 Hashtag Governance
  - L4 allowed
  - L4 restricted
  - L4 blocked
  - L4 retired

### L2-04 Entity Classification
- L3 Entity Reference
  - L4 person reference
  - L4 organization reference
  - L4 IP reference
  - L4 product reference
  - L4 place/reference entity
- L3 Entity Alias
  - L4 canonical label
  - L4 alternate label
  - L4 localization
- L3 Entity Confidence
  - L4 source
  - L4 confidence reference
  - L4 review state

### L2-05 Content Classification
- L3 Content Taxonomy
  - L4 category reference
  - L4 topic reference
  - L4 hashtag reference
  - L4 entity reference
- L3 Classification Provenance
  - L4 creator-assigned
  - L4 platform-assigned
  - L4 imported/reference-assigned

### L2-06 Trending / Topic Lifecycle
- L3 Trend Eligibility
  - L4 activity reference
  - L4 freshness window
  - L4 safety/quality reference
- L3 Topic Surface State
  - L4 emerging
  - L4 trending
  - L4 cooled
  - L4 suppressed

Trending state is derived from signals; the taxonomy/topic system owns topic identity and governance, not recommendation ranking.

### L2-07 Localization
- L3 Language Variants
  - L4 localized topic name
  - L4 localized category
  - L4 localized hashtag display
- L3 Regional Policy
  - L4 region availability
  - L4 region restriction

### L2-08 Governance
- L3 Policy
  - L4 naming policy
  - L4 classification policy
  - L4 restricted-topic policy
- L3 Merge / Split
  - L4 merge topics
  - L4 split topics
  - L4 alias migration
- L3 Audit
  - L4 actor
  - L4 reason
  - L4 timestamp

## 3. Authority Rules

Owns:

```text
taxonomy definition
topic identity/aliases
hashtag normalization and policy
classification relationships
entity reference semantics
topic lifecycle
taxonomy governance
```

Does not own:

```text
content body
creator identity
legal rights
search index
recommendation score
financial facts
```

## 4. Data Contract

Minimum records:

```text
taxonomyId
parentId
status
version
localizedNames
createdAt
updatedAt
```

Topic:

```text
topicId
canonicalName
aliases
scope
status
version
createdAt
updatedAt
```

Classification edge:

```text
subjectType
subjectId
classificationType
referenceId
source
confidenceRef
status
createdAt
updatedAt
```

Uniqueness, versioning and rebuildability are mandatory.

## 5. API Contract

```text
GET /v1/taxonomies
GET /v1/topics/:id
POST /v1/topics
PATCH /v1/topics/:id
GET /v1/topics/:id/relationships
POST /v1/hashtags/resolve
POST /v1/classifications
DELETE /v1/classifications/:id
GET /v1/entities/:id/classifications
```

Mutations require authentication, authorization, scope, idempotency where applicable, expected version, stable error model, pagination and audit classification.

## 6. Event Contract

```text
taxonomy.created
taxonomy.updated
taxonomy.deprecated
topic.created
topic.updated
topic.merged
topic.split
topic.restricted
hashtag.created
hashtag.updated
hashtag.retired
classification.created
classification.updated
classification.removed
trend.state_changed
```

All events are versioned and idempotent; downstream Search/Feed/Recommendation consumers rebuild derived state from authoritative taxonomy/classification records.

## 7. Permission / Security

```text
Actor
→ Scope
→ Taxonomy/Topic permission
→ Policy validation
→ Mutation
→ Audit
```

Topic restriction and merge/split are privileged operations. Creator-defined labels cannot silently override platform-level policy.

## 8. Runtime / Cost

Cloudflare-first:

```text
Workers
→ D1 authoritative taxonomy/topic/classification state
→ Cache/KV hot topic/lookup views
→ Queues async propagation
```

Hot lookups should use bounded cache reads. Analytics and ranking signals remain downstream derived inputs.

## 9. Acceptance

1. Taxonomy tree has stable IDs and versioned transitions.
2. Topic aliases resolve to one canonical topic.
3. Hashtags normalize deterministically.
4. Classification edges are auditable and idempotent.
5. Topic merge migrates references without losing provenance.
6. Restricted topics are filtered according to policy.
7. Localized names do not create duplicate topic authorities.
8. Search/Recommendation can rebuild derived indexes after taxonomy changes.
9. Creator-defined tags cannot bypass platform governance.
10. No Payload internals are exposed.

## 10. STOP Conditions

- duplicate topic authority;
- Search index becomes topic authority;
- Recommendation score stored as topic fact;
- alias creates duplicate canonical topic;
- restricted topic remains active without policy state;
- classification not auditable;
- merge/split loses provenance;
- unbounded classification scans;
- external client bypasses policy.

## 11. Status

```text
CAPABILITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
