# LuckRead 主流自媒体平台能力完备性矩阵 v1.0

**Status:** ARCHITECTURE / FEATURE COMPLETENESS BASELINE  
**Repository:** `wanghuinet/luckread`  
**Purpose:** 在进入大规模 API / 业务代码开发前，反向审计国内外主流自媒体、内容社区、短视频、直播、创作者平台和开放生态所需能力，补齐 LuckRead 平台蓝图中的缺失功能。  
**Principle:** 先补齐产品能力边界，再冻结 Domain Contract / Data Contract / API Contract；本文件不是要求一次性实现全部功能，而是冻结长期产品能力地图。

---

## 1. 目标

LuckRead 的目标不是简单复制某一个平台，而是形成覆盖以下产品形态的统一能力底座：

- 新闻 / 信息流
- 图文自媒体
- 短视频 / 长视频
- 直播
- 内容社区
- 创作者平台
- MCN / 机构平台
- 搜索
- 社交 / IM
- 内容商业化
- 电商 / 直播电商
- 应用市场
- Mini App
- 游戏
- 开放平台 / Developer Platform

本矩阵用于回答一个关键问题：

> **如果未来 H5 / Android / iOS 要做到主流自媒体平台级功能，平台底座是否已经定义了对应能力？**

---

## 2. 完备性等级

| 等级 | 含义 |
|---|---|
| P0 | 平台基础能力；缺失会阻断核心产品 |
| P1 | 主流平台核心体验；必须进入产品蓝图 |
| P2 | 规模化 / 商业化 / 生态能力；定义边界后按阶段实现 |
| P3 | 高级能力；需要真实业务和流量证明后实现 |

状态：

- `DEFINED`：蓝图已经定义
- `EXPANDED`：原有定义过于粗，需要本矩阵补全
- `MISSING`：此前缺失，本文件首次纳入
- `LATER`：定义能力，但不代表近期实现

---

# 3. Identity / Account / User

## 3.1 用户身份

- User
- Account
- Profile
- Session
- Authentication
- Password lifecycle
- Email / phone identity
- Identity linkage
- Device
- Device sessions
- Login history
- Account security
- Account recovery
- Account deletion / deactivation
- Account export
- Privacy settings
- Language / region / timezone
- Age / minor-safety state
- User status / restriction state

**状态：EXPANDED / P0**

## 3.2 社交隐私

- 谁可以关注我
- 谁可以评论
- 谁可以私信
- 谁可以提及我
- 谁可以查看内容
- 谁可以查看收藏 / 关注关系
- 黑名单
- 屏蔽作者
- 屏蔽关键词 / Topic
- Close Friends / close audience
- Restricted mode

**状态：MISSING → P1**

---

# 4. Social Graph / Community

主流自媒体平台不只有“关注”，还需要完整社交关系模型。

- Follow / Unfollow
- Mutual Follow
- Follower / Following lists
- Friend relationship
- Close Friends
- Block
- Mute
- Topic follow
- Creator follow
- Content subscription
- Community
- Group
- Group member
- Group role
- Group moderation
- Group announcement
- Community discovery
- Community recommendation
- User-to-user interaction policy

**状态：EXPANDED / P1**

原则：Social Graph 与 Feed、Notification、IM、Risk 通过事件和稳定 Contract 连接，不在 Payload hooks 中形成高频业务编排。

---

# 5. Content Creation / Publishing

此前内容模型已经存在，但创作者生产工具定义不足。补齐：

## 5.1 创作

- Rich Text Editor
- Markdown
- Gallery editor
- Video upload/edit metadata
- Audio upload
- Cover selection
- Thumbnail selection
- Subtitle metadata
- Topic selection
- Hashtag
- Mention
- Location
- Link insertion
- Content reference
- Related content
- Related creator
- Related app
- Series / playlist
- Content collection
- Draft
- Autosave
- Preview
- Scheduled publish
- Immediate publish
- Unpublish
- Re-publish
- Revision
- Rollback
- Duplicate / reuse content
- Template
- Content import
- Content export

