# LuckRead Social / Community System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Social / Community 负责用户关系、互动关系和社区空间，不负责 Feed 排名、Recommendation、IM 消息传输或 Creator/Content 权威状态。

## 2. 核心模型

```text
User
→ Social Graph
→ Follow / Block / Mute
→ Creator / IP / Community
→ Interaction
→ Membership / Entitlement
```

社区模型：Community → Membership → Role → Topic/Content → Moderation。

## 3. 能力

- Follow / Unfollow
- Followers / Following
- Mutual relation
- Block / Mute
- Close audience
- Comment / Reply
- Like / Reaction
- Favorite
- Share
- Community / Group
- Topic
- Moderator
- Membership
- Creator fan relationship
- Notification triggers

高频行为不是逐次同步权威业务写入的强制路径。

## 4. Authority

User、Creator、Content、IP、Rights、Membership Entitlement 各由所属 Domain 权威维护。Social 维护关系型权威状态；Counter、ranking signal、activity aggregate 均为派生数据。

## 5. Interaction Pipeline

```text
Raw Interaction
→ Admission
→ Risk / Trust
→ Authoritative Relation where required
→ Event
→ Aggregation
→ Feed / Analytics / Growth
```

## 6. API

统一 `/v1/social` 与 `/v1/community`，支持 cursor pagination、idempotency、requestId、permission checks、stable errors、rate limits。

评论/点赞等 mutation 必须防重复；敏感操作必须审计。

## 7. Event

覆盖 follow.created/deleted、block.created/deleted、mute.changed、comment.created/deleted、reaction.created/deleted、favorite.changed、share.created、community.member.changed、membership.changed、report.created。

Event 至少一次投递，消费者幂等。

## 8. Privacy / Safety

Block 优先级高于推荐与分发；私密内容不得因派生缓存暴露；社区管理员只能访问授权范围；评论/互动必须支持 moderation、report、appeal 边界。

## 9. Consistency

关注、屏蔽、会员权益等权威关系必须有明确事务边界；计数、热度、粉丝趋势允许最终一致，但必须可重建。

## 10. UX

覆盖关注反馈、重复点击、离线、撤销、评论失败、内容被删除、用户被屏蔽、社区被限制、权限变化、跨设备同步。

## 11. Performance / Cost

- 高频 like/view/reaction 采用聚合
- 热门关系允许缓存
- Feed 消费不得直接扫描 Social Graph
- 大规模社区操作采用 Task/Queue
- offset pagination 禁止用于无界大集合

## 12. Acceptance

必须验证关系正确性、重复 mutation、block/mute 隔离、评论权限、社区 RBAC、membership entitlement、事件重复消费、派生计数重建、跨设备一致性、恶意刷量和限流。

## 13. STOP

- 第二套 User/Creator 权威
- Block 无法阻断下游分发
- 高频事件直接污染推荐权威状态
- 评论绕过 moderation
- 社区跨组织/跨私域读取
- Counter 被当作权威事实
- 无幂等
- 无 rebuild

## 14. READY

必须完成 Data/API/Event/Permission/Security/Test/Acceptance/Performance/Observability/CI/User Acceptance 全链路证据。

当前：**IMPLEMENTATION PENDING**。
