# LuckRead APP 开源代码复用登记表 v1

**状态：ACTIVE_REGISTRY / LICENSE_AWARE / REUSE_BEFORE_BUILD**  
**基线：main @ 270a0522637dc31f047bfd7a3a2034d9e38e355c**  
**检查日期：2026-11-21**  
**APP 技术基线：Expo SDK 58 / React Native 0.88.1 / React 19.3.0**

---

## 1. 目的

本登记表负责回答四个问题：

1. LuckRead APP 已经使用哪些成熟开源库？
2. 哪些组件已经有许可证和本仓库使用证据，可以继续复用？
3. 哪些 GitHub X / Threads 仓库只能参考，不能直接复制？
4. 新模块需要写代码时，怎样证明复用代码确实成熟、可移植、合法且通过了验证？

本表登记“候选来源”和“复用准入证据”，不表示把上游整个项目视为可直接集成。GitHub stars、README 功能列表或截图都不是代码质量验证。

## 2. 复用决策等级

| 等级 | 定义 | 可以做什么 |
|---|---|---|
| REUSE_IN_REPO | 已在 LuckRead main 中依赖或落地，许可证信息可核对 | 优先复用现有版本和组件，不随意更换 |
| VERIFIED_SOURCE_CANDIDATE | 上游许可证、维护、测试、目标平台构建和模块试用均通过 | 可在限定范围内复制或适配，并记录精确 commit |
| REFERENCE_ONLY | 仅用于观察交互、结构或产品细节 | 不复制代码，除非后续许可与验证通过 |
| BLOCKED_LICENSE | 缺少许可证或授权不清楚 | 禁止复制、再发布或商业分发 |
| BLOCKED_COMPATIBILITY | 与 Expo / React Native 当前版本、架构或原生构建不兼容 | 不集成，除非有最小可行兼容方案和批准 |
| REJECTED | 安全、质量、维护、架构或数据边界无法接受 | 不使用 |

只有完成适用验证的具体文件/版本，才能标为 VERIFIED_SOURCE_CANDIDATE。不能把整个仓库因为一个组件通过验证就全部标记为成熟。

## 3. main 当前已经采用的依赖

这些依赖已经出现在当前 main 的 app/package.json，并由 app/bun.lockb 锁定。版本是当前仓库清单中的版本，不应通过本表随意升级。

| 能力 | 当前包 / 版本 | GitHub 来源 | 许可证证据 | LuckRead 使用证据 / 决策 |
|---|---|---|---|---|
| Expo 原生平台 | expo ~58.0.26 | https://github.com/expo/expo | 仓库 SPDX MIT | REUSE_IN_REPO；当前原生运行基线 |
| 路由 / 原生导航 | expo-router ~58.0.32、@react-navigation/bottom-tabs ^7.0.5、drawer ^7.0.0 | https://github.com/expo/expo、https://github.com/react-navigation/react-navigation | Expo MIT；React Navigation package LICENSE 为 MIT | REUSE_IN_REPO；沿用现有 Drawer / Tabs，不重建导航 |
| 高性能长列表 | @shopify/flash-list 2.3.2 | https://github.com/Shopify/flash-list | LICENSE.md 为 MIT | REUSE_IN_REPO；视频 Feed 和长列表优先复用 |
| 异步请求 / 缓存 / 分页 | @tanstack/react-query 5.105.3 | https://github.com/TanStack/query | LICENSE 为 MIT | REUSE_IN_REPO；feed-query、query-provider 和相关测试已存在 |
| 原生底部弹层 | @gorhom/bottom-sheet ^5 | https://github.com/gorhom/react-native-bottom-sheet | 上游 LICENSE 为 MIT | REUSE_IN_REPO；不另引入同类弹层系统 |
| 样式适配 | nativewind 4.2.7 | https://github.com/nativewind/nativewind | LICENSE 为 MIT | REUSE_IN_REPO；沿用当前样式体系，不创建第二套 CSS 系统 |
| 图片展示 | expo-image ~58.0.18 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；图片加载、缓存和预览优先使用 |
| 图片 / 视频选择 | expo-image-picker ~58.0.10 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；现有发布窗口媒体选择流程 |
| 相机拍摄 | expo-camera ~58.0.14 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；CameraCaptureModal 和 camera-capture 测试 |
| 视频播放 | expo-video ~58.0.14 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；视频 Feed 和预览 |
| 系统推送 | expo-notifications ~58.1.9 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；push-notifications.ts 和 push-notifications 测试 |
| 安全凭证 | expo-secure-store ~58.0.3 | https://github.com/expo/expo | Expo MIT | REUSE_IN_REPO；Session / installation data 安全存储 |
| UI primitives | 本仓库 app/components/ui | https://github.com/founded-labs/react-native-reusables | 上游和本仓库 app/components/ui/LICENSE.react-native-reusables.txt 均为 MIT | REUSE_IN_REPO；保留版权声明，只复用已落地 primitive |

