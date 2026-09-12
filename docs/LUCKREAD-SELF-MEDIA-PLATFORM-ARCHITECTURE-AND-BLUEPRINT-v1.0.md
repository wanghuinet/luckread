# LuckRead 自媒体平台架构与实施蓝图 v1.0

**Status:** ARCHITECTURE BASELINE  
**Repository:** `wanghuinet/luckread`  
**Purpose:** 为 LuckRead 建立可逐步实现的统一自媒体平台架构。  
**Principle:** 先跑通平台，再按真实流量拆分；Payload Core 不修改；GitHub 文档作为架构事实来源。

---

## 1. 平台定位

LuckRead 不是单纯的文章 CMS，而是一个统一的内容、创作者、MCN、媒体、应用分发和商业化平台。

目标能力覆盖：

- 用户与身份
- 创作者
- MCN / 机构 / 团队
- 图文、动态、问答、小说、漫画、漫剧
- 图片、音频、视频、直播等媒体资产
- Feed / 推荐 / 分发
- 评论、点赞、收藏、关注、分享、举报
- 通知
- 搜索
- 开发者平台
- Apps 应用市场
- 游戏、AI 应用、工具、小程序等开放生态
- 广告、创作者收益、机构收益和结算

核心原则：**统一平台核心 + 模块化业务 + 逻辑数据域 + 渐进式服务拆分。**

---

## 2. 总体架构

```text
                              LuckRead Platform
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
       Platform Core             Content Ecosystem        App Ecosystem
             │                        │                        │
       Identity / Auth          Article / Video          Apps Market
       Creator / MCN            Dynamic / Novel         Developer
       Permission               Comic / Drama           Game / MiniApp
             │                        │                        │
             └────────────────────────┼────────────────────────┘
                                      │
                               Unified API Layer
                                      │
                              api.luckread.com
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
            APP                       H5                       PC
             │
       msn / mp / dev / apps / game / pc 等产品入口
                                      │
                         Cloudflare Worker Platform
                                      │
                     ┌────────────────┼────────────────┐
                     │                │                │
                    D1               R2             Cache/KV
                 metadata          media              state
```

第一阶段采用**模块化单体 Worker**，不按业务系统机械地拆成多个 Worker。

未来只有在独立吞吐、故障域、部署周期或计算负载形成明确边界后，才拆分 Media、Feed、Jobs、Search、Apps Runtime 等独立 Worker。

---

## 3. 域名与产品入口

| 域名 | 定位 |
|---|---|
| `api.luckread.com` | 全平台统一 API 入口 |
| `msn.luckread.com` | 内容消费 / 新闻 / Feed |
| `mp.luckread.com` | 创作者、自媒体、MCN 平台 |
| `apps.luckread.com` | 应用市场，类似 Google Play / App Store |
| `dev.luckread.com` | 开发者中心 |
| `game.luckread.com` | 游戏中心 |
| `pc.luckread.com` | PC 产品入口 |
| `open.luckread.com` | 开放内容 / 轻应用运行入口，后续建设 |

这些域名第一阶段可以全部指向同一个 Cloudflare Worker，由 Host / Path Router 进入不同业务模块。

---

## 4. 核心平台模块

### 4.1 Identity

负责：

- User
- Account
- Profile
- Session
- Authentication
- Device
- Permission
- Identity linkage

原则：用户身份是全平台唯一基础对象。

### 4.2 Creator

负责：

- Creator Profile
- Creator verification
- Creator statistics
- Creator permissions
- Creator content ownership
- Creator revenue relationship

一个 User 可以成为 Creator；Creator 不等于 User，但必须关联 User。

### 4.3 Organization / MCN

负责：

- MCN
- 公司 / 工作室
- Organization Member
- Roles
- Creator contracts / relationships
- Content ownership
- Revenue allocation
- Organization analytics

禁止用单一 `mcn_id` 字段锁死 Creator 与组织关系，应采用独立 Membership 模型支持一个 Creator 多组织关系。

### 4.4 Content

统一内容身份：

- Article
- Dynamic
- Video
- Gallery
- Question / Answer
- Novel
- Comic
- Drama
- Live
- Audio
- Game / App metadata references

统一 `content_id`，业务内容采用独立子模型，避免超级内容表。

### 4.5 Media

负责媒体资产元数据：

- Image
- Video
- Audio
- Document
- Poster / Thumbnail
- Media processing status
- checksum
- size / duration / dimensions
- R2 object key

大文件不进入 D1；D1 保存元数据，R2 保存媒体对象。

### 4.6 Video

负责：

- Upload
- Processing
- Transcoding state
- Thumbnail / Poster
- Subtitle
- Playback metadata
- Video statistics
- Video moderation

视频是 Media 之上的业务域，不与普通 Article 混为一体。

### 4.7 Feed

负责：

- Candidate
- Distribution
- Ranking
- Personalization
- User feedback
- Feed delivery

