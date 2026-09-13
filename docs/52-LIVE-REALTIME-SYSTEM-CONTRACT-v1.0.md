# LuckRead Live / Realtime System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：LuckRead P0 Live / Realtime 独立系统契约；本文件只定义系统边界与实现准入，不代表已经实现。**

## 1. 目标

Live 系统必须达到主流内容平台的完整直播体验，并与 Creator、Content、Media、Social、Community、Notification、Membership、IP、Commerce、Risk、Analytics 等系统形成稳定边界。

目标不是简单的“视频播放页”，而是：

```text
Live Session
→ Discovery
→ Pre-live
→ Live Playback
→ Realtime Interaction
→ Smart Action
→ Social / Membership
→ Moderation / Risk
→ Replay
→ Analytics / Distribution
```

## 2. 系统边界

### Live System 负责

- 直播间生命周期
- 主播/嘉宾进入直播
- 直播场次与状态
- 直播预告
- 直播播放会话
- 直播互动编排
- 连麦/多人直播编排
- 直播实时上下文
- 直播回放关系
- 直播任务状态
- 直播侧实时体验状态

### 不负责

- 视频转码基础设施的具体实现
- 推荐算法本身
- 搜索引擎本身
- 风控模型本身
- 内容审核模型本身
- IM 全局消息系统的权威实现
- Creator 权威身份
- Content 权威状态
- IP 权利权威状态
- Ledger 权威余额

Live 只能通过稳定 API/Event 与这些系统交互。

## 3. 核心对象

### 3.1 Live

代表一个长期可识别的直播业务对象。

核心字段：

- liveId
- creatorId
- title
- coverMediaId
- category/topic
- visibility
- scheduledAt
- startedAt
- endedAt
- lifecycleState
- moderationState
- rightsState
- replayId optional
- createdAt
- updatedAt

### 3.2 Live Session

代表一次实际直播运行实例。

```text
SCHEDULED
→ PREPARING
→ LIVE
→ DEGRADED
→ ENDED
→ PROCESSING_REPLAY
→ REPLAY_AVAILABLE
```

异常状态必须可进入：

```text
FAILED
CANCELLED
RESTRICTED
```

### 3.3 Live Segment

直播中的时间上下文区间。

字段：

- segmentId
- liveId
- startAt
- endAt
- contextType
- targetEntityType
- targetEntityId
- displayMode
- status
- creatorBindingSource
- createdAt

## 4. Live Smart Action

Live 必须支持“直播实时上下文入口”。

核心模型：

```text
Live
 ├─ Segment 001 → Product
 ├─ Segment 002 → App
 ├─ Segment 003 → Article
 ├─ Segment 004 → Video
 ├─ Segment 005 → Novel
 ├─ Segment 006 → Comic
 ├─ Segment 007 → Drama
 ├─ Segment 008 → Creator
 ├─ Segment 009 → IP
 ├─ Segment 010 → Activity
 ├─ Segment 011 → Coupon
 └─ Segment 012 → Next Live
```

用户体验：

```text
主播讲解对象
→ 右下角 Smart Action
→ 一键查看/打开/领取/预约
→ 保留 Live Context
→ 返回直播
```

V1 必须支持主播/运营人员手动绑定时间段与目标实体。

V2 可支持：

```text
Caption / Speech
→ Entity Candidate
→ Host Confirmation
→ Smart Action
```

V1 禁止依赖未经确认的自动 AI 识别作为权威绑定。

## 5. Smart Action 支持类型

| context | Action |
|---|---|
| 商品 | 查看商品 |
| APP | 打开 APP |
| 文章 | 查看文章 |
| 视频 | 查看视频 |
| 小说 | 阅读小说 |
| 漫画 | 查看漫画 |
| 剧集 | 查看剧集 |
| 作者 | 查看作者 |
| IP | 查看 IP |
| 活动 | 参加活动 |
| 优惠券 | 领取优惠 |
| 直播预约 | 预约下一场 |

目标实体必须经过目标领域的权限、可见性、版权、状态检查。

## 6. 用户 Journey

### J-LIVE-01 发现直播

```text
Home / Following / Search / Creator / IP / Topic
→ Live Card
→ Preview
→ Enter Live
```

### J-LIVE-02 预约直播

```text
Live Preview
→ Schedule
→ Reminder
→ Notification
→ Enter Live
```

### J-LIVE-03 观看直播

必须支持：

