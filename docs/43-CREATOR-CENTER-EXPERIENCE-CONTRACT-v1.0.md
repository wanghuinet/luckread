# LuckRead Creator Center 创作者中心体验契约 v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：P0 核心产品域 / 主流创作者工作台体验基线**

## 1. 目标

Creator Center 不是传统 CMS 后台，而是创作者统一的生产、发布、管理、增长、粉丝、IP 与商业化工作台。

核心目标：让创作者登录后能够在一个统一入口完成：

```text
创作
→ 草稿
→ 素材
→ 编辑
→ 发布
→ 审核
→ 分发
→ 互动
→ 数据
→ 粉丝
→ 成长
→ IP
→ 商业化
```

平台不得因为内容形态不同而要求创作者理解多个互相割裂的后台。

## 2. Creator Center 总体结构

```text
Creator Center
│
├── 内容创作
│   ├── 图文
│   ├── 动态
│   ├── 小视频
│   ├── 长视频
│   ├── 漫画
│   ├── 小说
│   ├── 剧集 / 系列
│   ├── 音频 / Podcast
│   ├── 直播
│   ├── APP / 小程序
│   └── 游戏
│
├── 内容管理
│   ├── 全部内容
│   ├── 草稿
│   ├── 审核中
│   ├── 已发布
│   ├── 定时发布
│   ├── 被限制
│   └── 回收站
│
├── 素材中心
│   ├── 图片
│   ├── 视频
│   ├── 音频
│   ├── 漫画素材
│   └── 其他资源
│
├── 数据中心
│   ├── 内容数据
│   ├── 播放 / 阅读
│   ├── 完播
│   ├── 互动
│   ├── 粉丝
│   ├── 收益
│   └── IP 数据
│
├── 粉丝 / 社区
│   ├── 评论
│   ├── 粉丝
│   ├── 会员
│   ├── 私信 / 消息
│   └── 社区
│
├── Creator Growth
│   ├── 创作任务
│   ├── 成长等级
│   ├── 创作者权益
│   ├── 内容质量反馈
│   └── 成长建议
│
├── IP Center
│   ├── 我的 IP
│   ├── 作品
│   ├── 系列 / 宇宙
│   ├── 角色 / 实体
│   ├── 授权
│   └── IP 商业化
│
└── 商业化
    ├── 收益
    ├── 会员
    ├── 商品
    ├── 广告
    ├── 品牌合作
    └── IP 交易 / 授权
```

## 3. 统一创作入口

创作者进入 Creator Center 后，核心操作必须是统一的 `Create`。

```text
Create
│
├─ 图文 → 图文编辑器
├─ 动态 → 动态编辑器
├─ 小视频 → 视频编辑器
├─ 长视频 → 视频生产流程
├─ 漫画 → 漫画创作流程
├─ 小说 → 长文本创作流程
├─ 剧集 → 系列/分集创作流程
├─ 音频 → 音频生产流程
├─ 直播 → Live Studio
├─ APP → App / Mini App 发布中心
└─ 游戏 → Game 发布中心
```

不同内容类型可以拥有专业编辑器，但必须共享：

- 统一身份；
- 统一草稿体系；
- 统一素材体系；
- 统一权限模型；
- 统一内容生命周期；
- 统一审核/版权边界；
- 统一发布状态；
- 统一内容空间；
- 统一事件/分析入口。

## 4. 内容类型体验

### 4.1 图文

支持：

- 文字；
- 多图；
- 图片排序；
- 图片替换/删除；
- @；
- 话题；
- 可见范围；
- 预览；
- 草稿自动保存；
- 发布/定时发布；
- 发布后编辑与删除。

### 4.2 动态

支持快速发布、图片/视频混合、话题、@、可见范围、草稿和即时互动。

动态必须保持低摩擦，不能强制进入复杂编辑器。

### 4.3 小视频

支持：

- 拍摄；
- 相册；
- 裁剪；
- 多段素材；
- 封面；
- 音频/音乐；
- 字幕；
- 文本/贴纸；
- 话题/@；
- 可见范围；
- 草稿；
- 上传恢复；
- 媒体处理；
- 审核；
- 发布。

### 4.4 漫画

应支持作品、章节、页面/素材、封面、排序、章节发布、连载状态、草稿、审核、版权和作品数据。

### 4.5 小说