第一阶段采用规则 + 用户兴趣 + 行为反馈的可解释方案；后续再引入复杂 ML Ranking。

### 4.8 Interaction

负责：

- Like
- Comment / Reply
- Favorite
- Follow
- Share
- Reaction
- Report
- Block

行为统一产生可供 Feed / Analytics 使用的事件。

### 4.9 Notification

负责：

- Like notification
- Comment notification
- Follow notification
- Mention
- System notification
- Creator notification
- Revenue notification

### 4.10 Search

负责统一搜索入口：

- Content
- Creator
- User
- Topic
- Video
- Novel
- Comic
- Drama
- App
- Game

第一阶段保持可替换；后续可接专业搜索基础设施。

### 4.11 Commerce

负责：

- Revenue
- Ledger
- Campaign
- Advertising
- Subscription
- Reward
- Settlement
- Creator / MCN revenue share

资金/收益记录优先采用 Ledger 思路，避免仅通过直接修改余额实现账务。

---

## 5. Apps Market

`apps.luckread.com` 的定位是**应用市场**，不是文章组件运行器。

目标类似 Google Play / App Store，但可同时承载：

- 普通应用
- 游戏
- AI 应用
- 工具
- 漫剧应用
- 小说 / 漫画应用
- Mini App
- Creator App
- 互动应用

核心对象：

```text
Developer
DeveloperOrganization
App
AppVersion
AppRelease
AppDistribution
AppReview
AppRating
AppCategory
AppAnalytics
```

App 的核心生命周期：

```text
Developer
  ↓
Create App
  ↓
Upload Version
  ↓
Review
  ↓
Release
  ↓
Distribution
  ↓
Open / Install
  ↓
Update
```

### 5.1 内容与 Apps Market 的关系

内容系统可以引用 App，但不拥有 App 实现。

```text
Article / Video / Drama / Novel
          │
          └── related_app_ids
                    │
                    ▼
             apps.luckread.com
```

因此：

- 文章正文可以推荐应用
- 文章底部可以推荐应用
- 视频底部可以推荐应用
- 漫剧页面可以推荐应用
- Feed 可以推荐应用
- App 详情页也可以反向展示相关文章 / 视频 / 创作者内容

这是内容生态与应用生态之间的导流闭环。

---

## 6. Developer Platform

`dev.luckread.com` 是 Apps Market 的生产端。

开发者可以：

- 创建应用
- 管理团队
- 上传版本
- 管理 App Manifest
- 管理权限
- 提交审核
- 查看安装 / 打开 / 留存数据
- 查看收益
- 管理 API / SDK

关系：

```text
Developer Center
       ↓
   App Release
       ↓
    Review
       ↓
 Apps Market
```

---

## 7. 数据架构

第一阶段即使只有一个 D1，也必须进行**逻辑数据域隔离**。

建议逻辑域：

```text
Identity Domain
Creator / Organization Domain
Content Domain
Media Domain
Interaction Domain
Feed Domain
Notification Domain
Search Domain
Commerce Domain
Apps Domain
Developer Domain
```

数据库迁移原则：

1. 业务模型不能依赖 D1 特有实现。
2. ID 使用应用层稳定 ID，不依赖 SQLite 自增 ID 作为跨库身份。
3. 大媒体对象放 R2，不放数据库。
4. 避免在业务层直接散落 D1 SQL。
5. 数据访问通过 Repository / Adapter 边界隔离。
6. Payload Collection 尽量使用标准能力。
7. 未来允许从 D1 切换到 PostgreSQL，而不重写业务层。

目标迁移路径：

```text
Cloudflare D1 + R2
       ↓
PostgreSQL + R2
       ↓
PostgreSQL + Object Storage / CDN
```

---

## 8. Payload 的定位

Payload 是平台中的：

- CMS
- Admin
- Authentication infrastructure
- Content management
- Media management
- Access control
- Hooks / extension infrastructure

Payload **不是整个 LuckRead 业务架构**。

业务模块通过 Payload 官方扩展机制实现：

- Collections
- Fields
- Hooks
- Access
- Plugins
- Custom Endpoints
- 独立业务模块

**禁止修改 Payload Core。**

未来 Payload 官方版本升级时，优先直接升级官方核心版本，并验证业务扩展兼容性。

---

## 9. API 架构

统一入口：

`api.luckread.com/v1/...`

示例：

```text
/v1/auth/*
/v1/users/*
/v1/creators/*
/v1/mcn/*
/v1/content/*
/v1/articles/*
/v1/videos/*
/v1/feed/*
/v1/comments/*
/v1/notifications/*
/v1/apps/*
/v1/developers/*
/v1/search/*
/v1/revenue/*
```

客户端原则：

- APP、H5、PC 使用统一版本化 API。
- 后续 Mini Program / 第三方客户端继续复用 API。
- 客户端不直接依赖 Payload 内部实现细节。
- Payload 原生 REST / Custom Endpoint 可以作为实现手段，但业务 API 边界必须稳定。

