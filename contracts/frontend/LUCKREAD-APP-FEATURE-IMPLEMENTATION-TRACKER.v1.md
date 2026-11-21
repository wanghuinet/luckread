# LuckRead APP 功能实施追踪表 v1

**状态：ACTIVE_BASELINE / EVIDENCE_REQUIRED / NO_FEATURE_COMPLETION_CLAIM**  
**基线仓库：wanghuinet/luckread**  
**基线分支：main**  
**基线 SHA：270a0522637dc31f047bfd7a3a2034d9e38e355c**  
**基线检查日期：2026-11-21**  
**上位契约：[X + Threads 目标体验与分阶段实施契约](./LUCKREAD-APP-X-THREADS-EXPERIENCE-IMPLEMENTATION-CONTRACT.v1.0.md)**

---

## 1. 本表的作用

本表把产品体验契约转换为可追踪的工程模块。每一行必须能追溯到：

**产品能力 → APP 页面/组件 → API adapter → W01 路由 → 领域 Worker / 权威数据 → 测试 → PR → 真机/生产验收证据。**

本表是 APP 实施状态的活动台账，不替代：
- 全平台 UX 能力与旅程矩阵：docs/41-UX-CAPABILITY-TRACEABILITY-AND-JOURNEY-ACCEPTANCE-MATRIX-v1.0.md
- Blueprint 功能主清单：contracts/alignment/feature-inventory.v1.json
- 各 Worker 的 API、数据、权限、事件、迁移和安全契约
- APP X + Threads 产品体验总契约

feature-inventory 中的 DISCOVERED 只表示能力被登记，不代表代码或运行功能已经完成。本表中的代码路径和测试路径也不自动代表测试已在本基线 SHA 上通过。

## 2. 状态定义

| 状态 | 含义 | 能否视为功能完成 |
|---|---|---|
| VERIFIED_COMPLETE | 代码、API、权限、自动化测试、目标平台构建、真机和目标环境真实旅程均有可追溯证据 | 是，仅限本行定义的范围 |
| CODE_PRESENT | 当前 main 存在可执行实现 | 否 |
| CODE_AND_TEST_SOURCE_PRESENT | 当前 main 有实现和对应测试源文件，但本轮未核实 CI 及真机结果 | 否 |
| PARTIAL | 部分能力存在，仍有明确子功能缺口 | 否 |
| PR_OPEN_EXTERNAL | 其他工程师的开放 PR 正在实现；不属于本轮可修改/合并范围 | 否 |
| MISSING | 当前 main 未发现可用 APP 实现 | 否 |
| BLOCKED | API、权限、许可证、平台能力或领域合同不足 | 否 |
| DEFERRED | 明确留待后续阶段 | 否 |
| NOT_AUDITED | 尚未完成源代码、API、测试和运行证据盘点 | 否 |

禁止使用“基本完成”“大部分完成”等无法验证的状态。一个模块可以同时有 CODE_PRESENT 和 DEVICE_NOT_VERIFIED 等独立标记。

## 3. 不能违反的执行控制

1. 每轮以最新 main SHA 为基线，重新检查开放 PR、代码差异和 CI；本表日期和 SHA 只是本次快照。
2. 一个 PR 只解决一个模块或一个完整的垂直功能切片。
3. 开始开发前必须先查本表、现有源码、开放 PR、历史 PR 和当前测试，确认没有重复工作。
4. 不得把 PR 分支中的代码记作 main 已有代码。
5. 未经用户明确授权，不合并 PR、不关闭 PR、不部署生产。
6. 只合并用户明确允许且由本助手创建的 PR；其他工程师的 PR 保持原状。
7. 每个模块达到 DoD 后立即停止，等待用户明确发出“继续”。
8. 不因某项功能被列入 X / Threads 体验目标，就绕过架构、权限、许可证或必要 CI 门禁。
9. 不把文档更新、截图、静态组件或本地假数据计作功能实现。
10. 不因重复确认已经存在的代码而重新跑一整套无差别检查；只执行本轮受影响的最小必要测试。

## 4. 2026-11-21 main 功能基线

