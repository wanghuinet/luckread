# LuckRead MCN Center 机构中心体验与运营系统契约 v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：P0 核心产品域 / 机构级 Creator + Content + IP + Business Operating System**

## 1. 定位

MCN Center 不是 Creator Center 的简单多账号后台，也不是传统 CMS，更不是单纯广告管理工具。

LuckRead MCN Center 定义为：

> **面向 MCN、内容机构、工作室、经纪公司和品牌内容组织的机构级创作者、内容、IP、商业化与团队运营工作台。**

核心模型：

```text
Organization
→ Creators
→ Content
→ IP
→ Audience / Community
→ Distribution
→ Business
→ Settlement
```

与主流平台的产品定位区别：

- YouTube 更偏频道/创作者工作台及频道网络管理；
- TikTok Business Center 更偏企业账号、资产、广告和商业运营；
- LuckRead MCN Center 必须进一步覆盖 **创作者经营 + 内容生产 + IP 经营 + 粉丝经营 + 商务合作 + 商业化 + 结算 + 机构协作**。

MCN 登录后的第一目标不是“管理账号”，而是“经营一家内容/IP 公司”。

## 2. 登录后总体体验

机构登录后必须直接进入机构工作台，而不是进入某个创作者个人后台。

```text
MCN Center
│
├── 机构概览
│   ├── 创作者规模
│   ├── IP 规模
│   ├── 内容规模
│   ├── 粉丝规模
│   ├── 播放/阅读规模
│   ├── 收益
│   ├── 待结算
│   └── 待处理任务
│
├── 创作者管理
│   ├── 全部创作者
│   ├── 招募
│   ├── 签约/合作
│   ├── 分组
│   ├── 成长
│   ├── 权益
│   └── 退出/解约
│
├── 内容中心
│   ├── 全部内容
│   ├── 草稿
│   ├── 审核
│   ├── 发布任务
│   ├── 已发布
│   ├── 被限制
│   └── 回收站
│
├── 生产协作
│   ├── 素材库
│   ├── 编辑任务
│   ├── 审核任务
│   ├── 发布任务
│   └── 内容日历
│
├── IP Center
│   ├── IP
│   ├── 系列/宇宙
│   ├── 作品
│   ├── 角色/实体
│   ├── 权利
│   └── 授权/合作
│
├── 粉丝与社区
│   ├── 粉丝
│   ├── 会员
│   ├── 社区
│   └── 消息
│
├── 商务中心
│   ├── 品牌合作
│   ├── 广告
│   ├── 商品
│   ├── Marketplace
│   ├── IP 授权
│   └── 活动
│
├── 数据中心
│   ├── 创作者
│   ├── 内容
│   ├── IP
│   ├── 粉丝
│   ├── 商业化
│   └── 增长
│
├── 财务中心
│   ├── 收益
│   ├── 分成
│   ├── 应收
│   ├── 待结算
│   ├── 结算记录
│   └── Ledger
│
└── 机构设置
    ├── 成员
    ├── 角色
    ├── 权限
    ├── 审批流
    ├── 审计
    ├── 安全
    └── API / Developer
```

## 3. 机构总览 Dashboard

登录后的 Dashboard 必须回答机构经营者最重要的问题：

1. 我有多少创作者？
2. 哪些创作者正在增长？
3. 哪些内容正在产生价值？
4. 哪些 IP 正在成长？
5. 粉丝是否增长？
6. 哪些任务需要处理？
7. 哪些内容存在风险？
8. 本月收益和待结算是多少？
9. 哪些商务合作正在进行？
10. 哪些指标出现异常？

Dashboard 必须支持：

- 今日/昨日/7日/30日/自定义时间范围；
- 创作者维度；
- 内容维度；
- IP 维度；
- 平台/渠道维度；
- 商业化维度；
- 风险/审核维度；
- 趋势与异常提示。

任何派生指标必须具有明确口径、时间窗口和数据来源。

## 4. 创作者管理

MCN 必须能够管理多个 Creator，但不能把 Creator 的身份权和机构管理权混为一体。

核心关系：

```text
Organization
→ Creator Membership
→ Role / Contract / Permission
→ Content / IP / Revenue
```

支持：