---

## 10. Worker 策略

### Phase 1

```text
1 Worker
  ├── Platform Core
  ├── Payload
  ├── Identity
  ├── Creator
  ├── MCN
  ├── Content
  ├── Media
  ├── Video
  ├── Feed
  ├── Interaction
  ├── Apps
  ├── Developer
  ├── Notification
  └── Commerce
```

### Phase 2

当真实负载证明需要独立扩展时，再考虑：

```text
Platform Worker
Media Worker
Feed Worker
Jobs Worker
Search Worker
Apps Runtime Worker
```

拆分标准不是“一个系统一个 Worker”，而是：

- 独立吞吐
- 独立资源需求
- 独立故障域
- 独立部署周期
- 独立安全边界
- 独立扩缩容需求

---

## 11. 实施路线

### Phase 0 — Platform Contract

先冻结：

- 平台边界
- ID 规范
- 数据域
- API 规范
- 权限模型
- 模块依赖规则
- Payload 边界
- R2 媒体规则

### Phase 1 — Identity

实现：

- User
- Account
- Profile
- Session
- 基础权限

验收：注册、登录、会话、身份关联完整闭环。

### Phase 2 — Creator / MCN

实现：

- Creator
- Organization
- OrganizationMember
- Creator verification
- 基础创作者后台
- MCN 基础管理

### Phase 3 — Content

实现：

- Article
- Dynamic
- Gallery
- Question / Answer
- 基础发布流程
- 内容状态机

### Phase 4 — Media / Video

实现：

- Media metadata
- R2 storage
- Image
- Video
- Upload / processing state
- Playback metadata

### Phase 5 — Interaction

实现：

- Like
- Comment
- Favorite
- Follow
- Share
- Report

### Phase 6 — Feed

实现：

- Feed candidate
- User behavior event
- Basic ranking
- Personalized feed

### Phase 7 — Apps Market

实现：

- Developer
- App
- Version
- Release
- Category
- Search
- Detail page
- Open / install entry
- Review / rating

### Phase 8 — Content ↔ Apps

实现：

- Article related apps
- Article bottom recommendations
- Video bottom recommendations
- Drama / Novel / Comic app references
- Feed app recommendations

### Phase 9 — Commerce

实现：

- Revenue ledger
- Creator share
- MCN share
- Campaign
- Settlement

### Phase 10 — Scale

基于真实流量决定是否拆分 Worker / 数据库逻辑域。

---

## 12. 第一阶段明确不做

为了避免平台过早复杂化，以下能力在没有真实需求或负载证据前不提前建设：

- 多 Worker 微服务化
- 复杂 ML 推荐系统
- 自建分布式消息系统
- 自建跨云数据库代理
- 大规模搜索集群
- 复杂实时音视频基础设施
- 非必要的 Payload Core 修改

原则：**先跑通、再验证、再扩展。**

---

## 13. 架构不可违反规则

1. Payload Core 不修改。
2. User / Creator / Organization 身份分离。
3. Content / Media 分离。
4. App Market / Content 分离。
5. Apps Market 是应用分发平台，不是文章组件运行器。
6. 大文件进入 R2，D1 保存元数据。
7. API 与 Payload 内部实现解耦。
8. 业务层不得大规模直接绑定 D1 API。
9. 应用层 ID 必须可跨数据库迁移。
10. 第一阶段优先单 Worker 模块化实现。
11. 只有真实负载证明后才拆 Worker / 数据库。
12. 所有新模块必须先进入架构文档，再进入代码实现。
13. 每个阶段完成后必须通过测试和回归验证，再进入下一阶段。

---

## 14. 当前执行顺序

**当前只进入 Phase 0。**

下一步优先完善：

```text
01 Identity Contract
02 Creator Contract
03 MCN / Organization Contract
04 Content Contract
05 Media Contract
06 Video Contract
07 Interaction Contract
08 Feed Contract
09 Apps Market Contract
10 Developer Contract
11 Commerce Contract
12 API Contract
```

完成这些合同后，再开始逐模块实现代码。

---

## 15. 最终目标

LuckRead 的目标不是把若干网站拼接在一起，而是建立一个统一平台：

```text
                         LUCKREAD
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   Content Ecosystem   Creator Ecosystem   App Ecosystem
        │                   │                   │
 Article / Video       Creator / MCN       Apps / Games
 Novel / Comic         Developer           AI / Tools
 Drama / Dynamic       Organization        Mini Apps
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                      Identity + API
                            │
                         Commerce
```

最终形成：

**用户消费内容 → 内容发现应用 → 应用使用 → 创作者获得流量 → 开发者获得用户 → 平台产生商业价值 → 收益反哺内容和创作者。**

这份文档是后续逐步实现的架构基线；任何新增系统首先判断是否属于现有平台域，避免重复造轮子和无依据扩张。