以下结论是对当前 main 路径、APP 依赖清单和测试源文件的静态核对。它们不替代生产运行与真机验收。

| 模块 ID | 功能域 / 对应能力 | 当前状态 | main 中已有证据 | 主要剩余工作 |
|---|---|---|---|---|
| APP-001 | APP Shell、导航、主题、网络状态（CLIENT-003/004/009） | CODE_AND_TEST_SOURCE_PRESENT | app/app 路由；app/components/XBottomTabBar.tsx、TabBarScroll.tsx、NetworkStatusBanner.tsx；tab-navigation-ui、native-menu-dependencies、theme-preference-store、network-status 测试 | Android/iOS 真机完整导航、返回手势、弹层、字体、主题和启动恢复验收 |
| APP-002 | For You / Following 信息流（FEED-001/002） | CODE_AND_TEST_SOURCE_PRESENT | app/lib/feed-query.ts；首页 useInfiniteQuery；feed-query、native-query-cache、feed-hydration 测试 | 真实账号和目标环境分页、刷新、滚动恢复、去重、弱网和长列表性能验收 |
| APP-003 | Latest / Trending / Topic Feed（FEED-003/004/005） | PARTIAL | 搜索页有专题推荐和专题跳转；当前首页主 Tab 为 For You / Following | Latest、Trending、主题专属时间线须逐项核对权威 API；无 API 不开发假 Tab |
| APP-004 | Like / Follow / Comment / Reply / Repost / Bookmark / Share / Pin / Report / Block / Mute（SOCIAL-001..010） | CODE_AND_TEST_SOURCE_PRESENT | app/components/FeedItem.tsx、Comments.tsx、各互动按钮；post-interactions-api、comment-*、content-share-actions、profile-pin、block-mute-management 测试 | 完整真实用户旅程、计数一致性、跨端状态、重复请求、权限负例和失败恢复验收 |
| APP-005 | Quote Post（SOCIAL-006） | PARTIAL | 已有普通 repost / share；未在当前 main 的 APP 发布流程中确认完整引用编辑器及原帖引用关系 | 先检查所有已合并实现和开放 PR；确认 W03/W05 对原帖引用的权威 DTO 后再排期 |
| APP-006 | 个人主页与关系列表（SOCIAL-001/002） | CODE_AND_TEST_SOURCE_PRESENT | profile/[id].tsx；Posts、Replies、Media、Likes 数据读取、followers/following 路由；profile-pin、social-screen-api 测试 | 验收 Tab 真正呈现、隐私规则、账号状态、分页和媒体播放；文章/系列等细分内容另行核对 |
| APP-007 | 发帖、图片、GIF 本地文件、投票、草稿和定时发布（CONTENT-001/006、SOCIAL-008） | CODE_AND_TEST_SOURCE_PRESENT | app/app/publish.tsx；publish-api、publish-flow、publish-composer-assets、publish-composer-tokens、publish-draft-autosave、publish-schedule、publish-pending-media-recovery、publish-composer-assets 等测试 | 检查当前 main 上真实功能边界；真实环境发布、恢复、定时触发、编辑历史和三端一致性验收 |
| APP-008 | 相机拍照和媒体选择（MEDIA-001/003） | CODE_AND_TEST_SOURCE_PRESENT | CameraCaptureModal.tsx、PublishMediaActionSheet.tsx；expo-camera、expo-image-picker；camera-capture、image-upload-preparation 测试 | 真机权限、前后摄像头、文件生命周期、上传失败恢复和设备差异验收 |
| APP-009 | 视频 Feed / 播放（FEED-007、MEDIA-005） | CODE_AND_TEST_SOURCE_PRESENT | video Feed、expo-video；video-feed-api、video-feed-autoplay 测试 | 真机播放、后台切换、弱网、授权过期、进度恢复及媒体质量验收 |
| APP-010 | 视频创作增强（MEDIA-004/006/008/009） | PARTIAL | 已有视频选择、基础预览、上传和播放；当前证据未覆盖完整剪辑、字幕工作流和长视频生产体验 | 不重写视频 Feed；单独审查剪辑/转码/字幕服务与最小成熟组件 |
| APP-011 | 站内通知与偏好（NOTIFY-001/005） | PARTIAL | notifications.tsx 当前识别 FOLLOW、LIKE、COMMENT、REPLY、MENTION；notification-preferences-api、social-screen-api 测试 | 扩展通知类别、聚合、深链和偏好语义；以服务端真实类型为准 |
| APP-012 | 原生 Push 注册（NOTIFY-002、CLIENT-008） | CODE_AND_TEST_SOURCE_PRESENT | app/lib/push-notifications.ts；expo-notifications、expo-device；push-notifications.test.mjs；W05/W09 push API 路由和工作流 | 设备实际收到推送、token 轮换/注销、失效 token、深链、供应商投递和重试必须在真实环境验收 |
| APP-013 | 私信 1:1 文字 Phase 1（MSG-001） | PR_OPEN_EXTERNAL | main 当前 APP inbox 仍为基础页；外部开放草稿 PR #2028（financingsoft）包含 W01/W05 Neon 1:1 文字会话、消息页和 profile message action | 不修改、不关闭、不合并该 PR；不在本轮重复实现。由 PR 作者/负责人继续；后续只基于合并后的 main 做去重和验收 |
| APP-014 | 私信群聊、附件、输入状态、撤回和实时状态（MSG-002..008） | DEFERRED / NOT_IN_PHASE_1 | PR #2028 明确仅覆盖 1:1 文字，其余列为 deferred | 后续需单独产品授权、API/权限/隐私合同和模块排期；不得把 Phase 1 扩大成全 IM |
| APP-015 | APP 创作者工作室、分析和收益经营（CREATOR-003/006、PAY-007/010/011） | MISSING | 当前 APP Drawer 中“创作者工作室”入口调用 showUnavailable；APP 没有完整原生工作室页面 | 复用 H5/W01/W07/W11 已有真实能力；先完成 API/数据源映射，再实现原生工作流 |
| APP-016 | 订阅购买者体验、账单和会员内容（MON-001..011、PAY-001..004） | CODE_AND_TEST_SOURCE_PRESENT | membership-plans、subscriptions、billing 页面；subscriptions-api、billing-api、paid-content-entitlement 测试 | 真实支付环境、Webhook、权益即时生效、恢复购买/续费/退款和创作者侧闭环分开验收 |
| APP-017 | 高级搜索和筛选（SEARCH-001..010） | PARTIAL | search.tsx 支持内容搜索、用户名查找、专题发现；content-search 测试 | Top/Latest/People/Photos/Videos、历史、联想、筛选和排序逐项确认服务端 API |
| APP-018 | Lists（自定义用户列表）（FEED / SOCIAL） | MISSING | APP Drawer 的“列表”目前调用 showUnavailable | 先复用现有关系能力，确认列表领域 API 与权限后开发 |
| APP-019 | Communities（COMMUNITY-001..008） | MISSING | APP Drawer 的“社群”目前调用 showUnavailable | 对齐 docs/54、W06 治理和现有领域实现；APP 不自创社群权限 |
| APP-020 | Spaces / Live Audio（MEDIA-011/012） | MISSING | APP Drawer 的“空间”目前调用 showUnavailable | 先做 RTC 服务、Live Domain、权限和运维成本审查；未获准前不做假入口 |
| APP-021 | 自定义 Feed（FEED-005/009..013） | NOT_AUDITED | 当前 main 只有 For You / Following 主 Feed 和专题发现入口 | 审查服务端候选、排序、保存 Feed API 和现有 H5 能力 |
| APP-022 | Grok 类 AI 助手（AI 功能清单） | NOT_AUDITED / DEFERRED | 当前原生 Tab 路由命名中存在 grok 图标/历史布局痕迹，不构成可用 AI 助手实现 | 需产品范围、数据权限、模型接入、安全和成本批准；不属于 P0 |
| APP-023 | 书签文件夹 / 收藏整理 | PARTIAL | 已有真实收藏列表和 BookmarkButton | 先确认后端收藏夹/集合能力；没有权威 API 不做本地假文件夹 |