## 5.2 内容分发控制

- Audience selection
- Public / followers / private
- Region restriction
- Age restriction
- Platform restriction
- Embedding permission
- Download permission
- Share permission
- Comment permission
- Recommendation eligibility
- Search visibility
- Monetization eligibility

**状态：EXPANDED / P0-P1**

---

# 6. Content Ecosystem

统一 `content_id` 继续保留，并补齐内容关系能力：

- Article
- Dynamic / Post
- Gallery
- Video
- Audio
- Question / Answer
- Novel
- Comic
- Drama
- Live
- Series
- Playlist
- Collection
- Topic
- Hashtag
- Content reference
- Repost / Quote
- Remix / Derivative content
- Related content
- Related creator
- Related app
- Related product

内容关系：

```text
Content
 ├── parent_content
 ├── related_content
 ├── referenced_content
 ├── series_id
 ├── topic_ids
 ├── creator_id
 ├── related_app_ids
 └── related_product_ids
```

**状态：EXPANDED / P1**

---

# 7. Originality / Copyright / Rights

这是原蓝图的重要缺口，必须成为一级能力。

- Original content declaration
- Content ownership
- Author ownership
- Organization ownership
- License
- License scope
- License expiration
- Repost permission
- Commercial permission
- Derivative permission
- Content ID
- Duplicate detection
- Similarity detection
- Copyright claim
- Copyright strike
- Rights conflict
- Rights evidence
- Appeal
- Counter-claim
- Takedown
- Rights restoration
- Revenue rights
- Rights transfer
- Content provenance
- Attribution

**状态：MISSING → P0-P1**

原则：版权与推荐、商业化、审核相互关联，但保持独立 Domain Contract。

---

# 8. Creator Platform

Creator 不应只有 Profile。

## 8.1 Creator Studio

- Dashboard
- Content management
- Draft management
- Publishing calendar
- Content performance
- Audience analytics
- Revenue dashboard
- Follower analytics
- Video analytics
- Live analytics
- Search analytics
- Feed analytics
- Recommendation exposure
- Comment management
- Notification management
- Copyright management
- Moderation status
- Monetization status
- Account health

## 8.2 Creator growth

- Creator verification
- Creator levels
- Creator tasks
- Creator achievements
- Creator badges
- Creator education
- Creator support
- Creator challenges
- Creator campaigns
- Creator marketplace
- Brand collaboration
- Sponsored content
- Affiliate capability

**状态：EXPANDED / P1-P2**

---

# 9. MCN / Organization

已有 MCN 基础，补齐企业化运营能力：

- Organization
- Organization member
- Role
- Permission
- Creator relationship
- Contract
- Content ownership
- Revenue allocation
- Campaign allocation
- Approval workflow
- Organization analytics
- Creator performance ranking
- Organization finance
- Settlement
- Organization audit
- Organization support
- Multi-organization creator relationship

**状态：EXPANDED / P1-P2**

---

# 10. Feed / Distribution

Feed 是当前蓝图中最需要扩充的核心域之一。

## 10.1 Feed 类型

- For You
- Following
- Latest
- Trending
- Local
- Topic
- Creator
- Video
- Live
- Search result feed
- Related content feed
- Series feed
- App feed
- Game feed

## 10.2 Feed 行为

- Refresh
- Cursor pagination
- Read state
- Restore position
- Not interested
- Reduce similar
- Block creator
- Block topic
- Hide content
- Save
- Share
- Report
- Follow creator
- Follow topic
- Feedback reason

## 10.3 Feed 基础能力

- Candidate generation
- Deduplication
- Frequency capping
- Diversity control
- Freshness
- Personalization
- Ranking
- Exploration / exploitation
- Cold start
- Content lifecycle
- Author fairness
- Topic diversity
- Negative feedback
- Risk filtering
- Copyright filtering
- Moderation filtering

**状态：EXPANDED / P0-P1**

