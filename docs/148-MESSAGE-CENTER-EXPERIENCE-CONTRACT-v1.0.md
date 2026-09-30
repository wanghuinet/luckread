# LuckRead Message Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：56 Notification / IM / Realtime Messaging + 54 Social / Community**

## 1. 定位

Message Center 是用户、Creator、MCN、Merchant、Advertiser 与平台之间的统一消息体验入口，聚合系统通知、互动通知、私信、会话、任务提醒、业务消息与实时状态。

本中心是体验与编排层，不创建第二 Notification、IM、Social、Commerce 或 Risk 权威。

## 2. Benchmark / Superiority

借鉴微博、小红书、抖音、B站、YouTube、TikTok、X 等成熟消息/通知体验，目标是做到：重要消息不遗漏、普通消息不过载、会话上下文完整、消息来源可理解、处理动作最短、风险消息安全、跨设备连续。

## 3. Information Architecture

```text
Message Center
├── Inbox / All
├── Important / Security
├── Comments / Replies / Mentions
├── Likes / Follows / Fan Updates
├── Creator / Community Updates
├── Private Messages
├── Group / Community Messages
├── Commerce / Order Messages
├── Creator / Merchant Tasks
├── System Announcements
├── Message Search / Filters
├── Notification Preferences
└── Archive / Read State
```

## 4. Core Journeys

`Event → Message Decision → Delivery → Inbox → Read → Action → Follow-up`

会话：`Open → Load Context → Send → Delivered/Failed → Retry/Recover`。

## 5. Experience Requirements

- 安全、订单、审核等高优先级消息必须与普通互动消息明确分层；
- 每条消息必须能解释来源、时间、对象和可执行动作；
- 点击消息必须直接进入正确业务上下文；
- 已读、未读、归档、删除等状态必须幂等；
- 消息发送失败必须保留草稿/重试上下文；
- 大量通知必须支持聚合、折叠和免打扰；
- 被屏蔽用户、私密社区与权限变化必须立即影响可见性；
- Web / Android / iOS 保持消息状态和会话上下文连续。

## 6. Authority Boundary

```text
Notification / IM → message delivery / conversation state
Social → relationship eligibility
Content / Creator → source content and actor context
Commerce → order source state
Risk / Moderation → safety decision
User → identity / preference authority
```

## 7. API / Event Surface

中心仅调用稳定领域 API，不直接读取 D1 表或 Payload internals。典型能力：inbox summary、conversation summary、message detail、unread count、notification preference、send/retry command。

高频通知应通过聚合与批量生成降低写放大；消息 mutation 使用 idempotencyKey、requestId、correlationId 与稳定错误模型。

## 8. Privacy / Security

私信、群组、运营消息和安全通知必须按收件人 scope 授权。不得因缓存、搜索索引、推送摘要或客户端本地状态泄漏被屏蔽/私密内容。

## 9. Reliability

必须处理重复事件、乱序事件、推送失败、网络中断、设备切换、会话并发发送、撤回/删除、权限变化和下游服务延迟。

至少一次事件投递下，消费者必须幂等；实时通道失败不能丢失权威消息状态。

## 10. Acceptance / Superiority Gate

验证：重要消息到达率、关键消息识别时间、未读准确性、会话恢复成功率、消息操作完成步数、跨设备一致性、隐私隔离和异常恢复，并通过 139 Global Product & Experience Superiority Gate。

**STOP：** 第二消息权威、私域越权、重复发送副作用、未读状态失真、安全消息可静默屏蔽、失败不可恢复、内部消息 schema 泄漏、低于行业基线。