### 4.1 状态快照的重要说明

- APP README 当前仍包含“native like/repost/comment writes、媒体上传、push、creator subscriptions 尚未连接”的旧限制说明；这与 main 中已有的相关 adapter、依赖和测试源文件存在文档漂移。该 README 不可单独作为当前功能状态依据。
- docs/release/APP-PUBLISH-WINDOW-1.0-BETA-CLOSURE-v1.0.md 和 APP 当前源码应一起核对；历史 PR 状态不能视为当前开放 PR 状态。
- 当前 main 的 Expo SDK 58 依赖清单已包含 TanStack Query、expo-camera、expo-notifications 等。新增依赖前必须先查 app/package.json、app/bun.lockb 和当前兼容性检查。
- 当前 main 只确认代码和测试源文件存在；本轮没有执行上述真机或生产验收，因此没有把任何模块提升为 VERIFIED_COMPLETE。

## 5. 后续实施队列

以下是建议队列，不代表授权同时启动多个模块：

| 顺序 | 模块 ID | 工作内容 | 启动条件 |
|---:|---|---|---|
| 1 | APP-UX-001 | 核心 Shell、Feed、互动真实旅程验收和必要修复 | 以当前 main 为基线；不重写已有功能 |
| 2 | APP-PUBLISH-001 | Quote Post / 线程发布 / 内容生命周期差距收口 | 先排查当前代码和所有开放 PR |
| 3 | APP-PUSH-001 | Push 真实投递、深链和失败恢复闭环 | W05/W09/W10 现有投递链路可用 |
| 4 | APP-CREATOR-001 | 原生创作者工作室入口、总览和内容经营 | 复用 H5/W01/W07/W11；数据口径确认 |
| 5 | APP-DISCOVERY-001 | 搜索筛选、Latest、主题发现 | 现有 SEARCH API 和权限过滤确认 |
| 6 | APP-FEED-001 | 保存/自定义 Feed | 权威 API、用户偏好持久化确认 |
| 7 | APP-LISTS-001 | Lists | 领域能力和权限确认 |
| 8 | APP-COMMUNITY-001 | Communities | 社群领域代码与 W06 治理对齐 |
| 9 | APP-VIDEO-CREATOR-001 | 视频生产与字幕体验 | 媒体处理/转码边界确认 |
| 10 | APP-LIVE-001 | Spaces / Live | RTC 基础设施和产品授权 |
| 11 | APP-AI-001 | AI 辅助 | 数据隐私、成本和模型批准 |