- 播放
- 全屏
- 横竖屏适配
- 清晰度选择
- 弱网络降级
- 延迟状态
- 断线重连
- 继续观看

### J-LIVE-04 实时互动

支持：

- 评论
- 回复
- 点赞/Reaction
- 关注
- 分享
- 粉丝/会员身份
- 主播置顶
- 主播/管理员管理互动

高频 Reaction 不得全部同步写入权威数据库。

### J-LIVE-05 Smart Action

```text
看到上下文入口
→ 点击
→ 目标实体
→ 完成目标动作
→ 返回 Live
```

离开直播后必须尽可能恢复原直播位置、上下文与播放状态。

### J-LIVE-06 直播结束

```text
LIVE
→ ENDED
→ Replay Processing
→ Replay Available
→ Distribution
```

## 7. 多人直播 / 连麦

系统必须预留：

- Guest
- Co-host
- Multi-guest
- Invite
- Accept/Reject
- Remove
- Host transfer where supported
- Participant moderation

参与者权限必须独立于 Creator 权限。

## 8. 直播间互动权限

统一授权链：

```text
Actor
→ Live Membership / Role
→ Action Permission
→ Live State
→ Moderation / Risk Policy
→ Allow / Deny
→ Audit
```

至少区分：

- Host
- Co-host
- Guest
- Moderator
- Member
- Viewer
- Platform Operator

禁止客户端自行决定主播/管理员身份。

## 9. Moderation / Risk

直播风险必须支持实时处理：

- 评论风险
- 用户举报
- 主播举报
- 内容限制
- 直播中断
- 参与者限制
- 权限撤销
- 直播结束后复审

风险系统不得暴露模型分数、规则权重、反作弊阈值等内部安全逻辑。

直播事件必须遵循：

```text
Raw Event
→ Admission
→ Risk / Trust
→ Valid Signal
→ Aggregation
→ Consumer
```

## 10. Data Authority

| 数据 | Authority |
|---|---|
| Creator | Creator Domain |
| Live | Live Domain |
| Content | Content Domain |
| Media | Media Domain |
| Rights | Rights Domain |
| User relationship | Social Domain |
| Membership entitlement | Membership Domain |
| Risk decision | Risk Domain |
| Moderation decision | Moderation Domain |
| Notification | Notification Domain |
| Commerce fact | Commerce Domain |
| Revenue | Ledger Domain |
| Analytics | Derived Analytics Domain |

Live System 不得复制这些领域的第二权威状态。

## 11. API Contract

统一版本：

```text
/v1/live
```

核心 API：

- create live
- update live
- schedule live
- cancel live
- start live
- end live
- get live
- list live
- join live
- leave live
- create/invite guest
- manage participant
- create live segment
- update live segment
- bind Smart Action
- remove Smart Action
- get live actions
- replay status
- report live
- moderation action

所有 mutation 必须支持：

- authenticated actor
- authorization
- requestId
- correlationId
- DTO validation
- idempotency
- stable error model
- optimistic concurrency where required
- audit for sensitive operations

不得暴露 Payload internal types。

## 12. Event Contract

事件命名：

```text
live.created
live.scheduled
live.started
live.degraded
live.recovered
live.ended
live.cancelled
live.participant.joined
live.participant.left
live.segment.created
live.segment.updated
live.smart_action.bound
live.smart_action.unbound
live.replay.processing
live.replay.available
live.reported
live.restricted
```

统一 envelope：

- eventId
- eventType
- eventVersion
- occurredAt
- producer
- actorId
- targetType
- targetId
- correlationId
- causationId
- requestId
- idempotencyKey
- schemaVersion
- payload

默认：

```text
at-least-once delivery
+ consumer idempotency
```

不得假设 exactly-once。

## 13. 高频事件

以下行为默认采用派生/聚合策略：

- exposure
- play
- watch heartbeat
- reaction
- comment volume
- share
- dwell
- reconnect

推荐链路：

```text
Client Event
→ Admission
→ Queue / Buffer
→ Trust / Risk
→ Aggregation
→ Analytics / Feed / Growth
```

不得因为直播高并发而把每次心跳、播放、Reaction 变成 D1 同步权威写入。

## 14. Replay

回放必须保留与原直播的关系：

```text
Live
→ Replay
→ Original Timeline
→ Smart Action Segments
→ Comments / Context where policy allows
```