---

# 11. Recommendation / Ranking

Recommendation 必须从 Feed 中独立定义逻辑 Contract。

- Candidate generation
- Feature generation
- User interest profile
- Content feature profile
- Creator quality
- Content quality
- Risk score
- Trust score
- Event quality
- Engagement quality
- Freshness score
- Diversity score
- Exploration score
- Business policy score
- Monetization score
- Ranking
- Re-ranking
- Explanation / reason
- A/B experiment
- Model version
- Feature version
- Feedback loop
- Recommendation poisoning protection

**状态：EXPANDED / P1-P2**

推荐信号必须经过：

```text
Raw Event
  ↓
Risk / Trust
  ↓
Validated Event
  ↓
Quality Signal
  ↓
Recommendation Signal
  ↓
Ranking
```

---

# 12. Interaction

现有 Like / Comment / Favorite / Follow / Share / Report / Block 基础上补齐：

- Like / Unlike
- Reaction types
- Comment
- Reply
- Mention
- Comment pin
- Comment author reply
- Comment sort
- Comment ranking
- Comment search
- Favorite / Unfavorite
- Folder / collection for favorites
- Follow / Unfollow
- Share
- Quote / Repost
- Copy link
- Report
- Block
- Mute
- Not interested
- Content feedback
- Creator feedback

高频行为必须支持异步事件、聚合、批量持久化。

**状态：EXPANDED / P0-P1**

---

# 13. Notification

补齐通知中心和推送体系：

- In-app notification
- Push notification
- Email notification
- SMS notification
- Like
- Comment
- Reply
- Follow
- Mention
- Creator update
- Live start
- New content
- Revenue
- Settlement
- Moderation
- Copyright
- Security
- System
- Campaign
- Group/community

通知能力：

- Read / unread
- Mark all read
- Unread count
- Notification preference
- Mute notification
- Frequency control
- Priority
- Deduplication
- Aggregation
- Retry
- Dead-letter

**状态：EXPANDED / P1**

---

# 14. Search

原 Search 域必须补齐完整搜索体验：

- Search box
- Autocomplete
- Suggestion
- Query correction
- Search history
- Hot search
- Trending queries
- Content search
- Creator search
- User search
- Topic search
- Hashtag search
- Video search
- Live search
- App search
- Game search
- Novel search
- Comic search
- Drama search
- Filter
- Sort
- Time range
- Author filter
- Content type filter
- Region filter
- Semantic search
- Related query
- Search ranking
- Search safety filtering
- Search analytics

**状态：EXPANDED / P1**

---

# 15. Live

Live 不能只定义为 `Live` 内容类型。

## 15.1 Live Core

- Live room
- Stream lifecycle
- Host
- Co-host
- Multi-guest
- Audience
- Live title
- Cover
- Category
- Schedule
- Start / end
- Replay
- Recording
- Clips
- Highlights

## 15.2 Live Interaction

- Live chat
- Reactions
- Gifts
- Fan club / membership
- Moderation
- Mute
- Block
- Slow mode
- Moderator role
- Admin controls
- Audience limits

## 15.3 Live advanced

- Match / PK
- Team match
- Live events
- Live campaign
- Live commerce
- Pinned product
- Product shelf
- Paid live
- Ticketed live
- Replay monetization

主流平台已经将直播、实时互动、礼物、会员和商业化结合；因此这些必须进入长期能力地图。citeturn0search12turn0search5turn0search4

**状态：MISSING/EXPANDED → P1-P2**

---

# 16. IM / Realtime

当前仅有 IM 标签，必须补齐完整能力：

- Conversation
- 1:1 chat
- Group chat
- Message
- Text
- Image
- Video
- Audio
- File
- Link
- Sticker
- Reply
- Forward
- Recall
- Delete
- Read
- Unread
- Mention
- Reaction
- Typing
- Online status
- Last seen
- Delivery state
- Block
- Report
- Conversation mute
- Conversation pin
- Search messages
- Message moderation
- Message retention policy
- Abuse / spam controls

