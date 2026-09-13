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

## 3. 消息链路

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

## 4. 数据权威

Conversation、Message、Membership、Delivery Intent 等权威状态由 Messaging Domain 管理；unread count、presence、delivery metrics 等为派生状态。

Notification 不得复制 User/Creator/Content/IP 的权威状态。

## 5. API

`/v1/notifications`、`/v1/messages`、`/v1/conversations`、`/v1/presence`。

要求：requestId、cursor、idempotency、stable errors、authorization、rate limit、message sequence、pagination。

禁止使用无界 offset 查询消息历史。

## 6. Event

覆盖 message.created、message.delivered、message.read、conversation.created、member.changed、notification.created、notification.read、push.failed、presence.changed 等。

事件至少一次投递，消费者幂等；同一 conversation 在需要时按 sequence 保序。

## 7. Reliability

必须支持：断线重连、ack 重试、重复消息去重、发送超时、delivery failure、offline recovery、dead letter、replay、消息顺序冲突恢复。

不得依赖 exactly-once delivery。

## 8. Security / Privacy

- conversation resource authorization
- block/mute
- private account boundary
- organization/MCN scope
- attachment access control
- retention/deletion policy
- abuse/risk/moderation
- audit for sensitive administrative access

管理员不能默认读取私人会话内容。

## 9. Notification Strategy

通知分为：系统、社交、Creator、MCN、Live、Commerce、Membership、Security、Moderation、Rights 等类型，并允许用户控制频道和频率。

高频通知必须聚合/折叠，避免 notification spam。

## 10. Performance / Cost

- 消息发送采用 queue/delivery pipeline
- 高频 unread/presence 使用派生缓存
- Push fan-out 必须异步
- 大群通知必须批量化
- 热门系统通知必须聚合
- 长历史使用 cursor

## 11. UX

必须覆盖：发送中、发送成功、失败、重试、重复发送、离线、重连、已读、未读、被屏蔽、权限变化、会话删除/归档、跨设备继续。

## 12. Acceptance

P0 必须验证：通知列表、已读状态、偏好控制、1:1 消息、群聊、重复发送、断线重连、消息顺序、跨设备同步、block/mute、附件权限、管理员边界、投递失败恢复、fan-out 成本控制。

## 13. STOP

- 管理员默认读取私人消息
- 消息无权限模型
- 依赖 exactly-once
- 无 deduplication
- 无 reconnect recovery
- unread 被当作不可重建权威事实
- 大规模 push 同步 fan-out
- 无 retention/deletion policy
- notification spam 无控制

## 14. READY

必须完成 Data/API/Event/Permission/Security/Privacy/Risk/Test/Recovery/Performance/Observability/CI/User Acceptance 全链路证据。

当前：**IMPLEMENTATION PENDING**。