### 3.1 当前 APP 依赖规则

- 新增通用库前，必须先检查上表和当前 app/package.json / app/bun.lockb。
- 不得在当前 SDK 58 基线上复制面向 Expo SDK 52 / RN 0.76 的旧组件后假定可运行。
- 依赖升级必须在独立 PR 中完成 Expo compatibility、Expo Doctor、TypeScript、Android / iOS 构建及受影响模块测试。
- 除非该库确实解决了现有依赖无法解决的问题，不得同时引入两个承担同一职责的列表、路由、状态管理、Query、图片或动画系统。
- 安装包存在不等于所有能力都已使用；必须找到源文件和实际调用链。

## 4. 已授权 X / Threads 参考仓库

以下仓库来自现有 LuckRead 前端复用范围。每个仓库的授权范围、许可证和平台适配必须逐文件确认。

| 仓库 | 上游证据（本次检查） | 决策 | 允许范围 / 禁止范围 |
|---|---|---|---|
| ccrsxx/twitter-clone | https://github.com/ccrsxx/twitter-clone；MIT LICENSE；README 描述 Next.js / TypeScript / Tailwind、帖子、媒体、互动、主页；README 自述项目已归档 | REFERENCE_ONLY（Web） | 可研究已采用的 Web 布局和交互；不可将 Firebase Auth、Firestore、Storage、云函数或 Web 专用依赖迁入 APP |
| jokerhutt/x-clone | https://github.com/jokerhutt/x-clone；README 描述 React / TypeScript / Tailwind、Feed、搜索、媒体、通知；README 明确非商业用途；未发现标准 LICENSE | BLOCKED_LICENSE | 可阅读公开说明作产品参考；未经明确书面授权及适用许可确认，不复制代码、不分发 |
| MkdirRaiden/twitter-clone-client | https://github.com/MkdirRaiden/twitter-clone-client；README 描述 React / Vite / Tailwind / React Query；未发现标准 LICENSE | BLOCKED_LICENSE / REFERENCE_ONLY | 只参考交互想法；不把小型 Demo 或 README 声明视为生产级实现，不复制代码 |
| Nash2610/X-Clone | https://github.com/Nash2610/X-Clone；MIT LICENSE；README 描述 HTML / Tailwind / Node；当前检查时上游最近推送较早 | REFERENCE_ONLY | 可参考静态结构；不作为原生 APP、实时消息、Feed 排序或支付系统的生产实现；如复制必须保留 MIT 声明 |
 
## 5. 已存在的隔离评估来源

| 来源 | 本仓库记录 | 状态 | 处理规则 |
|---|---|---|---|
| saulsharma/twitter-ui | app/UPSTREAM.md 记录导入 commit 2a8ae528012a888a0f5be99d006cdfa4ed3ae006，并明确为隔离评估副本 | BLOCKED_LICENSE / NOT_PRODUCTION | app/UPSTREAM.md 说明上游没有 LICENSE，且代码未接入 LuckRead Workers、账号、API 或生产部署；上游 README 同时标注仍有性能、认证 dummy values 和视频 autoplay TODO。不得把它作为生产代码源或再分发，除非先取得明确授权并重新审查 |
| 已有 Web 第三方组件 | 各组件目录中的 THIRD_PARTY_NOTICES 和许可证文件 | 按文件核对 | 继续保留已有声明，不将 Web 组件自动认定为 React Native 可用组件 |

