# LuckRead APP 发布窗口 1.0 Beta 范围冻结与收口验收 v1.0

- 状态：`SCOPE_FROZEN / ENGINEERING_CLOSURE_IN_PROGRESS / RELEASE_NOT_GREEN`
- 适用范围：LuckRead Expo / React Native APP 的普通动态发布窗口
- 依据：`docs/1.0-RELEASE-SCOPE-v1.0.md`、`contracts/frontend/LUCKREAD-APP-X-THREADS-EXPERIENCE-IMPLEMENTATION-CONTRACT.v1.0.md`
- 基线 main：`1581d536cd5fbbc301113d5af7b38868c074f002`
- 本文件不是全平台 LuckRead 1.0 完整发布声明，也不替代 MEDIA、CONTENT、W01/W03/W05/W08 的权威契约和 Evidence Registry。

---

## 1. 冻结决策：1.0 与 2.0 边界

### 1.0 APP 发布窗口必须具备

1. 普通文字动态发布、文字计数、@mention、#hashtag。
2. 图片多选、预览、删除、排序、图片替代文本和图片封面选择。
3. 本地 GIF 选择、预览/保留动画并发布；不要求在发布窗口内提供 GIF 搜索服务。
4. 视频选择、预览、上传、服务端播放授权和失败文件重试。
5. 媒体上传进度、稳定幂等键、重复请求防重和发布前媒体就绪检查。
6. 草稿自动保存、恢复、分页列表和删除。
7. 已发布普通动态的原地编辑与删除。
8. 定时发布、定时列表、改期和取消。
9. 投票创建、投票、结果和到期规则；允许投票与定时发布组合。
10. 回复范围、公开/会员可见模式和创作者选择的敏感媒体警告。
11. 发布成功后可以从权威 API 重新读取内容，Feed / 详情媒体可见且权限正确。
12. APP 仅经 W01 公开 API 操作；H5 / PC 与 APP 共享权威内容和媒体事实。

### 2.0 高级创作能力（本次不作为 1.0 阻塞项）

- 多帖线程编辑器：子帖增删、排序、分段发布、部分成功恢复和线程草稿。
- 高级引用转发编辑器：原帖预览、附加评论/媒体及完整引用关系。
- GIF 搜索/素材库及授权来源接入。
- 视频剪辑、裁剪、字幕编辑、封面帧抽取和多轨编辑。
- 撤销发送倒计时。
- 高级链接卡片预览和编辑。
- 已发布内容的编辑历史/版本对比 UI。
- 其他需要独立服务/API 或复杂媒体处理链的高级创作工具。

以上拆分只调整 APP 发布窗口的产品交付顺序，不代表删除 Blueprint 功能，也不放宽现行后端授权、内容所有权或媒体安全契约。

---

## 2. 当前实现矩阵（按基线源码与开放 PR 核对）