PR #2028 不纳入本助手可修改范围；它是外部工程师的开放草稿，必须保持原状。主仓库状态变化后，再由最新 main 决定对应模块状态。

## 6. 每个模块必须提供的字段

每轮开始前在 PR 描述中填写：
- 模块 ID 和本轮唯一范围
- 最新 main SHA、开放 PR 去重结果
- 当前实现文件与 API / Worker 归属
- 复用仓库、精确上游 commit、许可证、源码路径
- 不做事项和明确阻塞
- 测试命令与受影响测试
- Android / iOS 构建及设备验收计划
- 完成后的状态变更和证据链接

每轮结束时更新本表相关行，不得重写无关模块状态。

## 7. 完成标准

只有完成以下全部适用条件，才可将某行标记 VERIFIED_COMPLETE：

1. 需求范围和负面范围明确。
2. main 源码与 API / Worker 权威关系明确。
3. 代码来自已授权且许可证适用的来源，或为必要的最小 LuckRead glue code。
4. 正确身份、权限、所有权、隐私、block/mute 和付费权益规则生效。
5. 自动化测试在目标 SHA 上实际通过。
6. 目标平台构建成功。
7. Android / iOS 真实设备用户旅程通过（适用时）。
8. 服务端真实持久化和状态重新读取成功。
9. 弱网、超时、失败、重试、重复请求和登录失效场景通过。
10. APP 与 H5 / PC 的权威业务事实一致（适用时）。
11. PR 已按用户授权处理，部署状态有证据。
12. 没有已知 P0 安全、数据或架构问题。

完成一个模块后停止，等待用户明确“继续”。