## 6. 新 GitHub 代码来源的强制准入检查

任何新来源必须先登记以下信息，再决定是否复制：

1. **精确身份：** owner/repo、源分支、不可变 commit SHA、文件路径。
2. **许可证：** SPDX、LICENSE 文件、版权声明和 NOTICE；无许可证或授权不清楚即 BLOCKED_LICENSE。
3. **维护情况：** 最新提交时间、维护者活跃度、Issue / PR、归档状态、依赖升级频率。
4. **可运行性：** 按上游说明完成安装、启动和构建；不能只看截图。
5. **测试：** 找到并执行对应单测、集成测试、E2E 和 CI；如果没有测试，必须明确风险，不能叫“验证过的代码”。
6. **安全：** 依赖风险、明文密钥、认证、授权、隐私、日志、文件访问和供应链风险。
7. **平台兼容：** Expo SDK 58、React Native 0.88.1、React 19.3.0、Android / iOS 原生构建。
8. **架构兼容：** 只复用表现层或可证明通用的技术组件，不迁入上游账号、数据库、存储、支付或权限实现。
9. **最小移植：** 保留源组件结构和许可；只改 LuckRead 必需的 API adapter、DTO 转换、路由和样式适配。
10. **真实数据：** 使用 LuckRead W01 API、当前 Session 和真实权限，不使用上游假账号或 mock 数据代替验收。
11. **回归：** 执行受影响 APP 测试、Expo Doctor、TypeScript、Android / iOS 构建和真实设备流程。
12. **性能：** 列表虚拟化、首屏、图片、视频、内存和网络恢复不得出现明显回归。

### 6.1 “验证过的代码”最低标准

只有同时满足下列条件的具体代码版本才能标记 VERIFIED_SOURCE_CANDIDATE：

- 许可证或授权可用；
- 固定了精确 commit SHA；
- 上游目标功能实际运行；
- 相关自动化测试实际通过；
- LuckRead 目标 SDK 的平台构建通过；
- 仅复用必要代码，没有引入上游后端和第二数据源；
- LuckRead 真实 API、权限和设备测试通过；
- PR 有源文件、许可证和测试证据。

只通过上游 CI、只在 Web 运行成功或只在截图中展示，不代表已通过 LuckRead 原生集成验证。

## 7. 每次复用的 PR 登记模板

| 字段 | 必填内容 |
|---|---|
| Module ID | 对应功能追踪表模块编号 |
| Source repo | 上游 owner/repo |
| Source commit | 完整 commit SHA |
| Source path | 上游文件路径 |
| License / permission | SPDX、许可证路径或授权证据 |
| Target path | LuckRead 文件路径 |
| Dependencies | 新增或复用的锁定依赖 |
| Adaptation | 必要的 API / DTO / 路由 / 平台改造 |
| Removed upstream code | 明确剔除的认证、存储、支付、数据库和假数据逻辑 |
| Tests | 上游测试和 LuckRead 测试结果 |
| Platform build | Expo Doctor、Android、iOS 构建结果 |
| Device acceptance | 设备型号、系统版本、APP 构建和用户旅程证据 |
| Attribution | NOTICE / LICENSE / THIRD_PARTY_NOTICES 位置 |

## 8. 当前结论

- APP 已经拥有一批成熟的基础依赖，不应重新实现导航、长列表、图片、相机、视频、推送、底部弹层和请求缓存。
- 当前 X-clone 仓库不等于可复制的原生 APP。Web 源码必须先通过平台适配、许可证和真实构建验证。
- 无 LICENSE 的参考项目不能因为公开可见就复制。
- 本 PR 不新增 npm 依赖，不复制任何新的上游运行时代码。
- 每个后续模块在本登记表追加精确来源、commit、许可证、目标路径与验收证据。