| 能力 | 当前代码事实 | 状态 / 证据 |
|---|---|---|
| 普通文字动态 | 原生发布页存在正文编辑、500 字客户端上限、发布/编辑路径 | `CODE_PRESENT`；500 字是 LuckRead 当前实现，不宣称等同 X 的 280 字规则 |
| @mention / #hashtag | 光标处 token 提示、插入；发布后经 W01/W05 同步社交 token | `CODE_PRESENT`；回归测试在 `app/tests/publish-flow.test.mjs` |
| 图片选择与整理 | 多选、预览、删除、拖动/排序、图片封面、alt text | `CODE_PRESENT`；复用 Expo Image Picker、Image Manipulator 和 Sortables |
| 图片优化 | 对受支持的大图做尺寸/压缩优化；GIF、WebP、AVIF、SVG 和未知格式不重编码 | `CODE_PRESENT`；原图作为优化失败回退 |
| GIF 基础发布 | 本地选择，禁用编辑/重编码以保留动画；恢复时识别 GIF MIME | `CODE_PRESENT`；GIF 搜索属于 2.0 |
| 视频基础发布 | 相册视频选择、单视频限制、最多四个媒体项、发布前 Expo Video 预览 | `CODE_PRESENT`；当前选择器限制 60 秒 |
| 视频上传和播放授权 | 使用现有 `POST /v1/media`，成功后通过 `GET /v1/media/:mediaId/playback` 获取播放地址 | `CODE_PRESENT`；W01/Payload/R2 是现有边界 |
| 上传幂等与整文件重试 | 每个文件持有上传 key 和 fingerprint；相同文件重试复用幂等键；播放授权失败时保留已上传媒体，不重复上传 | `CODE_PRESENT`；W01 媒体记录有唯一幂等键约束 |
| 上传百分比进度 | 已在 PR #1549 实现 opt-in XHR multipart progress、字节数/百分比及无障碍进度条 | `PR_OPEN`；CI 修复后重新验证中，尚未合入 main |
| 字节级断点续传/进程重启恢复 | 当前是单次 multipart 请求；整文件重试不等于 chunk/session 级续传，APP 进程结束后也未证明可恢复上传 | `BLOCKED_NOT_IMPLEMENTED`；见第 3 节 |
| 草稿自动保存 | 服务端 DRAFT、1.8 秒 debounce、最小写入间隔、草稿指纹、退出/发布前 flush | `CODE_PRESENT` |
| 草稿箱 | 所有者范围列表、分页、恢复和 ETag 删除 | `CODE_PRESENT` |
| 原地编辑/删除 | ETag/If-Match 编辑、所有者校验、现有内容状态转换与删除流程 | `CODE_PRESENT`；仅核实普通 post 编辑路径，不把高级版本历史算作已交付 |
| 定时发布 | 原生日期时间选择、服务端 SCHEDULED 生命周期、列表/改期/取消；W03/W08 权限和发布边界 | `CODE_PRESENT`；真实调度运行仍需环境验收 |
| 投票 | 2–4 个选项、单项 50 字、5 分钟至 7 天、W05 投票权威和一人一票 | `CODE_PRESENT` |
| 定时动态 + 投票 | 先保存 DRAFT、再配置 W05 投票、最后 W03 转 SCHEDULED | `PR_OPEN` #1548；适用 CI 已通过，尚未合入 main |
| 回复范围 / 会员可见 | 回复受众策略读写与恢复；PUBLIC / MEMBERS_ONLY 访问模式 | `CODE_PRESENT`；最终权限仍由服务端执行 |
| 敏感媒体警告 | 创建者设置标签，内容读取按权限隐藏/揭示，确认状态按媒体/帖子范围管理 | `CODE_PRESENT`；相关基础改动已由 PR #1547 合入 main |
| 三端 API 边界 | APP 使用统一 API client；W01 对外，W03 内容生命周期，W05 投票/社交，W08 授权；前端不直连 D1/R2 | `CONTRACT_CHECKED`；不能仅由契约检查推导生产运行成功 |

### 2.1 开放 PR 状态快照

- PR #1548 — [支持定时发布动态同时创建投票](https://github.com/wanghuinet/luckread/pull/1548)：开放、可合并；当前适用结构/安全/APP-H5-PC 契约和 Native App CI 已通过；Android Debug 与 iOS Simulator 构建按既定策略跳过。
- PR #1549 — [发布窗口显示真实媒体上传进度](https://github.com/wanghuinet/luckread/pull/1549)：开放、可合并；上一轮发现的失败是过时的源码断言，已更新；更新后的 Native App CI 正在执行，不能提前标记全绿。
- 未经负责人明确指示，不合并 PR、不关闭 PR、不部署生产，也不重跑已经成功的工作流。

---

## 3. 媒体恢复：必须区分“重试”和“断点续传”

当前 APP 媒体写入使用统一 `apiRequest` 和 W01 `POST /v1/media`。W01 入口把单个 multipart 请求交给现有 Payload Media + R2 处理，并用 `Idempotency-Key`、上传 fingerprint 和唯一媒体记录处理重复请求。

现有能力可以安全地**重试同一文件的完整上传请求**，并避免同一逻辑请求创建重复媒体记录；这不提供已上传字节偏移量、分块 session、分块校验/合并，也不证明进程终止后能够从上次字节位置恢复。

仓库中的 `contracts/alignment/mapping-batches/MEDIA-001-015-real-evidence-reconciliation.v1.md` 当前明确标记 `BLOCKED_NOT_GREEN`、`Implementation authorization: false`；其中 MEDIA-002 的上传/断点续传 API、multipart/session 生命周期、完整性校验和恢复语义均未完成证据映射。

因此：
- PR #1549 只补上传进度，不得宣传为断点续传。
- 不得仅因存在 Payload、R2、单次上传和幂等键，就宣称 MEDIA-002 已 GREEN。
- 若 1.0 发布要求必须覆盖 MEDIA-002 字节级断点续传，先完成正式的 Mapping / Contract / Evidence 准入和架构审查，再实现最小兼容方案；不得绕过当前阻塞记录，自行增加 Worker、D1、Queue、Service Binding 或新的媒体权威。
- 若产品决定将字节级断点续传从 APP 1.0 发布窗口排除，必须通过正式范围变更记录；本文件不擅自把该功能改为非必需。

---

## 4. 1.0 发布窗口剩余门禁

以下事项未取得足够证据前，发布窗口总状态保持 `RELEASE_NOT_GREEN`：