- 创作者招募；
- 入驻；
- 合作关系；
- 分组；
- 标签；
- 内容类型；
- 成长阶段；
- 权益；
- 运营状态；
- 合作状态；
- 退出/解约。

机构不得未经授权改变创作者个人身份核心属性。

## 5. 创作者招募与入驻

MCN Center 应提供机构招募入口：

```text
发现创作者
→ 邀请
→ 申请
→ 审核
→ 合作条款
→ 授权
→ 加入机构
→ Onboarding
```

必须支持：

- 邀请；
- 申请；
- 审核；
- 合作状态；
- 权限确认；
- 内容/IP归属规则确认；
- 商业分成规则；
- 退出机制；
- 审计记录。

合同、权利和资金相关信息必须具有独立的权限边界。

## 6. 机构团队与 RBAC

机构内部必须支持多人协作。

至少包含：

- Owner；
- Organization Admin；
- Creator Manager；
- Editor；
- Publisher；
- Moderator；
- Analyst；
- Finance；
- Legal/Rights；
- Business；
- Developer；
- Read-only Auditor。

权限采用最小权限原则。

敏感操作必须支持：

```text
Request
→ Permission Check
→ Optional Approval
→ Execute
→ Audit
```

敏感操作包括：

- 内容批量删除；
- 内容批量发布；
- 权限修改；
- 创作者移除；
- IP 权利变更；
- 商业合同；
- 资金/结算；
- API 凭证；
- 风控处理。

## 7. 机构审批流

MCN 必须支持内容生产审批，而不能要求所有事情由 Owner 直接操作。

典型流程：

```text
Creator Draft
→ Editor Review
→ Compliance / Rights Review
→ Publisher Approval
→ Publish
```

审批流必须支持：

- 创建；
- 指派；
- 通过；
- 驳回；
- 重新提交；
- 转交；
- 超时；
- 审计。

审批状态不得通过前端显示替代权威状态。

## 8. 机构内容中心

MCN 应看到整个机构的内容，而不是只看到某一个创作者。

统一状态：

```text
Draft
→ Processing
→ Moderation Pending
→ Scheduled
→ Published
→ Restricted
→ Archived
→ Deleted
```

支持：

- 按创作者筛选；
- 按内容类型筛选；
- 按 IP 筛选；
- 按状态筛选；
- 按时间筛选；
- 批量操作；
- 内容日历；
- 定时发布；
- 发布任务；
- 审核任务；
- 版权状态。

批量操作必须具备权限、确认、幂等、审计和失败恢复。

## 9. 多内容生产体系

MCN 必须能够统一经营：

- 图文；
- 动态；
- 小视频；
- 长视频；
- 漫画；
- 小说；
- 剧集/系列；
- 音频/Podcast；
- 直播；
- APP/小程序；
- 游戏。

不同内容类型可以使用不同生产工具，但必须共享：

- Creator；
- Organization；
- Asset；
- Content；
- IP；
- Permission；
- Moderation；
- Rights；
- Analytics；
- Monetization。

## 10. 机构素材中心

机构素材中心是 MCN 级资产库。

支持：

- 图片；
- 视频；
- 音频；
- 字幕；
- 封面；
- 漫画素材；
- 文档；
- 品牌素材；
- IP 素材；
- 授权素材。

必须记录：

- 所属机构；
- 上传者；
- 权利状态；
- 使用范围；
- 引用内容；
- 创建/更新时间；
- 删除/归档状态。

删除被内容引用的素材时必须检查引用关系，禁止静默破坏已发布内容。

## 11. 内容日历与生产计划

MCN 需要从“内容列表”升级到“生产运营”。

支持：

```text
Idea
→ Planned
→ Draft
→ Review
→ Scheduled
→ Published
→ Analytics
```

内容日历至少支持：

- 日期；
- Creator；
- Content Type；
- IP；
- Campaign；
- 状态；
- 负责人；
- 截止时间；
- 发布渠道。

## 12. IP Center

MCN 的核心差异之一是机构级 IP 管理。

```text
Organization
→ Creator
→ IP
→ Series / Universe
→ Character / Entity
→ Works
→ Community
→ Distribution
→ Commerce / Licensing
```

支持：

