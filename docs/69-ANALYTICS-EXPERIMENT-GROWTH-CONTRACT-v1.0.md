# LuckRead Analytics / Experiment / Growth Contract v1.0

**Status: PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：统一指标、分析、实验与增长决策边界；Analytics 是派生事实与决策支持层，不是业务权威数据源。**

## 1. Purpose

Analytics / Experiment / Growth 负责把平台事件转化为可解释、可复算、可审计的指标与实验结果。

核心链路：

```text
Raw Event
→ Event Quality / Risk
→ Valid Event
→ Aggregation
→ Metric
→ Experiment / Analysis
→ Decision
→ Product Action
→ New Event
```

禁止形成：

```text
Analytics
→ 修改业务事实
```

## 2. Authority Boundary

权威关系：

```text
User / Content / Interaction / Commerce / Ledger / Rights / Risk
= Domain Fact Authority

Analytics
= Measurement / Aggregation / Interpretation Authority

Experiment
= Controlled Decision Evidence

Growth
= Action / Lifecycle Orchestration Layer
```

Analytics 不拥有 User、Content、Creator、Wallet、Ledger、Rights 或 Risk 的最终事实。

## 3. Core Objects

```text
Event
Event Quality Record
Metric Definition
Metric Observation
Dimension
Cohort
Funnel
Experiment
Experiment Assignment
Experiment Exposure
Experiment Outcome
Growth Journey
Growth Trigger
Growth Action
Growth Policy
Attribution Record
Analytics Snapshot
```

## 4. Event Contract

平台事件至少包含：

```text
id
name
version
actorId / subjectId
entityType
entityId
sessionId
deviceId
occurredAt
receivedAt
source
schemaVersion
correlationId
requestId
properties
```

事件必须支持：

- 去重；
- 延迟到达；
- 重放；
- schema version；
- source traceability。

事件不是自动可信事实。

## 5. Event Quality

事件进入 Analytics 前应经过：

```text
Schema Validation
→ Deduplication
→ Timestamp Validation
→ Identity / Session Validation
→ Risk / Trust Filtering
→ Event Quality Classification
```

质量状态：

```text
VALID
SUSPECT
INVALID
DUPLICATE
LATE
REJECTED
```

无效事件不得直接进入核心指标。

## 6. Metric Definition

指标必须有明确契约：

```text
metricId
name
ownerDomain
definition
formula
sourceEvents
filters
dimensions
window
timeZone
version
status
```

每个指标必须能够回答：

```text
是什么？
怎么算？
数据从哪里来？
哪些事件被排除？
时间窗口是什么？
版本是什么？
谁负责？
```

## 7. Metric Types

至少支持：

```text
COUNT
SUM
AVERAGE
RATE
RATIO
DISTINCT_COUNT
PERCENTILE
RETENTION
FUNNEL_CONVERSION
TIME_TO_EVENT
```

金融金额指标必须引用 Ledger / Settlement 权威事实，而不能由普通行为事件估算最终财务结果。

## 8. Metric Layers

建议分层：

```text
L0 Raw Events
L1 Validated Events
L2 Atomic Metrics
L3 Derived Metrics
L4 Business KPIs
L5 Decision Signals
```

下游指标不得绕过上游事实层直接创造不可解释的结果。

## 9. Time Semantics

必须区分：

```text
occurredAt
receivedAt
processedAt
attributionAt
```

支持：

- event-time aggregation；
- late events；
- watermark；
- timezone-aware reporting；
- backfill。

报表必须明确统计时间语义。

## 10. Dimensions / Segments

维度可以来自：

```text
User
Creator
Content
IP
Organization / MCN
Device
Region
Language
Traffic Source
Platform
Experiment
Campaign
Time
```

敏感维度必须经过 Privacy / Policy 检查。

Segment 是派生查询对象，不得成为身份权威。

## 11. Cohort

Cohort 定义必须包含：

```text
cohortId
entryCondition
entryTimeWindow
membershipRule
observationWindow
version
```

用户 cohort membership 必须可复算。

## 12. Funnel

Funnel 由有序事件组成：

```text
Entry
→ Step 1
→ Step 2
→ Step N
→ Conversion
```

必须定义：

- session scope；
- user scope；
- attribution window；
- duplicate policy；
- timeout；
- late event policy。

## 13. Experiment

实验对象：

```text
Experiment
Experiment Variant
Assignment
Exposure
Outcome
```

实验状态：

```text
DRAFT
→ REVIEWING
→ READY
→ RUNNING
→ PAUSED
→ COMPLETED
→ ARCHIVED
```

异常：

```text
CANCELLED
INVALIDATED
```

## 14. Experiment Assignment

