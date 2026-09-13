# LuckRead 主流自媒体平台能力缺口审计 v1.0

**Status:** ARCHITECTURE AUDIT BASELINE  
**Repository:** `wanghuinet/luckread`  
**Scope:** 今日头条、抖音、快手、微博、小红书、B站、YouTube、TikTok 公开产品能力反向审计  
**Purpose:** 在现有能力矩阵基础上继续反推主流平台的产品能力，识别尚未被 LuckRead 文档明确冻结的能力，防止 API、数据模型和 APP 能力出现遗漏。

> 本文是能力审计，不代表所有能力现在立即开发。能力进入实现阶段仍必须经过 Feature Contract、Data Contract、API Contract、权限/风控/成本评审。

## 1. 审计结论

现有 LuckRead 文档已经覆盖大部分一级能力域，但如果以主流国内外平台的完整产品形态反向检查，仍存在一批**二级/三级能力没有明确冻结**。

特别需要补齐的不是简单的“再增加几个功能”，而是以下平台级能力：

1. 内容创作工具链
2. 内容关系与内容再利用
3. 社交关系图谱与社区
4. Creator Studio / 创作者经营系统
5. 直播完整生态
6. 短视频创作与音乐/素材生态
7. 版权、原创、内容指纹和维权
8. 内容安全、账号安全与申诉
9. 搜索发现与趋势系统
10. Feed 负反馈、多样性、探索与召回体系
11. 私信、群聊和实时关系
12. 商业化、会员、礼物、商品、联盟和广告
13. 数据分析、实验和增长工具
14. APP 生命周期、Push、Deep Link、Remote Config
15. 平台运营、客服、审核、处罚和申诉
16. 开放平台、OAuth、SDK、Webhook、开发者生态
17. 内容专题、合集、系列、播放列表、收藏夹等内容组织能力
18. 多语言、地区、年龄、隐私和个性化控制

## 2. 能力等级定义

- **P0:** 平台基础能力；缺失会导致产品架构不完整。
- **P1:** 主流平台核心体验能力；应进入产品合同，但可以分阶段实现。
- **P2:** 规模化、商业化或生态能力；先冻结接口，按业务证据实现。
- **P3:** 高级/实验能力；不阻塞第一版平台。

## 3. 内容创作与发布工具链

### P0/P1

- 富文本编辑器
- Markdown / HTML / Block 内容模型
- 图片编辑、裁剪、压缩、封面制作
- 视频剪辑基础能力
- 草稿
- 自动保存
- 版本历史
- 预览
- 定时发布
- 定时取消发布
- 发布前检查
- 多端预览
- 内容模板
- 内容复制/复用
- 内容导入
- 内容导出
- 批量编辑
- 批量发布
- 内容置顶
- 内容隐藏
- 内容归档
- 内容恢复
- 内容删除与回收站
- 内容状态机
- 发布渠道选择
- 受众/可见范围设置

### P1/P2

- 话题添加
- @Mention
- 地理位置
- Emoji / Sticker
- Poll / 投票
- Q&A
- 内容卡片
- 商品卡
- App 卡
- 外部链接卡
- 原文引用
- 内容引用/转发
- 系列内容
- 专栏
- 合集
- 播放列表
- 章节
- 连载
- 内容关联
- 内容推荐位
- 多版本内容
- 多语言版本

## 4. 短视频创作与素材生态

主流短视频平台不只是“Video Upload”，还需要独立的创作资产模型。

- 音乐库
- 音乐版权
- 音频片段
- 音效
- 配音
- 字幕
- 自动字幕
- 字幕编辑
- 贴纸
- 滤镜
- 特效
- 模板
- 转场
- 画布/比例
- 美颜/基础视觉效果
- 剪辑草稿
- 创作素材库
- 创作者素材收藏
- 热门音乐
- 音乐榜单
- 音频搜索
- 音乐与内容关联
- Duet/合拍类关系
- Stitch/引用片段类关系
- Remix/二创关系
- 原始内容归属
- 二创授权

