# LuckRead APP 用户旅程与功能验收矩阵 v1

**状态：ACTIVE_ACCEPTANCE_SPEC / EVIDENCE_REQUIRED / NO_RUNTIME_PASS_CLAIM**  
**基线：main @ 270a0522637dc31f047bfd7a3a2034d9e38e355c**  
**日期：2026-11-21**  
**上位矩阵：docs/41-UX-CAPABILITY-TRACEABILITY-AND-JOURNEY-ACCEPTANCE-MATRIX-v1.0.md**  
**APP 功能追踪：LUCKREAD-APP-FEATURE-IMPLEMENTATION-TRACKER.v1.md**

---

## 1. 本矩阵与现有 UX 矩阵的关系

docs/41 是全平台的 UX 能力和用户旅程矩阵。本文件只定义 Expo / React Native APP 的具体操作路径、测试用例、设备验收、数据证据和失败恢复方式，不复制全平台功能层级。

**代码中有测试文件 ≠ 测试在当前 SHA 通过；CI 通过 ≠ 真机旅程通过；页面显示成功 ≠ Neon 权威数据已持久化。**

本文件所有尚未提供当前 SHA 测试运行记录和设备证据的用例，均保持 NOT_VERIFIED。

## 2. 验收等级

| 等级 | 证据 | 说明 |
|---|---|---|
| L0 Source | 源码、API route、组件和测试源文件路径 | 只证明仓库中存在实现 |
| L1 Automated | 当前目标 SHA 上实际通过的单元 / API / 集成测试与 CI run | 不可由历史测试结果代替 |
| L2 Build | 当前目标 SHA 的 Android / iOS 目标构建产物 | 跳过或未运行必须明示 |
| L3 Device | 真机安装、测试账号操作、截图/录屏、设备与系统版本 | 模拟器不能代替真机验收 |
| L4 Runtime / Data | 真实 W01 API 响应、requestId、权威持久化核对、跨端重新读取 | 不得只看 APP 本地状态 |

某项能力按适用等级全部通过后才能标记 VERIFIED_COMPLETE。所有 API 数据必须通过 W01；APP 不得直接访问 Neon、Worker 内部绑定或对象存储。

## 3. 全部用例通用的负例

每个可写功能都应覆盖下列适用情况：

- 未登录、Session 过期、退出登录后再次进入。
- 资源所有者与非所有者、公开与私有、会员与非会员。
- Block / Mute / 隐私 / 审核限制。
- 快速重复点击、同一幂等键重试、响应超时但服务端已提交。
- 网络离线、弱网、超时、5xx、429 和接口返回结构无效。
- 页面切后台、返回、重进和 APP 进程被终止。
- 浅色 / 深色模式、动态字体、系统安全区、键盘避让。
- 真实数据重新读取，而不是只确认本地乐观状态。

## 4. APP Shell、身份与导航

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-AUTH-001 | 冷启动，Session 有效 | 恢复身份并进入可用页面，不泄露 token | app/tests/auth-flow-api.test.mjs；session-management-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-AUTH-002 | Session 过期后打开受保护页面 | 受控退出或重新登录，公开页面按策略可用 | app/tests/auth-flow-api.test.mjs；session-management-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-SHELL-001 | 切换 Home / Search / Video / Notifications / Messages | Tab 导航、图标状态、返回路径正确 | app/tests/tab-navigation-ui.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-SHELL-002 | 打开 Drawer、账户弹层、主题弹层 | 弹层可开关，不遮挡系统返回和键盘 | app/tests/native-menu-dependencies.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-SHELL-003 | 更改浅色 / 深色 / 系统主题并重启 | 主题偏好持久化，页面和弹层一致 | app/tests/theme-preference-store.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-SHELL-004 | 离线后恢复网络 | 网络提示正确，页面可重试，不伪造写入成功 | app/tests/network-status.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |

## 5. 信息流与帖子卡片

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-FEED-001 | 打开 For You | 从 W01 获取真实帖子；无数据、加载和错误状态明确 | app/tests/feed-query.test.mjs；native-query-cache.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-FEED-002 | 登录后打开 Following | 按当前用户关注关系读取；不得串用其他账号缓存 | app/tests/feed-query.test.mjs；native-query-cache.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-FEED-003 | 下拉刷新并滚动加载下一页 | Cursor 正确；无重复项；请求可取消 | app/tests/feed-query.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-FEED-004 | 切换 Tab 后返回原 Feed | 按产品定义保留/刷新滚动位置和筛选状态 | app/app/(drawer)/(tabs)/(index)/index.tsx | NOT_VERIFIED |
| ACC-FEED-005 | 打开帖子详情、返回 Feed | 内容 ID 和原始上下文一致；评论定位正确 | app/tests/comment-navigation.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-FEED-006 | 被删除、被屏蔽或无权限内容出现在旧缓存 | 服务端权限结果优先，过期缓存不能绕过访问控制 | app/tests/feed-hydration.test.mjs；相关 W01/W03/W05 测试 | NOT_VERIFIED |

