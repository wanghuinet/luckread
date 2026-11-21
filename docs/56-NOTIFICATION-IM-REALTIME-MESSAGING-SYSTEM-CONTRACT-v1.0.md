# LuckRead Notification / IM / Realtime Messaging System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本系统负责通知、站内消息、用户/Creator/MCN/系统消息以及实时会话；它与 Live Realtime 相邻但不混淆：Live Realtime 负责直播场景实时状态，IM 负责持久会话与消息生命周期。

## 2. 能力边界

- Notification Center
- Push / In-app / Email/SMS adapter boundary
- Message Center
- 1:1 IM
- Group conversation
- System messages
- Creator/MCN operational messages
- Read/unread state
- Message delivery state
- Presence where required
- Mute / block / notification preferences

## 3. Cloudflare 原生实时基础设施

优先使用 Cloudflare Workers、Durable Objects、Queues、D1、R2 和 Cache/KV 构建 IM/通知主链路。Cloudflare 官方文档明确提供 Durable Objects 的低延迟协调/一致性存储，以及 Queues 的异步生产者/消费者模型。 citeturn0search2turn0search9turn0search11

推荐边界：

```text
Client
→ Worker API / WebSocket
→ Durable Object (conversation/presence coordination when required)
→ D1 authoritative message state
→ Queue
→ Delivery Worker
→ Push / notification channel
```

Durable Object 只负责需要强协调/顺序/在线状态的局部状态，不成为 User、Conversation、Message 等领域的第二权威数据库。

## 4. LiveKit 集成边界

**LiveKit 只作为 Live/实时音视频基础设施，不替代 LuckRead 的 IM、Notification、User、Creator 或 Live Domain Authority。**

LiveKit 官方提供开源 WebRTC server、实时音视频/数据能力以及自托管部署方式；其自托管模式可运行在 VM/Kubernetes 等基础设施上，因此它不应被误认为 Cloudflare Worker 内部运行时。 citeturn0search0turn0search8

```text
LuckRead Live Domain
→ Room / Participant Authorization
→ LiveKit Adapter
→ LiveKit Room / RTC
→ Live Events / Webhooks
→ Worker / Queue
→ D1 Live Metadata
```

规则：

- Worker 负责签发/校验 LiveKit 访问凭证和业务权限；
- LiveKit 管理 RTC transport、room、participant、audio/video/data transport；
- LuckRead 保存 Live 的业务元数据、内容关系、权限、生命周期与用户导航状态；
- LiveKit 状态不得成为 LuckRead 用户/内容/商业事实；
- LiveKit 断开不能破坏 Live Domain 的权威状态；
- LiveKit 事件必须通过幂等事件处理进入业务侧；
- 直播入口仍必须保留在 Personal Content Space，并按 73 文档返回原始位置；
- LiveKit server/Ingress/Egress 属于独立实时基础设施部署，不部署为 Cloudflare Worker。

LiveKit 官方生产部署要求考虑 TLS、负载均衡、TURN/UDP 等网络能力；因此本项目将其视为 Cloudflare Edge 之外的专业 RTC 基础设施，并通过稳定 Adapter 隔离。 citeturn0search5turn0search10

## 5. 消息链路

```text
Domain Event / User Command
→ Policy / Permission
→ Message Intent
→ Persist Authoritative Message
→ Delivery Queue
→ Channel Delivery
→ Read / Ack
→ Derived Unread / Analytics
```

通知偏好、Block、Mute、privacy policy 必须在投递前生效。

## 6. 数据权威

Conversation、Message、Membership、Delivery Intent 等权威状态由 Messaging Domain 管理；unread count、presence、delivery metrics 等为派生状态。

Notification 不得复制 User/Creator/Content/IP 的权威状态。

## 7. API

`/v1/notifications`、`/v1/messages`、`/v1/conversations`、`/v1/presence`。

要求：requestId、cursor、idempotency、stable errors、authorization、rate limit、message sequence、pagination。

禁止使用无界 offset 查询消息历史。

## 8. Event

覆盖 message.created、message.delivered、message.read、conversation.created、member.changed、notification.created、notification.read、push.failed、presence.changed 等。

事件至少一次投递，消费者幂等；同一 conversation 在需要时按 sequence 保序。

## 9. Reliability

必须支持：断线重连、ack 重试、重复消息去重、发送超时、delivery failure、offline recovery、dead letter、replay、消息顺序冲突恢复。

不得依赖 exactly-once delivery。

## 10. Security / Privacy

- conversation resource authorization
- block/mute
- private account boundary
- organization/MCN scope
- attachment access control
- retention/deletion policy
- abuse/risk/moderation
- audit for sensitive administrative access

管理员不能默认读取私人会话内容。

## 11. Notification Strategy

通知分为：系统、社交、Creator、MCN、Live、Commerce、Membership、Security、Moderation、Rights 等类型，并允许用户控制频道和频率。

高频通知必须聚合/折叠，避免 notification spam。

## 12. Performance / Cost

- 消息发送采用 queue/delivery pipeline
- 高频 unread/presence 使用派生缓存
- Push fan-out 必须异步
- 大群通知必须批量化
- 热门系统通知必须聚合
- 长历史使用 cursor
- 不因引入 LiveKit 而同步扩大 IM 基础设施

## 13. UX

必须覆盖：发送中、发送成功、失败、重试、重复发送、离线、重连、已读、未读、被屏蔽、权限变化、会话删除/归档、跨设备继续。

## 14. Acceptance

P0 必须验证：通知列表、已读状态、偏好控制、1:1 消息、群聊、重复发送、断线重连、消息顺序、跨设备同步、block/mute、附件权限、管理员边界、投递失败恢复、fan-out 成本控制；LiveKit 集成另需验证 token 授权、room 生命周期、事件幂等、RTC 故障降级与业务状态一致性。

## 15. STOP

- 管理员默认读取私人消息
- 消息无权限模型
- 依赖 exactly-once
- 无 deduplication
- 无 reconnect recovery
- unread 被当作不可重建权威事实
- 大规模 push 同步 fan-out
- 无 retention/deletion policy
- notification spam 无控制
- LiveKit 被当作 LuckRead 业务数据库
- LiveKit RTC 故障导致业务权威数据丢失

## 16. READY

必须完成 Data/API/Event/Permission/Security/Privacy/Risk/Test/Recovery/Performance/Observability/CI/User Acceptance 全链路证据。

当前：**IMPLEMENTATION PENDING**。
