# LuckRead Membership & Subscription System Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：L1-07 Membership & Subscription / P0 核心业务领域**

## 1. 目的与边界

Membership & Subscription 负责会员计划、订阅计划、订阅生命周期、权益定义、资格授予与撤销、续费/取消状态及创作者侧会员运营关系。

它不成为 User、Creator、Commerce、Payment、Wallet/Ledger、Content 或 Social 的第二权威。

```text
Membership / Subscription = entitlement lifecycle authority
User                     = identity authority
Creator                  = creator authority
Commerce / Payment       = transaction authority
Wallet / Ledger          = financial fact authority
Social                   = relationship projection / social graph authority
Content                  = content authority
```

## 2. L1-L4 能力模型

### L2-01 Membership Product
- L3 Membership Plan
  - L4 planId
  - L4 plan name
  - L4 plan tier
  - L4 billing interval reference
- L3 Plan Lifecycle
  - L4 draft
  - L4 active
  - L4 paused
  - L4 retired
- L3 Plan Scope
  - L4 creator membership
  - L4 community membership
  - L4 platform membership reference

### L2-02 Subscription
- L3 Subscription Identity
  - L4 subscriptionId
  - L4 subscriber reference
  - L4 plan reference
- L3 Subscription Lifecycle
  - L4 pending
  - L4 active
  - L4 grace
  - L4 paused
  - L4 canceled
  - L4 expired
- L3 Renewal
  - L4 renewal state
  - L4 next renewal reference
  - L4 failed renewal reference

### L2-03 Entitlement
- L3 Entitlement Definition
  - L4 entitlementId
  - L4 capability reference
  - L4 content/access scope
- L3 Grant
  - L4 grant state
  - L4 effectiveAt
  - L4 expiresAt
- L3 Revocation
  - L4 revoke reason reference
  - L4 revokedAt
  - L4 downstream invalidation trigger

### L2-04 Creator Membership Operations
- L3 Membership Offering
  - L4 creator plan reference
  - L4 tier reference
  - L4 benefit reference
- L3 Member Management
  - L4 active member projection
  - L4 member lifecycle
  - L4 member access summary
- L3 Creator Analytics Reference
  - L4 member growth
  - L4 churn reference
  - L4 revenue summary reference

### L2-05 Access Policy
- L3 Content Access
  - L4 member-only content reference
  - L4 tier-gated content reference
- L3 Community Access
  - L4 member community reference
  - L4 role/entitlement reference
- L3 Feature Access
  - L4 member-only feature reference
  - L4 entitlement check

### L2-06 Subscription Changes
- L3 Upgrade / Downgrade
  - L4 upgrade request
  - L4 downgrade request
  - L4 effective time
- L3 Pause / Resume
  - L4 pause
  - L4 resume
- L3 Cancellation
  - L4 cancel request
  - L4 end-of-period cancellation
  - L4 immediate cancellation reference

### L2-07 Grace / Recovery
- L3 Failed Payment State
  - L4 payment failure reference
  - L4 grace period
  - L4 recovery state
- L3 Access Continuity
  - L4 temporary entitlement continuation
  - L4 entitlement suspension
- L3 Recovery Completion
  - L4 restored subscription
  - L4 restored entitlement

### L2-08 Membership Governance
- L3 Eligibility
  - L4 age/region/program eligibility reference
  - L4 creator eligibility reference
- L3 Policy
  - L4 membership policy state
  - L4 abuse restriction reference
- L3 Dispute / Appeal
  - L4 membership dispute
  - L4 access dispute
  - L4 resolution reference

## 3. Authority Rules

本系统拥有：

```text
membership plan lifecycle
subscription lifecycle
entitlement lifecycle
membership access state
creator membership offering state
```

本系统不拥有：

```text
payment authorization
payment settlement fact
wallet balance
order truth
user identity
creator identity
legal rights
content body
social graph truth
```

付费交易由 Commerce/Payment 边界执行；最终资金事实进入 Wallet/Ledger。Membership 只根据受信交易结果形成订阅/权益状态。

## 4. Data Contract

核心实体最少包含：