## 6. 社交互动

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-SOCIAL-001 | 点赞 / 取消点赞 | 按钮即时反馈；失败回滚；真实计数重新读取 | app/tests/post-interactions-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-002 | 关注 / 取消关注 | 用户关系和 Feed 状态按服务端结果变化 | app/tests/social-screen-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-003 | 创建评论和嵌套回复 | 显示真实作者、父回复、正文和时间 | app/tests/comment-create-api.test.mjs；comment-navigation.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-004 | 编辑 / 删除自己的评论 | 仅本人可操作；服务端授权；列表状态同步 | app/tests/comment-edit-api.test.mjs；comment-delete-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-005 | 点赞评论、举报评论 | 状态和举报结果来自真实 API | app/tests/comment-likes-api.test.mjs；comment-report-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-006 | Repost / Undo Repost | 原内容身份保留，关系和数量不重复 | app/tests/post-interactions-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-007 | 收藏 / 取消收藏并打开书签页 | 书签列表和卡片状态一致 | app/tests/post-interactions-api.test.mjs；social-screen-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-008 | 分享帖子或主页 | 生成 canonical LuckRead URL，系统分享器打开 | app/tests/content-share-actions.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-SOCIAL-009 | 置顶 / 取消置顶个人内容 | 只能操作本人；主页和内容列表一致 | app/tests/profile-pin.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-010 | 举报、屏蔽、静音和解除 | 服务端成功后反馈；相关内容和关系按策略过滤 | app/tests/report-api.test.mjs；block-mute-management.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SOCIAL-011 | 引用转发 | 原帖引用 ID、作者、内容和附加评论关系正确 | Quote Post 专项测试尚未确认 | PARTIAL / NOT_VERIFIED |

## 7. 发布、媒体与内容生命周期

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-PUBLISH-001 | 发布纯文字动态 | W01/W03 返回 canonical 内容 ID；重新读取同一内容 | app/tests/publish-api.test.mjs；publish-flow.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-002 | 选择多张图片、排序、移除和设封面 | 排列和媒体引用一致；失败文件可单独重试 | app/tests/publish-composer-assets.test.mjs；image-upload-preparation.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-PUBLISH-003 | 添加 alt text 并从 Feed 查看 | 辅助文本保留，媒体展示可访问 | app/tests/media-alt-text.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-PUBLISH-004 | 现场拍摄照片并发布 | 只在用户触发时请求相机权限；文件进入现有 W01 上传 | app/tests/camera-capture.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-005 | 从系统媒体库选择 GIF | 原动画文件不会被错误静态重编码；实际 APP/H5/PC 展示需检查 | app/tests/publish-composer-assets.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-006 | 选择并发布视频 | 上传、授权播放、详情和视频 Feed 播放使用同一真实媒体引用 | app/tests/publish-flow.test.mjs；video-feed-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-007 | 上传中断、超时或播放授权失败后重试 | 不重复创建媒体记录；同一文件可恢复整文件重试；不可误称字节级断点续传 | app/tests/publish-pending-media-recovery.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-008 | 创建、投票、结束投票 | 一人一票、选项和结果以 W05 权威响应为准 | app/tests/publish-flow.test.mjs；paid/content 或 poll 相关 Worker 测试 | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-009 | 保存草稿、退出、重启并恢复 | 服务端 DRAFT 能恢复；失败状态不丢失已上传媒体引用 | app/lib/publish-draft-autosave.ts；app/tests/publish-flow.test.mjs、publish-pending-media-recovery.test.mjs（当前 main 未找到独立 autosave 专项测试） | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-010 | 定时发布、改期、取消并等待触发 | W03 权威状态变化；时区正确；发布后 Feed 可读取 | app/tests/publish-schedule.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-011 | 编辑和删除自己的帖子 | 所有权、ETag/版本和真实状态转换生效；内容 ID / URL 不被错误重建 | app/tests/publish-flow.test.mjs；publish-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUBLISH-012 | 公开 / MEMBERS_ONLY 内容访问 | 非会员和未授权用户不能因客户端缓存绕过权益限制 | app/tests/paid-content-entitlement.test.mjs；W07/W03 权限测试 | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |

## 8. 搜索、主页、视频与通知

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-SEARCH-001 | 搜索公开内容 | 游标分页、空结果和错误恢复正确 | app/tests/content-search.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SEARCH-002 | 按用户名搜索 | 返回真实公开资料，不泄露私人账号数据 | app/tests/social-screen-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-SEARCH-003 | 打开推荐专题 | 专题内容与 canonical 路由对应 | app/app/(drawer)/(tabs)/(search)/search.tsx | CODE_PRESENT / L3 NOT_VERIFIED |
| ACC-SEARCH-004 | 高级筛选、历史、Latest、Trending | 只能显示服务端真实支持的能力，不出现本地假筛选 | 相关 UI/API 测试尚未确认 | PARTIAL / NOT_VERIFIED |
| ACC-PROFILE-001 | 查看 Posts / Replies / Media / Likes | 正确分页、用户隔离、隐私和空状态 | app/tests/social-screen-api.test.mjs；profile-pin.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-VIDEO-001 | 播放视频、滑动切换、返回前台 | 播放器状态、autoplay、暂停、失败恢复正确 | app/tests/video-feed-api.test.mjs；video-feed-autoplay.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-NOTIFY-001 | 打开站内通知、标记已读 | 当前服务端支持的通知类型和 unread 状态正确 | app/tests/social-screen-api.test.mjs；notification-preferences-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-PUSH-001 | 允许通知并注册 Android / iOS 设备 | 正确平台、installation ID 和 token 写入现有 Push Endpoint API | app/tests/push-notifications.test.mjs | CODE_TEST_SOURCE_PRESENT / L3 NOT_VERIFIED |
| ACC-PUSH-002 | 实际向测试设备投递通知并点击 | 设备确实收到；深链打开对应帖子/主页/会话；失败可恢复 | 需要真实设备、供应商和服务端投递日志 | NOT_VERIFIED |
| ACC-PUSH-003 | 拒绝权限、注销、token 轮换 | 不重复弹权限；服务端失效 endpoint；账号隔离 | app/tests/push-notifications.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |

