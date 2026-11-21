# LuckRead Content Distribution & Syndication System Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：L1-05 Content Distribution & Syndication / P0 分发业务领域**

## 1. 目的

本合同定义内容从已创建内容进入一个或多个分发目的地的规则、资格、版本、计划、执行状态、撤回传播与结果记录。

它不负责内容本体、不负责推荐排序、不负责法律授权、不负责广告投放事实。

```text
Content           = content fact authority
Rights            = legal rights authority
Distribution      = distribution intent / eligibility / execution authority
Recommendation    = personalized ranking authority
Search            = derived retrieval index
Advertising       = paid campaign authority
```

## 2. 核心原则

```text
Create
→ Validate
→ Distribution Eligibility
→ Distribution Plan
→ Publish Target
→ Delivery
→ Observe
→ Withdraw / Update
→ Converge
```

一个内容可以同时拥有多个 distribution target，但必须具有唯一可追踪的 canonical content/version。

## 3. L1-L4 能力模型

### L2-01 Distribution Identity

**L3-01 Distribution Request**
- L4 distributionId
- L4 contentId
- L4 contentVersion
- L4 creator/owner reference

**L3-02 Target Identity**
- L4 targetId
- L4 targetType
- L4 channel reference
- L4 locale/region scope

**L3-03 Uniqueness**
- L4 unique content-version-target key
- L4 duplicate submission detection

### L2-02 Distribution Eligibility

**L3-01 Content Eligibility**
- L4 lifecycle eligible
- L4 moderation eligible
- L4 media processing complete reference

**L3-02 Creator Eligibility**
- L4 creator capability reference
- L4 creator standing reference
- L4 organization scope reference

**L3-03 Rights Eligibility**
- L4 rights authorization reference
- L4 territory reference
- L4 time-window reference

**L3-04 Policy Eligibility**
- L4 regional policy reference
- L4 safety restriction reference
- L4 age/audience restriction reference

### L2-03 Distribution Planning

**L3-01 Target Selection**
- L4 home/feed target
- L4 creator profile target
- L4 search/discovery target reference
- L4 topic/community target
- L4 notification target reference
- L4 external syndication target

**L3-02 Schedule**
- L4 immediate
- L4 scheduled
- L4 embargo
- L4 expiration

**L3-03 Audience Scope**
- L4 public
- L4 followers/subscribers
- L4 membership audience reference
- L4 regional audience

### L2-04 Distribution Execution

**L3-01 Dispatch**
- L4 create delivery job
- L4 execute delivery
- L4 retry
- L4 deduplicate

**L3-02 Delivery State**
- L4 pending
- L4 processing
- L4 delivered
- L4 partially delivered
- L4 failed
- L4 withdrawn

**L3-03 Version Handling**
- L4 target version
- L4 replacement version
- L4 stale delivery detection

### L2-05 Channel / Surface Management

**L3-01 Internal Surfaces**
- L4 feed surface reference
- L4 creator profile surface
- L4 topic surface
- L4 community surface

**L3-02 External Syndication**
- L4 partner target
- L4 syndication policy
- L4 attribution requirement
- L4 canonical reference

**L3-03 Surface Constraints**
- L4 format constraint
- L4 size/duration constraint
- L4 locale constraint
- L4 age/audience constraint

### L2-06 Withdrawal & Update Propagation

**L3-01 Withdraw**
- L4 withdraw request
- L4 target withdrawal
- L4 withdrawal confirmation

**L3-02 Update Propagation**
- L4 metadata update
- L4 version replacement
- L4 stale target invalidation

**L3-03 Convergence**
- L4 target convergence state
- L4 lag detection
- L4 remediation/replay

### L2-07 Distribution Analytics

**L3-01 Delivery Analytics**
- L4 delivered targets
- L4 failed targets
- L4 latency

**L3-02 Distribution Outcome**
- L4 exposure reference
- L4 consumption reference
- L4 conversion reference

**L3-03 Attribution**
- L4 target attribution reference
- L4 source channel reference
- L4 campaign reference

Metrics are derived; they do not become content or revenue authority.

### L2-08 Distribution Governance

**L3-01 Policy**
- L4 target policy
- L4 retention policy
- L4 region policy