- IP 创建；
- IP 归属；
- 创作者关联；
- 作品关联；
- 系列关联；
- 角色/实体；
- Remix/Derivative；
- 授权；
- 权利期限；
- 区域；
- 权利类型；
- 授权对象；
- IP 数据；
- IP 商业化。

所有权利敏感关系必须具有 provenance、授权依据和可审计记录。

## 13. 粉丝与社区经营

MCN 不应只统计粉丝数量，还要管理机构整体 Audience。

支持：

- 粉丝增长；
- 粉丝来源；
- 创作者重合粉丝；
- IP 粉丝；
- 会员；
- 社区；
- 评论；
- 消息；
- 活跃度；
- 留存；
- 粉丝分层。

不得未经权限将个人敏感用户数据跨创作者或跨机构暴露。

## 14. Creator Growth 机构视角

MCN Center 应比 Creator Center 多一层机构运营视角：

```text
Creator
→ Content Performance
→ Audience Growth
→ Creator Growth
→ Business Value
```

机构可以看到：

- 新人；
- 成长期创作者；
- 成熟创作者；
- 高潜 IP；
- 内容稳定性；
- 粉丝增长；
- 商业化表现；
- 流失风险的合规/运营摘要。

不能暴露内部风控、推荐、反作弊或安全阈值。

## 15. 商务合作中心

MCN 应具备独立的商务工作流：

```text
Opportunity
→ Brief
→ Creator / IP Matching
→ Proposal
→ Negotiation
→ Contract
→ Campaign
→ Delivery
→ Attribution
→ Settlement
```

支持：

- 品牌客户；
- 商务机会；
- Creator 匹配；
- IP 匹配；
- 报价；
- 合作任务；
- 交付物；
- 审核；
- 数据归因；
- 合同状态；
- 结算。

## 16. 广告与商业化

MCN 商业化至少包括：

- 广告；
- 品牌合作；
- 商品；
- 会员；
- IP 授权；
- Marketplace；
- 活动；
- 创作者收益。

商业化数据必须与内容、Creator、IP 建立可追踪关系。

资金权威事实必须进入 Ledger：

```text
Commercial Event
→ Revenue Recognition
→ Ledger
→ Allocation
→ Creator / Organization Share
→ Settlement
```

不得通过修改余额字段伪造结算结果。

## 17. 机构级收益与分成

MCN 必须支持机构与创作者之间的可解释分成模型。

例如：

```text
Gross Revenue
→ Platform Fees / Adjustments
→ Net Revenue
→ Contractual Share
→ Creator Share
→ MCN Share
→ Tax / Required Adjustments
→ Settlement
```

每次资金变化必须具备：

- 来源；
- 时间；
- 业务关联；
- 结算规则版本；
- 分配记录；
- Ledger Entry；
- 审计证据。

## 18. 数据中心

机构数据中心至少分为：

### Creator
- 创作者规模；
- 增长；
- 活跃；
- 内容产能；
- 商业化。

### Content
- 曝光；
- 阅读；
- 播放；
- 完播；
- 停留；
- 互动；
- 转化。

### IP
- IP 规模；
- 内容覆盖；
- 粉丝；
- 商业化；
- 授权。

### Audience
- 粉丝；
- 活跃；
- 留存；
- 会员。

### Business
- 收入；
- 广告；
- 品牌合作；
- 商品；
- 授权；
- 结算。

### Operations
- 审核任务；
- 发布任务；
- 失败任务；
- 风险事件；
- 版权事件。

所有指标必须明确口径、时间范围和数据来源。

## 19. 风控、版权与安全

机构操作必须受到统一安全边界约束。

覆盖：

- Creator 权限；
- Content 权限；
- IP 权利；
- 商业合同；
- 资金；
- 用户隐私；
- 内容安全；
- 版权；
- API 安全；
- 审计。

机构不能绕过平台级 Safety / Risk / Copyright / Privacy 规则。

## 20. 任务中心

所有机构级异步任务统一进入 Task Center：

```text
Created
→ Queued
→ Processing
→ Waiting Approval
→ Completed / Failed / Cancelled
```

任务包括：

- 批量发布；
- 媒体处理；
- 内容审核；
- 数据导出；
- 批量修改；
- IP 操作；
- 商务任务；
- 结算任务。