Assignment 必须稳定、可解释、可重现。

核心字段：

```text
experimentId
subjectKey
variantId
assignmentVersion
assignedAt
source
```

默认要求：

```text
同一 experiment + subject
→ 稳定 variant
```

不得因缓存丢失导致用户在同一实验中随机漂移。

## 15. Exposure

Exposure 表示用户真正接触实验条件。

```text
Assignment ≠ Exposure
```

只有满足 Exposure Criteria 的主体才能进入实验效果分析。

这可以避免“被分配但从未看到实验”的污染。

## 16. Experiment Safety

实验必须定义：

```text
primaryMetric
secondaryMetrics
guardrailMetrics
eligiblePopulation
exclusionRules
sampleRatio
minimumRuntime
stopPolicy
```

Guardrail 至少可以覆盖：

- crash/error rate；
- latency；
- abuse/risk；
- retention；
- complaint rate；
- financial loss；
- creator/content health。

## 17. Statistical Contract

实验结果至少应支持：

```text
control
variant
sample size
metric value
absolute delta
relative delta
confidence / uncertainty
analysis window
```

不得仅使用“点击率更高”作为自动上线依据。

具体统计方法由 Experiment Analytics 实现层决定，但必须版本化。

## 18. Experiment Decision

结果状态：

```text
INCONCLUSIVE
POSITIVE
NEGATIVE
GUARDRAIL_FAILED
INVALID
```

自动推广必须受到预先批准的 Policy 控制。

Analytics 不得自行改变生产业务配置。

## 19. Growth Model

Growth 不等于简单发送通知。

标准链路：

```text
Signal
→ Eligibility
→ Growth Policy
→ Action
→ Outcome
→ Measurement
```

典型 Growth Action：

- onboarding；
- creator activation；
- content creation prompt；
- follow recommendation；
- retention reminder；
- membership conversion；
- creator growth task；
- re-engagement。

## 20. Growth Eligibility

Growth Action 必须检查：

```text
identity
consent
privacy
region
age / eligibility
risk status
frequency cap
experiment assignment
current lifecycle state
```

不得因为“增长目标”绕过安全、隐私或用户控制。

## 21. Frequency / Fatigue Control

Growth 触达必须支持：

```text
per-action cap
per-channel cap
per-user cap
per-day cap
per-week cap
cooldown
quiet hours
```

高价值但高频的行为不能无限触达用户。

## 22. Creator Growth

Creator Growth 只提供决策支持与动作编排，不直接成为 Creator Authority。

可提供：

```text
Activation Score
Content Consistency
Audience Growth
Engagement Quality
Retention
Monetization Readiness
Risk Signals
Growth Recommendations
```

所有评分必须包含版本与解释依据。

## 23. Recommendation Input Boundary

推荐系统可以消费 Analytics 输出，但不能把未经验证的 Analytics Score 当作事实。

推荐链：

```text
Raw Event
→ Quality / Risk
→ Valid Signal
→ Feature / Metric
→ Recommendation Model
→ Ranking
→ Exposure
→ Outcome
```

Feedback Loop 必须防止：

```text
Recommendation
→ Artificial Engagement
→ Metric Inflation
→ Recommendation Reinforcement
```

## 24. Attribution

Attribution 用于回答：

```text
哪个来源？
哪个 Campaign？
哪个 Creator？
哪个 Content / IP？
哪个实验？
产生了哪个结果？
```

必须记录：

```text
attributionModel
window
source
version
confidence
```

不同业务域不得假定使用同一个 Attribution Model。

## 25. Financial Boundary

Analytics 不得直接产生资金事实。

正确链路：

```text
Analytics / Attribution Evidence
→ Financial Validation
→ Ledger
→ Settlement
```

错误链路：

```text
Dashboard Revenue
→ Wallet Balance
```

Revenue Dashboard 是展示层，Ledger 才是金融事实。

## 26. Privacy / Consent

Analytics 必须支持：

```text
purpose limitation
consent state
data minimization
retention policy
access control
regional policy
```

用户撤回相关同意后，新的非必要分析用途不得继续收集相应数据。

需要删除/导出的数据必须能够映射到平台的数据生命周期策略。

## 27. Security / Access

建议权限：

```text
VIEW_ANALYTICS
MANAGE_METRIC
CREATE_EXPERIMENT
APPROVE_EXPERIMENT
VIEW_EXPERIMENT_RESULT
MANAGE_GROWTH_POLICY
RUN_BACKFILL
VIEW_RESTRICTED_ANALYTICS
```

生产实验配置、敏感分析数据与普通 Dashboard 查询应分权。

## 28. Cache / Queue / Storage

推荐：