应支持作品、章节、长文本编辑、自动保存、章节状态、连载计划、目录、封面、审核、版权和阅读数据。

### 4.6 剧集 / 系列

支持：

```text
Series
→ Season / Part
→ Episode
→ Media
→ Metadata
→ Publish
```

分集必须可以独立处理状态，同时保持系列关系。

### 4.7 音频 / Podcast

支持节目、单集、音频上传、封面、章节/描述、发布计划、播放数据和订阅关系。

### 4.8 直播

Creator Center 必须能够进入直播准备、开播、实时管理、结束、回放和数据分析流程。

直播支持 Smart Action：

```text
Live Segment
→ Target Entity
→ Smart Action Card
→ One-tap Navigation
→ Return to Live
```

例如商品、APP、文章、视频、小说、漫画、剧集、作者、IP、活动、优惠券、下一场直播。

### 4.9 APP / 小程序

这里属于创作者/开发者发布体系，而不是普通文章编辑器。

必须支持：

- 应用身份；
- 版本；
- 构建产物引用；
- 应用描述/图标/截图；
- 权限声明；
- 审核；
- 发布渠道；
- 版本回滚；
- 运行状态；
- 数据分析。

### 4.10 游戏

游戏发布采用独立的作品/版本/构建/审核/渠道模型，但共享 Creator Center 的身份、素材、权限、审核、分析和商业化能力。

## 5. 草稿体系

草稿是 Creator Center 的 P0 核心能力。

统一草稿模型至少包含：

- draftId；
- creatorId；
- contentType；
- contentId（可选）；
- schemaVersion；
- localVersion；
- serverVersion；
- contentSnapshot；
- mediaRefs；
- updatedAt；
- device/session context。

要求：

- 自动保存；
- 跨设备恢复；
- 版本冲突检测；
- 不静默覆盖；
- 删除前确认；
- 草稿恢复后继续原流程。

## 6. 素材中心

素材中心必须成为跨内容类型复用的统一资产层。

支持：

- 图片；
- 视频；
- 音频；
- 漫画素材；
- 封面；
- 文档/其他创作资源；
- 搜索；
- 标签；
- 排序；
- 删除；
- 引用关系。

素材本身的权属和引用关系必须可追踪。

## 7. 内容管理

统一提供：

```text
All
Drafts
Processing
Moderation Pending
Scheduled
Published
Restricted
Archived
Deleted
```

支持：

- 搜索；
- 筛选；
- 排序；
- 批量操作；
- 定时发布；
- 状态查看；
- 编辑；
- 删除；
- 恢复；
- 审核结果；
- 版权状态。

批量操作必须具有权限检查、确认、幂等和审计。

## 8. 发布与任务中心

所有长任务统一进入任务中心：

```text
Draft
→ Uploading
→ Processing
→ Moderation
→ Publishing
→ Published / Failed
```

任务中心必须能够告诉创作者：

1. 当前任务；
2. 当前状态；
3. 已完成部分；
4. 失败原因的安全摘要；
5. 是否可以恢复；
6. 下一步操作。

不能因为上传/转码/审核耗时而让创作者认为内容丢失。

## 9. Creator Analytics

数据中心不能只展示单一阅读量。

至少分层：

### 内容

- 曝光；
- 阅读；
- 播放；
- 完播；
- 停留；
- 点赞；
- 评论；
- 收藏；
- 分享；
- 关注转化。

### 粉丝

- 新增；
- 流失；
- 活跃；
- 来源；
- 内容偏好；
- 会员状态。

### 创作者/IP

- IP 内容规模；
- 内容表现；
- 粉丝增长；
- 商业化表现；
- 授权/合作表现。

所有推荐、增长、收益指标必须明确数据口径，不能把派生指标冒充权威事实。

## 10. Creator Growth

Creator Growth 负责帮助创作者提升长期创作能力，而不是简单提供排行榜。

支持：

- 创作任务；
- 内容质量反馈；
- 创作连续性；
- 粉丝增长建议；
- 内容表现解释；
- 平台权益；
- 创作者等级；
- 活动参与；
- 合规提醒。

不得公开内部风控、排序、安全阈值或敏感推荐规则。

## 11. 粉丝与社区

Creator Center 必须形成：

```text
Content
→ Audience
→ Interaction
→ Follow
→ Membership
→ Community
→ Retention
```

支持：