失败必须保留任务上下文并提供恢复路径。

## 21. 通知与待办

MCN 首页必须有机构级 Action Center：

- 待审核；
- 待发布；
- 版权事件；
- 风险事件；
- 商务待处理；
- 合同待处理；
- 结算待处理；
- 权限请求；
- 系统异常。

通知不得只作为消息展示，必须能进入对应业务上下文并完成处理。

## 22. API / Developer

机构级 API 必须独立于 Payload 内部实现。

支持：

- Creator 管理；
- Content 查询/管理；
- IP；
- Analytics；
- Commerce；
- Webhook/Event；
- Organization；
- Permissions。

API 必须具备：

- versioning；
- authentication；
- authorization；
- request ID；
- idempotency；
- rate limiting；
- error model；
- audit；
- backward compatibility。

禁止暴露 Payload 内部对象、内部数据库实现或内部管理接口作为稳定公共契约。

## 23. 跨设备连续性

机构管理员可以在：

```text
Web/H5
↕
Mobile Web
↕
Android/iOS
```

之间继续工作。

必须保证：

- 审批状态；
- 任务状态；
- 草稿/内容上下文；
- 通知待办；
- 权限变更；
- 结算状态；
- IP 操作上下文。

发生冲突不得静默覆盖。

## 24. 高并发与成本原则

MCN Center 不得把高频操作全部同步写入权威数据库。

统一模式：

```text
User Action
→ API
→ Authoritative State
→ Domain Event
→ Queue / Async
→ Aggregation / Derived State
→ Analytics / Distribution
```

适用于：

- 曝光；
- 播放；
- 阅读；
- 点赞；
- 分享；
- 粉丝变化；
- 数据统计；
- Creator Growth 指标。

推荐、增长、商业化等派生数据必须可重建、可校验，不能把高频原始事件直接当成可信商业或推荐事实。

## 25. 错误与恢复

必须覆盖：

- Offline；
- Timeout；
- Permission Denied；
- Version Conflict；
- Upload Failure；
- Processing Failure；
- Moderation Pending；
- Copyright Conflict；
- Contract Conflict；
- Payment Failure；
- Settlement Failure；
- Service Degraded。

统一原则：

```text
发生问题
→ 保留工作
→ 解释状态
→ 给出恢复路径
→ 恢复后继续原任务
```

资金、权利、权限和安全操作不得因为网络重试产生重复执行。

## 26. UX 原则

MCN Center 必须遵循：

- 零死路；
- 零静默覆盖；
- 最小操作成本；
- 明确责任人；
- 明确状态；
- 明确下一步；
- 可恢复；
- 可审计；
- 可跨设备继续。

禁止：

- 暗黑模式；
- 隐藏取消；
- 未解释的权限提升；
- 不可恢复批量操作；
- 资金操作无确认；
- 权利变更无证据；
- 批量操作无审计；
- 风控内部规则泄露。

## 27. MCN 与 Creator Center 的边界

```text
Creator Center
= 单个创作者的生产与经营工作台

MCN Center
= 机构对多个 Creator / Content / IP / Business 的经营工作台
```

Creator Center 负责：

- 创作；
- 草稿；
- 发布；
- 粉丝；
- Creator Growth；
- IP；
- 个人商业化。

MCN Center 负责：

- 多 Creator；
- 组织权限；
- 招募/合作；
- 团队协作；
- 审批；
- 批量内容运营；
- IP 组合经营；
- 商务；
- 广告；
- 结算；
- 机构级数据；
- 运营与审计。

两者共享底层身份、Content、IP、Event、Analytics、Rights、Ledger 等契约，但不得复制两套相互矛盾的权威状态。

## 28. P0 用户旅程

MCN 核心旅程至少包括：

1. 机构注册/登录；
2. 机构 Onboarding；
3. 邀请/招募 Creator；
4. Creator 入驻；
5. 分配团队角色；
6. 创建生产任务；
7. 内容审核；
8. 批量发布；
9. 内容数据分析；
10. Creator Growth；
11. IP 管理；
12. 粉丝/社区经营；
13. 商务合作；
14. 广告/商业化；
15. 收益分配；
16. 结算；
17. 权限变更；
18. 版权事件处理；
19. 风险/审核事件处理；
20. 审计与恢复。