## 5. 内容关系与再利用

应建立统一 Content Relationship Contract，而不是把关系散落在各业务表。

关系类型至少包括：

```text
reply_to
quote
repost
reference
remix
clip_from
series_of
episode_of
collection_of
related_to
recommended_with
translated_from
localized_from
adapted_from
licensed_from
```

这使文章、动态、视频、直播回放、短视频、漫画、小说、漫剧等可以形成统一内容图谱。

## 6. Social Graph / Community

现有 Follow / Block 不足以覆盖主流社交能力。

需要冻结：

- follower / following
- mutual follow
- close friends
- friend relationship
- private account
- follow approval
- follower removal
- mute user
- mute topic
- mute keyword
- block user
- block content
- community
- group
- group member
- group owner/admin
- group moderation
- topic/community page
- community post
- community rules
- member level
- creator fan group
- fan badge
- social graph privacy
- profile visibility
- content visibility
- comment permission
- mention permission
- message permission
- follow permission

## 7. Feed / Discovery 深化

现有 Feed / Recommendation 需要补齐产品层的发现入口。

### Feed 类型

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
- Related content
- History-based feed
- Saved/favorite feed

### Feed 控制

- refresh
- cursor
- incremental feed
- read position
- resume position
- deduplication
- author diversity
- content diversity
- topic diversity
- freshness control
- frequency capping
- not interested
- reduce similar content
- hide author
- hide topic
- report
- block
- feedback reason
- cold-start strategy
- empty-state strategy

### Discovery

- Trending
- Hot topics
- Trending creators
- Trending videos
- Trending searches
- Nearby/local discovery
- New creators
- New content
- editorial collections

## 8. Creator Studio / Creator Operating System

现有 Creator Profile 不等于完整 Creator Studio。

应增加：

- dashboard
- content management
- draft management
- scheduled publishing
- audience management
- comment management
- message management
- moderation status
- content performance
- audience analytics
- follower analytics
- revenue dashboard
- monetization eligibility
- copyright dashboard
- infringement claims
- appeals
- live management
- live analytics
- collaboration management
- brand collaboration
- campaign management
- affiliate management
- product management
- membership management
- fan management
- creator support
- creator notifications
- account health
- policy violations
- account status
- creator score / quality status

## 9. Live 完整能力

Live 必须从“Live Room”扩展为完整平台域。

### 主播

- live room
- scheduled live
- stream key
- stream ingest
- stream status
- co-host
- multi-guest
- PK / match
- moderator
- moderator roles
- subscriber/member-only live
- replay
- highlights
- clips
- recording
- live cover
- live title/category/topic

### 观众

- live discovery
- live chat
- reactions
- gifts
- membership
- paid interaction
- share
- follow
- reminder
- replay
- clips
- report
- block

### 直播商业化

- gifts
- tips
- memberships
- paid live
- live commerce
- product pinning
- coupons
- affiliate
- ads
- creator revenue share

YouTube 当前公开能力已经包括会员、Super Chat/Super Stickers、Super Thanks、Shopping，以及横屏/竖屏直播和直播回放等能力，因此 LuckRead 的 Live Contract 不能只定义“直播间 + 播放”。 citeturn0search0turn0search2turn0search4turn0search9

## 10. IM / Realtime

现有 IM 只是一级能力，需要冻结：

- 1:1 conversation
- group conversation
- message
- text
- image
- video
- audio
- file
- sticker
- location
- content card
- app card
- reply
- quote
- forward
- recall
- edit
- delete
- read receipt
- unread count
- mention
- reaction
- typing state
- online/offline state
- delivery state
- push notification
- mute conversation
- pin conversation
- search messages
- block/report
- anti-spam
- group admin
- group invitation
- group join approval
- message retention policy

## 11. Search / Discovery 深化

- autocomplete
- query suggestions
- trending searches
- search history
- clear history
- hot keywords
- typo correction
- synonym expansion
- entity search
- creator search
- topic search
- content search
- video search
- live search
- app/game search
- local search
- filter
- sort
- time filter
- content-type filter
- creator filter
- semantic search
- related searches
- zero-result handling
- search quality feedback
- search abuse prevention
- search analytics