Realtime transport与消息业务保持独立 Contract。

**状态：MISSING → P1-P2**

---

# 17. Safety / Trust / Risk

风险系统升级为一级平台能力：

- Account risk
- Device risk
- IP/network risk
- Bot detection
- Spam detection
- Fake engagement
- Self-view
- Self-like
- Mutual boosting
- Multi-account clusters
- Content farm
- Recommendation poisoning
- Comment spam
- Message spam
- Live abuse
- Fraud
- Payment abuse
- Creator abuse
- Advertisement abuse
- Copyright abuse
- Minor safety

决策等级：

```text
normal
  ↓
low risk
  ↓
suspicious
  ↓
high risk
  ↓
confirmed abuse
```

动作：

- reduce recommendation weight
- reduce event contribution
- delay attribution
- require review
- limit interaction
- limit monetization
- suspend account
- remove content

**状态：EXPANDED / P0-P1**

---

# 18. Content Moderation

审核必须从“video moderation”扩展为统一 Safety / Moderation Domain：

- Text moderation
- Image moderation
- Video moderation
- Audio moderation
- Comment moderation
- Live moderation
- IM moderation
- Username/profile moderation
- Avatar moderation
- Link moderation
- Advertisement moderation
- App moderation
- Game moderation
- AI-generated content labeling
- Sensitive content classification
- Spam classification
- Human review
- Appeal
- Re-review
- Enforcement history
- Audit trail

**状态：MISSING → P0-P1**

---

# 19. Analytics / Data Platform

当前 Analytics 定义不足，补齐：

## 19.1 Product analytics

- DAU / WAU / MAU
- retention
- cohort
- funnel
- session
- active time
- content consumption
- creator activity
- feature adoption

## 19.2 Content analytics

- impressions
- views
- qualified views
- completion rate
- dwell time
- likes
- comments
- shares
- saves
- follows
- traffic source
- recommendation exposure
- search exposure

## 19.3 Creator analytics

- followers
- audience
- content performance
- revenue
- engagement
- live performance
- search performance
- feed performance

## 19.4 Business analytics

- revenue
- ad revenue
- subscription revenue
- commerce revenue
- creator settlement
- MCN settlement
- campaign ROI

**状态：EXPANDED / P1-P2**

---

# 20. Creator Monetization / Commerce

主流平台已经形成广告、会员、粉丝付费、礼物、购物和品牌合作等多元收入结构；YouTube 当前公开能力包括广告、Shopping、Premium revenue、Channel Memberships、Super Chat / Super Stickers、Super Thanks 等。citeturn0search0turn0search1

LuckRead 长期能力地图补齐：

- Advertising
- Ad revenue share
- Creator subscription
- Channel / creator membership
- Fan support
- Tips
- Gifts
- Paid content
- Paid live
- Shopping
- Affiliate
- Product tagging
- Brand collaboration
- Creator marketplace
- Campaign
- Sponsored content
- Ticketing
- Premium content
- Revenue share
- Ledger
- Settlement
- Tax information
- Refund
- Chargeback
- Fraud review

YouTube Shopping 还支持创作者在视频、Shorts、直播等场景展示商品，因此内容与商业化必须通过统一引用模型连接。citeturn0search2turn0search6

**状态：EXPANDED / P1-P2**

---

# 21. Creator / Brand Marketplace

新增：

- Brand
- Advertiser
- Campaign
- Creator matching
- Creator application
- Campaign brief
- Deliverables
- Approval
- Sponsored content
- Attribution
- Conversion tracking
- Settlement
- Dispute
- Brand safety

**状态：MISSING → P2**

---

# 22. APP Experience Platform

API 完备不仅是 endpoint 数量，还必须保证 APP 体验能力：