## 29. Data / API / Event / Permission 契约要求

MCN Center 每个可实施能力必须完成：

1. Data Contract；
2. API Contract；
3. Event Contract；
4. Permission/Security Contract；
5. Privacy Contract；
6. Rights Contract；
7. Risk/Moderation Contract；
8. Cost/Runtime Contract；
9. Observability Contract；
10. Test/Acceptance Contract；
11. Migration/Recovery Contract（涉及持久状态时）。

## 30. 必须满足的横向不变量

所有 MCN 能力必须满足：

- identity；
- organization ownership；
- authorization；
- lifecycle；
- idempotency；
- duplicate/replay protection；
- privacy；
- rights/provenance；
- risk/moderation；
- money/ledger；
- event ordering；
- derived-state rebuild；
- auditability；
- observability；
- cost/latency；
- backward compatibility；
- recovery。

## 31. P0 Acceptance

MCN Center 在实现阶段至少必须通过：

- 机构登录；
- Dashboard；
- Creator 管理；
- Creator 招募/入驻；
- RBAC；
- 审批流；
- 内容中心；
- 批量运营；
- 素材中心；
- 内容日历；
- IP Center；
- 粉丝/社区；
- Creator Growth；
- 商务合作；
- 商业化；
- 收益/分成；
- Ledger/结算；
- 数据中心；
- Task Center；
- Action Center；
- 版权/风险/安全；
- API/Event；
- 审计；
- 错误恢复；
- 跨设备连续性；
- H5/Web；
- CI；
- User Acceptance。

## 32. Implementation Admission

MCN Center 不得直接从产品想法进入代码。

必须经过：

```text
MCN Capability
→ L1/L2 Mapping
→ L3/L4 Traceability
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security
→ Privacy/Rights
→ Risk/Moderation
→ Cost/Runtime
→ UX State
→ Failure/Recovery
→ Test/Acceptance
→ READY
```

## 33. STOP 条件

出现以下任一情况必须 STOP：

- 新增未映射的产品责任；
- Organization/Creator/Content/IP 权威状态重复；
- 未定义组织权限；
- 批量操作没有幂等；
- 钱绕过 Ledger；
- 权利关系绕过 provenance；
- 高频事件直接成为可信统计/推荐事实；
- 未定义恢复策略；
- 未定义成本；
- API 暴露 Payload 内部；
- 复制 Payload Core；
- 实现没有 Acceptance Test；
- UI 声称完成但后端契约不存在。

## 34. 与主流平台的产品差异目标

LuckRead MCN Center 的目标不是复制一个 YouTube Studio 或 TikTok Business Center，而是形成：

```text
MCN
│
├── Creator Management
├── Production OS
├── Content OS
├── IP OS
├── Audience OS
├── Business OS
├── Commerce OS
├── Settlement OS
└── Governance OS
```

最终形成：

> **“机构登录后即可经营 Creator、Content、IP、Audience、Business 和 Settlement 的统一操作系统。”**

## 35. 非目标

本契约不要求第一阶段立即实现：

- 全部专业视频剪辑；
- 全部 AI 创作；
- 全部广告竞价算法；
- 全部金融能力；
- 全部跨区域结算；
- 全部企业 ERP；
- 所有第三方平台的完整账号托管。

这些能力必须作为独立能力按 Contract → READY → Implementation → CI → Acceptance 生命周期推进。

## 36. 完成定义

MCN Center 只有在以下全部 PASS 后才能标记 DONE：

```text
Product Experience PASS
→ Capability Traceability PASS
→ Data Contract PASS
→ API Contract PASS
→ Event Contract PASS
→ Permission/Security PASS
→ Privacy/Rights PASS
→ Risk/Moderation PASS
→ Cost/Runtime PASS
→ UX/Accessibility/Performance PASS
→ Local PASS
→ CI PASS
→ Cross-device PASS
→ Failure/Recovery PASS
→ User Acceptance PASS
```

**当前状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

本文件定义 MCN Center 的产品边界和完整体验，不授权跳过契约直接进入大规模代码实现。