## 12. Copyright / Rights

这是现有蓝图中的重要缺口，应升级为独立平台能力。

- ownership
- original declaration
- license
- authorization
- commercial license
- repost permission
- derivative permission
- territory
- time range
- exclusivity
- content fingerprint
- duplicate detection
- copyright matching
- infringement claim
- takedown
- counter-notice
- appeal
- strike
- repeat-infringer policy
- rights revenue allocation
- creator rights dashboard
- rights evidence
- provenance

YouTube 公开资料也将 Copyright Match Tool、创作者收益和版权相关能力作为创作者生态的一部分，因此版权不能只作为“内容审核”的一个字段。 citeturn0search6

## 13. Safety / Moderation / Appeals

需要形成完整 Safety Contract：

- text moderation
- image moderation
- video moderation
- audio moderation
- live moderation
- comment moderation
- DM moderation
- spam detection
- bot detection
- scam detection
- phishing detection
- adult/sensitive content policy
- minor safety
- self-harm safety
- harassment
- hate/abuse
- misinformation policy hooks
- account risk
- device risk
- IP/network risk
- content risk
- creator risk
- enforcement action
- warning
- limited distribution
- demonetization
- content removal
- account restriction
- account suspension
- appeal
- appeal evidence
- reviewer workflow
- audit trail

## 14. Monetization / Commerce

现有 Commerce 需要进一步拆解。

### Creator monetization

- ad revenue
- subscription
- channel/creator membership
- tips
- gifts
- paid content
- paid live
- affiliate
- shopping
- brand deals
- creator marketplace
- campaign
- sponsored content
- revenue share
- payout
- tax information
- settlement

### Commerce

- product
- merchant
- store
- SKU
- product catalog
- product tag
- product card
- cart handoff
- order reference
- affiliate tracking
- commission
- coupon
- campaign
- promotion

YouTube 当前公开支持广告、Shopping、Premium 分成、会员、Super Chat/Super Stickers、Super Thanks 等多条创作者收入路径，说明“Revenue + Settlement”本身不足以表达完整商业化能力。 citeturn0search0turn0search8

## 15. Analytics / Experiment / Growth

需要从简单 AppAnalytics 扩展为 Platform Analytics：

- user analytics
- content analytics
- creator analytics
- video analytics
- live analytics
- feed analytics
- recommendation analytics
- search analytics
- monetization analytics
- audience analytics
- retention
- cohort
- funnel
- conversion
- session
- DAU/WAU/MAU
- content completion
- watch time
- dwell time
- engagement
- revenue analytics
- attribution
- campaign analytics
- A/B testing
- feature experiments
- recommendation experiments
- remote configuration
- experiment assignment
- experiment exposure

## 16. APP Experience Platform

为了让 H5 / Android / iOS 体验真正流畅，需要冻结客户端基础能力：

- app bootstrap
- remote config
- feature flags
- experiment assignment
- app version policy
- minimum supported version
- forced upgrade
- soft upgrade
- maintenance mode
- deep link
- universal link/app link
- share link
- push token
- push preference
- notification badge
- unread sync
- offline cache contract
- local state sync
- delta sync
- read-state sync
- prefetch
- preload
- image/video adaptive delivery
- network fallback
- device capability detection
- region configuration
- language configuration

## 17. Localization / Region / Privacy

- language
- locale
- timezone
- region
- country/market availability
- age gate
- parental control integration point
- privacy settings
- data export
- account deletion
- consent
- cookie/privacy preference
- personalized recommendation opt-out
- personalized ads opt-out
- content visibility by region
- monetization eligibility by region
- legal policy version
- terms acceptance

## 18. Platform Operations

平台不仅需要用户端和 Creator 端，还需要运营端。

