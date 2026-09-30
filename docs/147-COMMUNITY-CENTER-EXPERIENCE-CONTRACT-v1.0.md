# LuckRead Community Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：54 Social / Community + 63 Moderation + 62 Risk / Trust + 108 Membership**

## 1. 定位

Community Center 是用户、Creator、社区成员、管理员与运营角色进入和管理社区关系的统一体验中心，覆盖社区发现、成员关系、内容互动、主题、治理、会员、活动与异常处理。

Community Center 是体验/操作层；Social / Community 持有关系与社区业务事实，Moderation 持有治理决定，Risk 持有风险事实，Membership 持有订阅/会员事实。

## 2. Benchmark / Superiority

借鉴微博、小红书、B站、X Communities 等社区产品，以及短视频平台粉丝/互动工作台的成熟交互模式。目标不是复制界面，而是做到：关系更清楚、发现更自然、互动更低摩擦、治理更透明、社区管理更高效。

## 3. Information Architecture

```text
Community Center
├── Home / My Communities
├── Discover
├── Following / Fan Communities
├── Topics / Hashtags
├── Posts / Comments / Replies
├── Members / Roles
├── Membership
├── Moderation / Reports
├── Events / Activities
├── Notifications / Mentions
├── Analytics / Health
└── Settings / Privacy
```

## 4. Core Journeys

### 4.1 Join
`Discover Community → Preview → Join / Request → Membership Result`

### 4.2 Participate
`Topic / Post → Comment / Reply / Reaction → Notification → Follow-up`

### 4.3 Community management
`Signal → Review → Moderate → Notify → Appeal / Restore`

### 4.4 Member lifecycle
`Apply → Approve → Active → Restricted / Muted → Removed / Appeal`

## 5. Experience Requirements

- 用户进入社区时必须快速理解主题、规则、成员身份和当前状态；
- 关注、加入、点赞、评论、回复等高频操作必须低延迟、可撤销、幂等；
- 社区治理动作必须解释“发生了什么、依据什么、下一步是什么”；
- 私密社区与成员范围必须在缓存和搜索中保持隔离；
- 管理员批量操作必须预览影响范围并提供失败/重试明细；
- 社区异常、内容删除、用户屏蔽、权限变化均必须有明确 UI 状态；
- 跨 Web / Android / iOS 的未完成操作与阅读上下文应保持连续。

## 6. Authority Boundary

```text
Social / Community → relationships, memberships, community state
Content → post/content source
Creator → creator identity
Membership → subscription / entitlement
Moderation → moderation decision
Risk / Trust → risk decision
Notification / IM → message delivery
Feed / Recommendation → ranking / discovery
Analytics → derived metrics
```

## 7. API / Event Surface

中心通过稳定 `/v1/social`、`/v1/community` 领域 API 组合数据，不直接读取 D1 表或 Payload internals。事件用于通知、聚合、搜索、分析与推荐更新；消费者必须支持至少一次投递。

## 8. Safety / Privacy / Reliability

Block / Mute 等关系必须优先于推荐与互动；社区私域数据不得通过派生缓存泄漏。必须处理重复操作、离线恢复、事件乱序、成员权限变化、被删除内容、社区限制、审核失败和批量部分失败。

## 9. Acceptance / Superiority Gate

验证：社区加入完成效率、互动成功率、状态理解正确率、治理透明度、批量管理效率、隐私隔离、跨设备连续性、异常恢复率，并通过 139 Global Product & Experience Superiority Gate。

**STOP：** 第二套 Social/Community Authority、Block/Mute 无法生效、私域越权、评论绕过治理、派生计数作为事实、重复副作用、不可恢复治理、低于行业基线。