```text
Raw Event → Queue / Durable Processing
Validated Event → Analytics Storage
Metric → Materialized / Cacheable Result
Experiment Assignment → Stable State
Dashboard → Cache
```

缓存和物化结果都必须可重建。

## 29. Backfill / Reprocessing

Analytics 必须支持：

```text
historical backfill
schema migration
metric version migration
late event replay
invalid event correction
```

重新计算不能无痕覆盖旧结果。

结果必须标识：

```text
metricVersion
pipelineVersion
calculatedAt
sourceWindow
```

## 30. Audit

必须审计：

- Metric Definition changes
- Experiment creation/change
- Experiment approval
- Assignment policy change
- Growth policy change
- Manual backfill
- Data correction
- Restricted data access
- Automated decision policy change

审计至少包含：

```text
actorId
action
targetType
targetId
reason
requestId
correlationId
createdAt
```

## 31. API Contract

代表性 API：

```text
GET  /v1/analytics/metrics
GET  /v1/analytics/metrics/{id}
GET  /v1/analytics/metrics/{id}/observations
POST /v1/analytics/backfills
GET  /v1/analytics/cohorts/{id}
GET  /v1/analytics/funnels/{id}
POST /v1/experiments
GET  /v1/experiments/{id}
POST /v1/experiments/{id}/approve
POST /v1/experiments/{id}/pause
GET  /v1/experiments/{id}/results
POST /v1/growth/actions/evaluate
POST /v1/growth/actions/execute
GET  /v1/growth/cohorts/{id}
```

Mutation API 必须使用权限、版本、幂等和审计控制。

## 32. Event Contract

代表性事件：

```text
analytics.event.accepted
analytics.event.rejected
analytics.metric.updated
analytics.backfill.started
analytics.backfill.completed
experiment.created
experiment.approved
experiment.assignment.created
experiment.exposure.recorded
experiment.completed
experiment.invalidated
growth.signal.created
growth.action.evaluated
growth.action.executed
growth.action.suppressed
```

事件必须包含：

```text
eventId
entityId
version
occurredAt
correlationId
```

## 33. Reliability / Performance

P0：

- 原始事件接收不得阻塞核心业务请求；
- 指标计算必须可重试；
- 重复事件不得无限放大指标；
- Dashboard 查询不得阻塞写入；
- Experiment Assignment 必须稳定；
- Experiment Exposure 必须可验证；
- Backfill 必须可暂停、恢复和审计；
- 高并发统计应通过聚合、缓存和批处理降低成本；
- 分析系统故障不得改变业务权威事实。

## 34. Rebuildability

以下对象必须可重建：

```text
Metric Observation
Cohort Membership
Funnel Result
Experiment Result
Growth Dashboard
Creator Growth Score
```

无法从事件/权威事实重建的派生结果不得成为长期唯一数据源。

## 35. Acceptance Criteria

Implementation readiness requires：

- Event schema
- Event quality classification
- Metric Definition
- Metric versioning
- Time semantics
- Dimensions
- Cohort
- Funnel
- Experiment lifecycle
- Assignment stability
- Exposure distinction
- Guardrail metrics
- Statistical result contract
- Growth policy
- Frequency control
- Attribution boundary
- Financial boundary
- Privacy / consent
- Security / access
- Backfill / replay
- Audit
- API contract
- Event contract
- Rebuildability

## 36. STOP Conditions

以下任一条件出现，禁止进入实现：

1. Analytics 成为 User / Content / Creator / Wallet / Ledger 等领域的事实权威；
2. 原始行为事件未经质量与风险处理直接进入核心指标；
3. 指标没有定义、公式、来源或版本；
4. Experiment Assignment 不稳定；
5. Assignment 被误当作 Exposure；
6. 实验没有 Guardrail；
7. Analytics 可以直接修改生产业务状态；
8. Dashboard Revenue 可以直接修改 Wallet / Ledger；
9. Growth 绕过 Consent / Privacy / Risk；
10. Backfill 可以无审计覆盖历史结果；
11. Cache / Materialized Result 成为唯一事实来源；
12. 推荐反馈可以无限自增强并污染指标；
13. 敏感分析数据没有最小权限；
14. 派生结果无法重建且没有批准的数据保留理由。

## 37. Admission Status

```text
PRODUCT-ARCHITECTURE-COMPLETE
→ CONTRACT-READY
→ IMPLEMENTATION PENDING
```

本契约冻结 Analytics / Experiment / Growth 的事实、指标、实验和增长边界，为 Feed、Recommendation、Creator Growth、Advertising、Commerce、Marketplace 等系统提供统一的测量与决策基础，但不复制任何业务域的权威事实。