- Home bootstrap
- Feed bootstrap
- Profile bootstrap
- Creator bootstrap
- Notification badge
- Deep link
- Universal link / app link
- Share link
- Push token
- Device registration
- Remote config
- Feature flags
- Experiment assignment
- A/B test
- Version compatibility
- Maintenance state
- Force update
- Soft update
- Preload
- Prefetch
- Offline cache
- Read state sync
- Incremental sync
- Delta update
- Network retry
- Partial response
- Degraded mode

**状态：MISSING → P0-P1**

---

# 23. Platform Operations

这是此前蓝图的另一个重要缺口。

需要定义内部运营能力：

- User Operations
- Content Operations
- Creator Operations
- MCN Operations
- Feed Operations
- Recommendation Operations
- Risk Operations
- Moderation Operations
- Search Operations
- Live Operations
- Campaign Operations
- Commerce Operations
- App Store Operations
- Developer Operations
- Customer Support
- Appeal Center
- Audit Center
- Feature flag operations
- Emergency disable / kill switch

**状态：MISSING → P1-P2**

---

# 24. Customer Support / Appeals

新增独立能力：

- Ticket
- User support
- Creator support
- Developer support
- Copyright appeal
- Moderation appeal
- Account appeal
- Monetization appeal
- Payment dispute
- Content takedown appeal
- Appeal evidence
- Case status
- SLA
- Operator assignment
- Audit trail

**状态：MISSING → P1-P2**

---

# 25. Apps / Mini App / Game Ecosystem

现有 Apps Market / Developer Platform 基础继续保留，并补齐：

- App discovery
- App ranking
- App recommendation
- App collection
- App install/open
- Version update
- Rollback
- Staged release
- Region release
- Device compatibility
- Permission management
- App review
- App rating
- App abuse reporting
- Developer verification
- Developer organization
- SDK management
- API key management
- OAuth / app authorization
- Webhook
- App analytics
- App revenue
- Mini App manifest
- Mini App lifecycle
- Mini App permissions
- Game versioning
- Game launch
- Game distribution
- Game account linkage
- Game achievements / leaderboard contract

**状态：EXPANDED / P1-P2**

---

# 26. Open Platform / Developer API

Developer Platform 增加：

- Developer account
- Organization
- API credentials
- OAuth
- API scopes
- Webhooks
- SDK
- API versioning
- Sandbox
- Test environment
- App review
- Quotas
- Rate limits
- Usage analytics
- Billing
- API deprecation
- Migration guides
- Developer notifications

**状态：EXPANDED / P1-P2**

---

# 27. Platform Governance

所有上述能力必须继续遵循：

```text
Product Requirement
        ↓
Feature Matrix
        ↓
Domain Contract
        ↓
Data Contract
        ↓
API Contract
        ↓
Payload / Worker / Queue / Cache / R2 Boundary
        ↓
Risk / Permission / Cost Review
        ↓
Acceptance Contract
        ↓
READY
        ↓
Implementation
```

任何 `MISSING` 能力先进入文档，不直接变成随机代码。

---

# 28. Capability Completeness Matrix

| Domain | 原蓝图 | 本次补全 | 优先级 |
|---|---|---|---|
| Identity | 有 | 安全、隐私、设备、恢复 | P0 |
| Social Graph | 部分 | 社交关系、社区、群组 | P1 |
| Content | 有 | 创作工具、关系、分发控制 | P0-P1 |
| Copyright | 缺失 | 完整版权/权利链 | P0-P1 |
| Creator | 部分 | Creator Studio / Marketplace | P1-P2 |
| MCN | 有 | 企业运营、合同、结算 | P1-P2 |
| Feed | 有 | 多 Feed、反馈、去重、多样性 | P0-P1 |
| Recommendation | 部分 | Trust / Quality / Experiment | P1-P2 |
| Interaction | 有 | 评论治理、Reaction、Mute等 | P0-P1 |
| Notification | 有 | Push / preference / aggregation | P1 |
| Search | 有 | Suggest / hot / filter / semantic | P1 |
| Live | 部分 | Room / co-host / gifts / commerce / replay | P1-P2 |
| IM | 缺少细节 | 完整消息与 realtime contract | P1-P2 |
| Risk | 有 | Trust / anti-fraud / abuse | P0-P1 |
| Moderation | 部分 | 全媒体审核 / appeal / enforcement | P0-P1 |
| Analytics | 部分 | Product / creator / content / business | P1-P2 |
| Monetization | 部分 | ads / subscription / gifts / shopping / marketplace | P1-P2 |
| APP Experience | 缺失 | bootstrap / sync / deep link / config | P0-P1 |
| Operations | 缺失 | 全平台运营后台 | P1-P2 |
| Support | 缺失 | ticket / appeal / dispute | P1-P2 |
| Apps | 有 | release / rollback / distribution / analytics | P1-P2 |
| Developer | 有 | OAuth / SDK / webhook / quota / billing | P1-P2 |
| Mini App | 有概念 | manifest / permission / lifecycle | P2 |
| Game | 有概念 | distribution / account / launch / analytics | P2 |