- 评论管理；
- 回复；
- 评论置顶；
- 评论过滤；
- 粉丝列表；
- 粉丝关系；
- 会员；
- 消息/通知；
- 社区管理。

## 12. IP Center

LuckRead 的 Creator Center 必须支持从单作品升级到 IP 管理。

```text
Creator
→ IP
→ Series / Universe
→ Characters / Entities
→ Works
→ Community
→ Distribution
→ Commerce / Licensing
```

IP Center 支持：

- IP 创建；
- IP 归属；
- 作品关联；
- 系列关联；
- 角色/实体；
- Remix/Derivative；
- 授权；
- 权利状态；
- IP 数据；
- IP 商业化。

权利敏感关系必须具备 provenance 和授权边界。

## 13. 商业化

Creator Center 商业化必须覆盖：

- 创作者收益；
- 会员；
- 商品；
- 广告；
- 品牌合作；
- IP 授权；
- Marketplace；
- 活动；
- 结算。

所有资金变动必须进入 Ledger 边界，不允许 Creator Center 直接修改余额作为权威事实。

## 14. 多人协作 / MCN

Creator Center 应支持创作者团队和 MCN：

```text
Organization
→ Creator
→ Team Member
→ Role
→ Permission
→ Content
→ Approval
→ Publish
```

至少区分：

- Owner；
- Admin；
- Editor；
- Analyst；
- Moderator；
- Finance；
- Developer。

权限必须最小化，敏感操作需要审计。

## 15. 跨设备连续性

```text
Web/H5
↕
Mobile Web
↕
Android/iOS
```

同一账号的草稿、素材引用、发布任务、审核状态和内容管理上下文必须具备明确一致性规则。

跨设备发生冲突时不得静默覆盖用户工作。

## 16. 错误与恢复体验

Creator Center 必须覆盖：

- Offline；
- Timeout；
- Upload Failed；
- Processing Failed；
- Moderation Pending；
- Rejected；
- Permission Denied；
- Copyright Conflict；
- Payment Failure；
- Session Expired；
- Version Conflict；
- Service Degraded。

统一原则：

```text
发生问题
→ 保留工作
→ 解释当前状态
→ 提供恢复路径
→ 恢复后继续原任务
```

## 17. API / Event Boundary

Creator Center 是产品层，不得直接依赖 Payload 内部实现。

统一应用 API 至少覆盖：

- creator profile；
- create/update/list drafts；
- asset management；
- content create/update/publish；
- schedule publish；
- content management；
- analytics query；
- audience/community management；
- IP management；
- monetization management；
- organization/team management。

事件至少覆盖：

- creator.created；
- draft.created / updated；
- media.uploaded；
- media.processing.completed / failed；
- content.submitted；
- content.published / rejected / hidden / deleted；
- audience.followed；
- membership.changed；
- ip.linked；
- commerce.order / settlement events。

## 18. 高并发与成本原则

Creator Center 的高频操作不得全部同步落权威数据库。

```text
User Action
→ API
→ Authoritative State
→ Domain Event
→ Queue / Async Processing
→ Derived State
→ Analytics / Distribution
```

高频曝光、播放、点赞等事件必须经过信任/风控和聚合后再进入推荐、增长和商业化指标。

媒体大对象进入对象存储；结构化权威元数据进入数据库；缓存和派生数据必须可重建。

## 19. 安全、版权与审核

不同内容类型共用统一安全边界，但允许专业策略。

发布前/发布后必须能够处理：

- 内容安全；
- 媒体安全；
- 版权；
- 权利授权；
- 隐私；
- 地域策略；
- 用户封禁；
- 创作者权限；
- 组织权限。

审核结果必须可追踪，适用场景必须提供申诉路径。

## 20. UX 主流程

### 创作

```text
进入 Creator Center
→ Create
→ 选择内容类型
→ 编辑
→ 自动保存
→ 预览
→ 发布
```

### 发布

```text
提交
→ 校验
→ 上传/处理
→ 审核
→ 发布
→ 内容空间
→ 分发
```

### 成长

```text
发布
→ 数据
→ 粉丝
→ 内容反馈
→ Growth
→ 再创作
```

### IP

```text
作品
→ IP
→ 系列/角色/实体
→ 社区
→ 授权/商业化
```

## 21. P0 验收用例

### CC-P0-01 统一入口

创作者可以从 Creator Center 进入所有已开放内容类型的创作入口。

### CC-P0-02 图文