**L3-02 Operational Control**
- L4 pause target
- L4 resume target
- L4 replay target
- L4 emergency withdrawal

**L3-03 Audit**
- L4 actor
- L4 decision
- L4 target
- L4 timestamp
- L4 reason

## 4. Authority Boundaries

Distribution System owns:

```text
distribution intent
target binding
distribution eligibility result
delivery lifecycle
target convergence state
```

It must not own:

```text
content body
creator identity
legal ownership/license decision
ranking score
search index
financial balance
advertising campaign fact
```

Recommendation decides ordering after distribution eligibility; it does not decide whether a target delivery record exists.

## 5. Data Contract

Minimum distribution record:

```text
distributionId
contentId
contentVersion
targetId
targetType
scope
eligibilitySnapshotRef
rightsSnapshotRef
policySnapshotRef
scheduleAt
expiresAt
status
attempt
idempotencyKey
createdAt
updatedAt
```

Derived delivery views must be rebuildable from authoritative distribution state plus domain events.

## 6. API Contract

```text
POST /v1/distributions
GET /v1/distributions/:id
PATCH /v1/distributions/:id
POST /v1/distributions/:id/execute
POST /v1/distributions/:id/pause
POST /v1/distributions/:id/resume
POST /v1/distributions/:id/withdraw
POST /v1/distributions/:id/replay
GET /v1/content/:id/distributions
```

Mutations require authentication, authorization, resource scope, idempotency, expected-version/concurrency protection, stable errors, request/correlation IDs and audit where sensitive.

不得暴露 Payload internals、D1 内部表结构或下游推荐/搜索实现细节。

## 7. Event Contract

至少覆盖：

```text
distribution.created
distribution.eligible
distribution.rejected
distribution.scheduled
distribution.dispatched
distribution.delivered
distribution.partially_delivered
distribution.failed
distribution.withdraw_requested
distribution.withdrawn
distribution.version_replaced
distribution.replay_requested
distribution.converged
```

事件统一包含 eventId、eventType、schemaVersion、producer、resourceRef、actorId、occurredAt、correlationId、idempotency/dedupe information。

异步消费者必须支持 retry、DLQ、replay，并保持幂等。

## 8. Permission / Security

```text
Actor
→ Session/App Scope
→ Creator/Organization Scope
→ Distribution Permission
→ Eligibility / Rights / Policy Check
→ Mutation
→ Audit
```

高风险操作：

- 大规模分发；
- 外部渠道授权；
- 紧急撤回；
- 跨区域发布；
- 代表其他 Creator 发布；
- 批量 replay。

## 9. Runtime / Cost

Cloudflare-first：

```text
Workers
→ D1 authoritative distribution state
→ Queues delivery/retry fanout
→ Cache/KV hot distribution status
→ Workflows where durable orchestration is justified
```

单次请求不得同步等待所有目标完成；高 fanout 必须异步化。

## 10. Reliability

必须处理：

```text
duplicate dispatch
retry
timeout
out-of-order event
stale version
partial delivery
channel outage
withdraw race
replay
```

单目标成功不得掩盖其他目标失败；必须提供 per-target status。

## 11. Acceptance

P0 至少验证：

1. 一个内容可创建多个目标分发记录；
2. 同一 content-version-target 不产生重复权威记录；
3. 无资格内容不能进入 delivery；
4. rights/policy 变化可阻止或限制后续分发；
5. scheduled delivery 正确执行；
6. failure 可重试且不重复发布；
7. partial delivery 可准确呈现；
8. withdrawal 能传播并最终收敛；
9. 新版本不会错误覆盖旧版本；
10. Search/Recommendation 故障不阻断 distribution authority；
11. 大 fanout 不导致同步请求超时；
12. 全部敏感 mutation 可审计。

## 12. STOP Conditions

- Distribution 被当作 Content authority；
- Recommendation 被当作 delivery authority；
- Rights 从关系或 target 自动推断；
- 无唯一 target key；
- 无幂等/重试/DLQ/replay；
- withdrawal 无 convergence；
- partial failure 被伪装成 success；
- 外部渠道直接修改权威状态；
- Payload internals 泄漏；
- 无界同步 fanout。

## 13. Status

```text
CAPABILITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