- content operations
- user operations
- creator operations
- MCN operations
- recommendation operations
- risk operations
- moderation operations
- search operations
- live operations
- campaign operations
- commerce operations
- revenue operations
- app review operations
- developer operations
- customer support
- ticket
- appeal review
- policy management
- feature rollout
- incident management
- audit

## 19. Open Platform / Developer Ecosystem

现有 Developer Platform 需要补齐真正的开放平台能力：

- OAuth
- API keys
- access tokens
- app registration
- scopes
- permissions
- SDK
- API documentation
- webhook
- webhook retry
- webhook signature
- quota
- rate limit
- usage analytics
- sandbox
- test environment
- developer verification
- app review
- release channel
- version management
- deprecation policy
- API versioning
- developer notifications
- security events

## 20. Content Organization

需要独立于 Content 类型定义内容组织系统：

- collection
- playlist
- series
- channel
- column
- topic
- hashtag
- category
- tag
- season
- episode
- chapter
- creator shelf
- favorite list
- reading list
- watch history
- continue watching
- continue reading

## 21. 当前缺口优先级

| 能力 | 当前文档 | 审计结论 | 优先级 |
|---|---|---|---|
| Identity | 已有 | 需要补 Privacy/Security 细节 | P0 |
| Content | 已有 | 需要创作工具/关系模型 | P0 |
| Creator | 已有 | Creator Studio 缺失 | P0 |
| MCN | 已有 | 经营/合同/结算细节不足 | P1 |
| Feed | 已有 | Discovery/负反馈/多样性不足 | P0 |
| Recommendation | 已有 | 实验/召回/质量闭环不足 | P0 |
| Interaction | 已有 | Social Graph 不完整 | P0 |
| Search | 已有 | 搜索发现能力不足 | P1 |
| Live | 有一级能力 | 完整直播生态缺失 | P0 |
| IM | 有一级能力 | 完整实时消息体系缺失 | P1 |
| Risk | 已有 | 需要完整 Safety/Trust Contract | P0 |
| Moderation | 部分已有 | 需要独立能力域 | P0 |
| Copyright | 不完整 | 重大缺口 | P0 |
| Monetization | 已有 | 商业化产品能力不足 | P0 |
| Analytics | 部分已有 | Platform Analytics 缺失 | P1 |
| APP Experience | 不完整 | 重大缺口 | P0 |
| Operations | 不完整 | 重大缺口 | P0 |
| Open Platform | 已有 | OAuth/SDK/Webhook/Quota 缺失 | P1 |
| Community | 不完整 | 需要冻结 | P1 |
| Short-video creation | 不完整 | 音乐/特效/二创关系缺失 | P1 |
| Localization/Privacy | 部分已有 | 需要系统化 | P1 |

## 22. 最终判断

如果只看一级模块，LuckRead 当前蓝图已经接近完整；如果按照今日头条、抖音、快手、微博、小红书、B站、YouTube、TikTok 这类成熟平台的**完整产品能力树**检查，则仍不能宣布“功能完备”。

真正的缺口已经从“缺少某一个大模块”转变为：

```text
一级平台能力       → 大体齐全
二级业务能力       → 仍有明显缺口
三级产品体验       → 缺口较多
平台运营能力       → 需要继续冻结
商业化能力         → 需要继续冻结
版权/安全/申诉     → 需要升级为正式平台能力
APP体验基础设施    → 需要正式冻结
```

因此，在 API Worker 正式进入大规模业务开发前，必须以本审计作为 Feature Matrix 的补充基线。

## 23. 后续开发规则

任何新功能不得因为“竞品有”就直接加入代码。

必须经过：

```text
Capability Gap
    ↓
Feature Definition
    ↓
Domain Contract
    ↓
Data Contract
    ↓
API Contract
    ↓
Permission / Safety
    ↓
Cost Review
    ↓
Acceptance Criteria
    ↓
READY
    ↓
Implementation
```

**本文件只冻结能力范围，不自动授权开发。**

**Status: ARCHITECTURE AUDIT BASELINE — READY FOR FEATURE CONTRACT REVIEW.**