完成图文创建、草稿、发布、审核、个人内容空间和后续分发。

### CC-P0-03 动态

快速发布动态，不进入不必要的复杂流程。

### CC-P0-04 小视频

完成拍摄/相册、编辑、上传、处理、审核、发布、播放。

### CC-P0-05 多内容草稿

不同内容类型的草稿可以统一管理和恢复。

### CC-P0-06 素材复用

同一素材可以在权限允许的情况下被多个内容引用，而不产生不必要的重复存储。

### CC-P0-07 长任务恢复

上传/处理期间退出页面后，任务和工作可恢复。

### CC-P0-08 跨设备

另一设备可以继续草稿和查看发布任务状态。

### CC-P0-09 内容管理

创作者可以搜索、筛选、批量管理自己的内容。

### CC-P0-10 数据

发布后的内容可以看到定义明确的数据指标。

### CC-P0-11 粉丝

可以查看和管理粉丝、评论、会员等关系。

### CC-P0-12 IP

可以把作品关联到自己的 IP，并查看关系。

### CC-P0-13 商业化

符合资格的创作者可以查看和管理商业化入口，资金状态遵循 Ledger 契约。

### CC-P0-14 权限

团队/MCN 成员只能执行授权范围内的操作。

### CC-P0-15 安全/版权

不满足安全、版权或权限条件的内容不能绕过规则公开发布。

### CC-P0-16 恢复

关键失败场景不会导致创作成果丢失。

## 22. Capability Traceability

Creator Center 不新增未审核的顶层 L1，而是作为现有能力的统一产品工作台。

主要映射：

```text
Creator
Creator Studio
Creator Growth / Success
Creator Tools / Production Ecosystem
Organization / MCN
Content
Content Production
Content Relations / Remix Graph
Show / Series / Program
IP Graph / IP Economy
Entity / Unified Profile
Media
Media Processing
Fan Relationship / Membership
Community
Interaction
Feed / Distribution
Analytics / Experiment / Growth
Copyright / Rights
Safety / Risk / Trust
Content Moderation / Appeals
Monetization / Commerce / Creator Economy
Advertising Platform
Wallet / Ledger / Settlement
Platform / Open Ecosystem / Operations
```

UX Journey：

```text
J14 Creator Onboarding
→ J15 Creation / Draft / Publish
→ J16 Creator Studio
→ J17 Creator Growth
→ J18 Fan / Membership
→ J20 IP Hub
→ J21 Monetization
→ J22 Wallet / Earnings
→ J23 Creator/IP Marketplace
```

## 23. Implementation Admission

Creator Center 进入代码实现前必须满足：

```text
Capability Mapping
→ L3/L4 Mapping
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security Contract
→ Privacy/Rights Contract
→ Risk/Moderation Contract
→ Cost/Runtime Review
→ UX State Machine
→ Failure/Recovery Contract
→ Test/Acceptance Contract
→ READY
```

不同内容类型可以分阶段实现，但不得因为先实现某一个编辑器而破坏统一 Creator Center 契约。

## 24. 非目标

本版本不要求：

- 一次性实现所有专业剪辑能力；
- 一次性实现所有 AI 创作能力；
- 一次性实现完整商业化；
- 一次性实现完整 APP/游戏开发工具链；
- 为了“功能看起来完整”复制多个后台。

这些属于后续实现阶段，但接口边界必须提前定义。

## 25. 完成定义

只有以下全部满足，Creator Center 才能标记 DONE：

1. Creator Center UX Contract PASS；
2. 内容类型入口 PASS；
3. Draft/Recovery PASS；
4. Asset Management PASS；
5. Content Management PASS；
6. Publish/Moderation PASS；
7. Analytics PASS；
8. Audience/Community PASS；
9. IP/rights PASS；
10. Monetization/Ledger PASS；
11. Team/MCN permissions PASS；
12. API/Event Contract PASS；
13. Security/Privacy PASS；
14. Accessibility PASS；
15. Performance PASS；
16. Local Test PASS；
17. CI PASS；
18. Cross-device/Failure Recovery PASS；
19. Mobile/H5 Acceptance PASS；
20. User Acceptance PASS。

在此之前，必须使用 IMPLEMENTATION PENDING / IMPLEMENTING / CI PENDING / USER ACCEPTANCE PENDING 等真实状态，不得宣称“Creator Center 已经达到完美或主流 APP 级实现”。