| 门禁 | 必须获得的证据 | 当前状态 |
|---|---|---|
| PR 合入 | #1548、#1549 经检查后按负责人指示合入；确认 main 新 SHA | `NOT_MERGED` |
| CI | Native App CI、Mapping、Security、APP/H5/PC contract 和受影响测试通过 | #1548 已通过；#1549 更新后 CI 待完成 |
| 上传失败/重复保护 | 真正的上传响应丢失、超时、503 后重试同一文件；确认同 key 同 fingerprint 不重复建媒体 | 已有自动化测试；生产环境验证 `NOT_VERIFIED` |
| 媒体授权 | 上传者可读/播放；非所有者、匿名、会员无权限场景按策略拒绝；删除后资源不可访问 | 有 W01 集成测试与运行脚本；本轮无生产运行结果 |
| 发布闭环 | 创建 → 媒体引用 → 发布状态提交 → Feed/详情重新读取 → 编辑/删除 | 自动化部分覆盖；指定验收环境 E2E `NOT_VERIFIED` |
| 定时发布 | 实际到点执行、权限复核、失败/重试/取消，以及定时投票有效期从实际发布时间开始 | 代码与 CI 覆盖；目标环境运行 `NOT_VERIFIED` |
| APP/H5/PC 一致性 | 三端从同一 W01 权威 API 读取同一内容 ID、状态和媒体引用 | 契约检查通过；完整跨端运行验收 `NOT_VERIFIED` |
| Android / iOS 设备 | 真实设备安装目标 SHA 构建；完成图/视频上传、失败重试、发布、查看和编辑；保存设备/系统/构建/录屏证据 | `NOT_VERIFIED`；CI 原生构建本次按策略跳过 |
| 媒体正式能力门禁 | MEDIA-001/002 等正式映射、API/DTO/持久化/安全/生命周期/测试/Evidence 关闭 | `BLOCKED_NOT_GREEN` |

### 4.1 真机验收用例（必须实际执行）

1. Android 和 iOS 分别登录创作者账号，发布纯文字动态；重新进入 Feed 与详情，确认同一内容 ID。
2. 发布多图动态：排序、封面、alt text；非所有者不得编辑媒体或将他人媒体引用到帖子。
3. 发布本地 GIF，确认服务端文件和 APP/H5/PC 展示仍保留动画。
4. 发布视频：检查上传进度、网络中断后整文件重试、上传成功后播放授权和详情播放。
5. 在上传期间切后台/终止 APP 并重启，记录上传状态是否丢失；不得假设当前支持断点恢复。
6. 在相同幂等请求发生响应超时后重试，确认不会创建重复媒体或重复帖子。
7. 保存草稿、杀进程、重开草稿箱并恢复；确认正文、媒体引用、投票和权限字段不丢失（未完成上传的本地文件另行记录）。
8. 立即发布、定时发布、修改定时、取消定时；验证 W03 状态和发布后的权威 Feed 读取。
9. 发布投票，换另一个账号投票；检查一人一票、结果、到期，以及定时投票的时间基准。
10. 测试公开/会员可见、回复范围和敏感媒体隐藏/揭示；确认客户端无法越权读取。
11. 分别从 H5、PC 读取 APP 创建内容，检查内容 ID、作者、状态、正文、媒体、投票和权限一致。
12. 检查弱网、离线、401、403、409、422、429、5xx 和删除后重新读取；不能出现假成功、白屏或失去可恢复输入。

---

## 5. 架构边界和非目标

- 不新增 Worker、D1、Queue、Service Binding 或第二套领域 API。
- 不修改 Payload Core，不将 APP 发布功能改为客户端直连 Payload CRUD。
- 不把媒体字节写入 D1；媒体文件沿现有 Payload Media + R2 路径。
- W03 是内容和发布状态权威；W05 是投票/社交权威；W08 执行授权；W01 是公开 API 边界。
- 不在本轮实现线程编辑器、引用编辑器、GIF 搜索、视频编辑、字幕、撤销发送或编辑历史。
- 不把 CI 跳过的 Android/iOS 构建写为构建通过，也不把 PR_OPEN 写成代码已进入 main。
- 本文件冻结发布窗口范围和验收证据，不授予任何绕过 Mapping/Evidence 的实现权限。

---

## 6. 最终状态定义

只有以下条件全部满足，才可把 APP 发布窗口标记为 `APP_PUBLISH_1.0_ACCEPTED`：

```
1.0 scope frozen
  → 1.0 code in main
  → required CI green
  → MEDIA-002 / relevant contracts admitted and closed or formally scoped out
  → Android + iOS device journeys accepted
  → APP/H5/PC runtime consistency verified
  → publish/media/schedule/poll E2E evidence recorded
  → deployment provenance matches the accepted SHA
```

在这些条件满足前，准确状态为：**基础发布窗口功能已大体具备，代码收口进行中，正式发布验收未通过**。