```text
planId
subscriptionId
subscriberId
creatorId (nullable)
planVersion
status
startAt
currentPeriodEnd
cancelAt (nullable)
entitlementSnapshotRef
createdAt
updatedAt
```

要求：

- 每个订阅只存在一个当前权威生命周期状态；
- 计划变更使用版本化，不静默修改历史计划语义；
- entitlement 必须可以追溯到 plan/version；
- 订阅与付款事实通过稳定引用关联，不复制财务权威；
- 过期、取消、暂停必须可重放；
- 删除/隐私策略不得破坏必要审计记录。

## 5. API Contract

统一版本前缀：

```text
/v1/membership/plans
/v1/membership/subscriptions
/v1/membership/subscriptions/:id
/v1/membership/entitlements
/v1/creators/:id/membership/plans
/v1/creators/:id/membership/members
```

Mutation 要求：

```text
authentication
authorization
scope
idempotency key
expected version
stable error model
request/correlation ID
rate/quota
observability
```

客户端不得直接修改 entitlement 状态；必须通过受授权命令或受信事件改变。

## 6. Event Contract

至少定义：

```text
membership.plan.created
membership.plan.activated
membership.plan.retired
membership.subscription.created
membership.subscription.activated
membership.subscription.renewal_due
membership.subscription.renewed
membership.subscription.payment_failed
membership.subscription.grace_started
membership.subscription.paused
membership.subscription.resumed
membership.subscription.canceled
membership.subscription.expired
membership.entitlement.granted
membership.entitlement.revoked
membership.entitlement.expired
```

统一事件字段：

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

消费者必须支持 at-least-once、deduplication、retry、DLQ、replay。

## 7. Permission / Security

权限链：

```text
Actor
→ Session/App Scope
→ Subscriber/Creator Scope
→ Membership Permission
→ Commerce/Payment validation where required
→ Mutation
→ Audit
```

必须防止：

- 越权查看他人订阅；
- 越权授予管理员权益；
- 客户端伪造会员状态；
- 重放订阅命令产生重复权益；
- 取消后继续长期访问受限内容；
- 私有会员数据进入公开 analytics/search。

## 8. Runtime / Cost

Cloudflare-first：

```text
Workers
→ D1 authoritative membership state
→ Queues async renewal/event propagation
→ Cache/KV hot entitlement checks
→ DO only when strong per-subscription coordination is required
```

高频 entitlement 检查优先走缓存/派生读取；缓存失效必须可回源到权威状态。

## 9. Consistency / Reliability

必须处理：

```text
duplicate purchase event
payment event delay
out-of-order renewal/cancel events
stale entitlement cache
retry
replay
clock boundary at period end
partial downstream failure
```

交易成功不等于客户端立即获得永久权益；权益状态必须依赖受信交易结果并具备最终一致性和审计链。

## 10. Acceptance

P0 至少验证：

1. 创建并激活会员计划；
2. 创建订阅并生成正确 entitlement；
3. 重复事件不会重复授予权益；
4. 续费成功正确延长周期；
5. 付款失败进入 grace；
6. grace 超期正确暂停/过期；
7. 取消后符合合同的访问窗口正确结束；
8. upgrade/downgrade 不产生重复订阅；
9. creator 只能管理自己拥有的 membership plan；
10. member-only content 的访问依据 entitlement；
11. 权益缓存失效后可以从 D1 重建；
12. Commerce/Payment/Ledger 故障不会产生伪造的财务事实；
13. 不修改或复制 Payload Core。

## 11. STOP Conditions

- Membership 与 Commerce 重复成为交易 authority；
- Entitlement 被客户端直接修改；
- Ledger balance 被 Membership 修改；
- Social Graph 与 Membership 各自维护冲突的订阅事实；
- duplicate entitlement；
- 无幂等；
- cancellation/expiry 后访问未收敛；
- payment event 未验证即授予权益；
- 无 replay/recovery；
- Payload boundary violation。

## 12. Status

```text
CAPABILITY = COMPLETE
CONTRACT   = READY
IMPLEMENTATION = PENDING
```