## 9. 订阅、创作者和社群

| 用例 ID | 用户操作 | 预期结果 | 自动化证据路径 | 当前状态 |
|---|---|---|---|---|
| ACC-MON-001 | 浏览套餐、购买/查看订阅状态 | 付款与权益来自 W07 权威结果 | app/tests/subscriptions-api.test.mjs；paid-content-entitlement.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-MON-002 | 查看账单、付款历史、退款 | 真实订单、账单和退款状态，不从客户端推算 | app/tests/billing-api.test.mjs | CODE_TEST_SOURCE_PRESENT / L3-L4 NOT_VERIFIED |
| ACC-CREATOR-001 | 从 Drawer 打开创作者工作室 | 当前 main 仍显示未接入提示；通过标准必须是可用的原生工作流程 | 当前无原生 creator studio route/test 证据 | MISSING |
| ACC-LISTS-001 | 创建、管理和打开 Lists Feed | 创建、成员、隐私、分页和 Feed 全部由服务端授权 | 当前 Drawer 为占位入口 | MISSING |
| ACC-COMMUNITY-001 | 搜索、加入、发帖和退出社群 | 成员角色、规则、举报及治理由服务端执行 | 当前 Drawer 为占位入口 | MISSING |
| ACC-LIVE-001 | 创建/加入 Spaces 并发言 | RTC 权限、房间生命周期、断线恢复和治理真实工作 | 当前 Drawer 为占位入口 | DEFERRED / NOT_VERIFIED |

## 10. 私信特殊登记

当前 main 的 APP 私信页仍是占位/基础入口；另有外部工程师开放草稿 PR #2028，范围为 W05 Neon 1:1 文字私信 Phase 1，并包含 W01 API 与原生会话页。

本矩阵不得：
- 把 PR #2028 的分支代码视作 main 已实现；
- 修改、关闭或合并 PR #2028；
- 重复开发该 PR 正在覆盖的文件和功能；
- 将其 Phase 1 误认为群聊、附件、实时 typing、WebSocket、Push 或全量 IM 已完成。

PR #2028 如合并至 main，后续再把 ACC-DM 用例拆为 inbox、创建会话、发送、分页、read cursor、幂等、block 规则、断线恢复和多设备等具体验收。

## 11. 每次验收必须保存的证据

| 证据字段 | 记录要求 |
|---|---|
| main SHA / PR head SHA | 完整 SHA，不能只写分支名 |
| PR / Workflow | GitHub PR URL、workflow run URL、相关 job 结果 |
| APP 版本 | 版本、构建号、OTA/runtime compatibility |
| 设备 | Android / iOS 型号、OS 版本、是否真机 |
| 测试账号角色 | 访客、普通用户、作者、会员、非会员等；不记录密码或 token |
| 测试数据 | 内容 ID、用户测试 ID、媒体 ID；不得记录敏感个人信息 |
| API | W01 endpoint、requestId、HTTP 状态、关键响应字段（脱敏） |
| 持久化 | 通过现有安全只读诊断证据核对权威状态，不暴露连接串或 secret |
| 截图/录屏 | 关键成功、失败、恢复路径的证据 |
| 结果 | PASS / FAIL / NOT_RUN / BLOCKED，并说明原因和后续动作 |

### 11.1 失败处理

- 单项失败只打开对应缺陷，不重开所有已通过功能。
- 同一个失败路径重复两轮仍无新代码、新证据、新诊断或环境变化时停止循环，标记 BLOCKED 并报告。
- 不得删除必要测试或跳过权限/架构门禁来获得绿色 CI。
- 测试没有运行时必须标记 NOT_RUN，不能以“测试代码存在”替代。
- 当前 main、开放 PR 或目标运行环境变化时，只重测受影响用例。

## 12. 本文件当前结论

本矩阵记录了当前 main 的自动化测试源文件和 APP 真实旅程要求；本次文档建立过程没有执行 Android / iOS 安装、真实账号 API、生产推送、支付或 Neon 数据验收。

因此：**本版本没有把任何功能标记为 VERIFIED_COMPLETE。** 后续每个模块必须以实际运行证据更新状态。