---

# 29. API Completeness Requirement

本文件中的每一个进入 `P0/P1` 的能力，最终必须在 `03-API-CAPABILITY-COMPLETENESS-CONTRACT-v1.0.md` 的能力矩阵中有对应 API Contract。

最低要求：

```text
Feature
 ↓
Data Contract
 ↓
API Contract
 ↓
Permission
 ↓
Risk
 ↓
Consistency
 ↓
Cost
 ↓
Performance
 ↓
H5
 ↓
Android
 ↓
iOS
```

不允许：

```text
Payload 有功能
↓
API 没有
↓
APP 无法使用
```

---

# 30. 实施优先级

## P0 — 现在必须冻结

- Identity / Account / Privacy
- Content creation / publishing foundation
- Content distribution controls
- Social relationship foundation
- Copyright / ownership
- Moderation foundation
- Risk / Trust foundation
- Feed contract
- API completeness
- APP experience contract

## P1 — 核心产品阶段实现

- Creator Studio
- MCN operations
- Search complete experience
- Notifications
- Live
- IM
- Analytics
- Customer support / appeals
- Platform operations
- Creator monetization

## P2 — 规模化与商业生态

- Creator marketplace
- Brand collaboration
- Shopping / affiliate
- Apps ecosystem advanced capabilities
- Mini App
- Game ecosystem
- Advanced recommendation
- Advanced experiments

## P3 — 真实业务证明后

- Complex ML ranking
- Large-scale realtime infrastructure
- Advanced distributed analytics
- Advanced multi-region capabilities
- Highly specialized media processing

---

# 31. 与竞品能力的关系

本矩阵参考主流国际平台公开能力，包括 YouTube、TikTok 等；这些平台公开资料显示，现代创作者平台已经将内容、Feed、直播、粉丝互动、会员、礼物、购物、品牌合作和商业化连接起来，而不是孤立的 CMS。citeturn0search0turn0search10turn0search12

国内平台能力评估采用“产品能力族”而非机械复制某一厂商实现，避免因为竞品内部实现差异而污染 LuckRead 的架构边界。

目标是：

> **能力覆盖达到主流平台级；API 一致性、请求链路、风险公平性、成本控制和可替换性优于简单堆功能。**

---

# 32. Final Decision

本文件将原蓝图中发现的主要能力缺口正式纳入 LuckRead 长期产品能力地图。

**重要：纳入能力地图 ≠ 立即开发。**

所有能力必须按 Feature Lifecycle：

```text
DEFINED
 ↓
ARCHITECTURE REVIEW
 ↓
CONTRACT REVIEW
 ↓
READY
 ↓
IMPLEMENTING
 ↓
LOCAL PASS
 ↓
CI PASS
 ↓
USER ACCEPTANCE
 ↓
DONE
```

在能力没有进入 `READY` 前，不允许直接向 Payload Core 或业务 Worker 添加实现。

**Status: COMPLETE CAPABILITY BASELINE v1.0**