Smart Action 在回放中应继续按时间轴可用，但必须重新检查目标实体的当前状态、权限、版权、库存/有效期等。

## 15. Failure / Recovery

必须覆盖：

- stream startup failure
- playback failure
- upload/ingest failure
- network degradation
- reconnect
- participant disconnect
- task timeout
- moderation restriction
- target entity deleted
- Smart Action target unavailable
- coupon expired
- app unavailable
- replay processing failure
- session expired

原则：

```text
发生问题
→ 保留可恢复状态
→ 解释状态
→ 提供恢复路径
→ 恢复后继续原任务
```

## 16. Privacy / Security / Rights

必须支持：

- public/private/unlisted visibility where applicable
- audience restriction
- blocked users
- regional policy
- creator permission
- guest consent
- recording consent where required
- copyright restriction
- replay visibility
- Smart Action target authorization

直播结束后的回放权限不得默认等于直播期间权限。

## 17. Performance / Cost Contract

P0 必须定义实际 benchmark 后再冻结数值，但系统设计必须预留：

- playback startup budget
- API p50/p95/p99
- realtime interaction latency budget
- reconnect budget
- participant state propagation budget
- Smart Action display latency
- maximum interaction page size
- queue lag budget
- replay processing SLA

成本原则：

```text
Media → Object Storage / Media Pipeline
Metadata → Authoritative DB
Hot state → Cache
Realtime events → Queue / Realtime Layer
Analytics → Derived Read Model
```

## 18. Observability

至少监控：

- live start success
- playback startup latency
- playback error rate
- reconnect success
- concurrent viewers
- participant count
- interaction rate
- moderation actions
- event lag
- queue failures
- Smart Action exposure/click/conversion
- replay processing latency
- replay failure
- API p50/p95/p99
- error rate

禁止记录密码、token、secret 或不必要的敏感数据。

## 19. Acceptance Tests

### P0 Functional

- 创建直播
- 预约直播
- 开播
- 观看
- 关注
- 评论
- Reaction
- 分享
- 结束直播
- 回放
- Smart Action
- 多人连麦
- 直播举报

### P0 Reliability

- duplicate start
- duplicate end
- reconnect
- timeout retry
- participant disconnect
- queue delay
- replay failure recovery
- Smart Action target deletion

### P0 Security

- viewer cannot become host
- guest cannot perform host-only action
- moderator scope enforcement
- cross-user isolation
- restricted user enforcement
- Smart Action authorization

### P0 Event

- event schema validation
- at-least-once duplicate handling
- ordering by liveId where required
- replay safety
- DLQ
- rebuild/reconciliation

### P0 UX

- loading
- empty
- offline
- degraded
- restricted
- reconnecting
- processing
- failed
- recovery
- accessibility
- cross-device continuation where applicable

## 20. Traceability

本系统必须映射到：

- Creator
- Creator Studio
- Content
- Media
- Social Graph
- Fan / Membership
- Community
- Interaction
- Feed / Distribution
- Recommendation
- Notification
- Risk / Trust
- Moderation / Appeals
- Copyright / Rights
- Monetization / Commerce
- Wallet / Ledger
- Analytics
- IP Graph
- Platform Operations

禁止通过 Live 系统偷偷新增未登记 L1/L2 capability。

## 21. Implementation Admission

Live 进入代码实现前必须完成：

```text
Live Architecture
→ L1/L2/L3/L4 Traceability
→ UX Journey
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security
→ Risk/Moderation
→ Rights
→ Failure/Recovery
→ Cost/Performance
→ Observability
→ Test/Acceptance
→ READY Gate
```

## 22. STOP Conditions

出现以下任一情况必须停止实现：

- Live 成为 Creator/Content/Media 的第二权威状态
- Smart Action 绕过目标实体权限
- 高频事件全部同步写权威数据库
- 未经授权的自动 AI 绑定成为权威事实
- replay 绕过版权/可见性检查
- guest 权限依赖客户端
- moderation/risk 内部规则泄露
- mutation 缺少 idempotency
- event 无版本
- derived state 无 rebuild
- 无法恢复直播任务
- Payload Core 被修改
- API 暴露 Payload internal implementation
- 无可执行 acceptance tests

## 23. Status

当前状态：

**PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

本文件完成设计后，仍不得直接声明 Live 已实现或已达到主流平台生产水平。

最终必须以真实代码、测试、CI、集成、性能、故障恢复和用户验收证据为准。
