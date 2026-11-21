# LuckRead 登录后图文动态与小视频发布体验契约 v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：P0 核心用户链路 / 主流 APP 级发布体验基线**

## 1. 目标

本契约定义用户完成登录后，从进入发布入口到图文动态、小视频最终发布并进入内容分发体系的完整体验。

目标不是实现“能上传一个文件”，而是形成接近主流内容平台的完整闭环：

```text
登录
→ 发布入口
→ 选择内容类型
→ 创作
→ 草稿保存
→ 素材上传/处理
→ 内容校验
→ 权限/风控/版权检查
→ 发布
→ 发布状态
→ 内容空间
→ Feed/详情页
→ 互动与分发
```

本契约要求：**用户不能因为网络异常、上传失败、处理延迟、审核状态变化或客户端退出而无故丢失创作内容。**

## 2. 产品体验基线

LuckRead 的发布体验应达到以下主流 APP 级基线：

1. 登录后可以快速发现发布入口。
2. 图文和小视频具有清晰、低摩擦的创作路径。
3. 创作过程中自动保存草稿。
4. 上传、处理、审核均有明确状态。
5. 长任务可以后台运行并恢复。
6. 弱网、断网、超时、应用退出后尽可能恢复工作。
7. 发布失败必须提供可恢复路径，而不是要求用户重新创作。
8. 发布成功后可以立即进入个人内容空间，并进入后续分发链路。
9. 内容编辑、权限、审核、版权等敏感状态必须有明确反馈。
10. 图文和视频发布体验必须共享统一的内容生命周期和事件模型。

## 3. 发布入口

登录用户的核心入口：

```text
Home
 └─ ＋ Create
     ├─ 图文动态
     ├─ 小视频
     └─ 后续扩展：直播 / 音频 / 文章 / 图集等
```

入口要求：

- 首页可发现；
- 不要求用户理解后端实现；
- 创建入口在移动端具有稳定触达位置；
- 从其他内容页进入创建时，应保留必要上下文；
- 未完成内容必须可回到草稿；
- 不得通过强制互动、虚假倒计时等方式诱导发布。

## 4. 图文动态体验

### 4.1 创作能力

P0：

- 文字编辑；
- 多图选择；
- 图片排序；
- 图片删除/替换；
- 图片与文字组合；
- @ 用户；
- 话题；
- 可见范围；
- 内容预览；
- 草稿自动保存。

P1：

- 地理位置；
- 富文本增强；
- AI 辅助创作；
- 翻译；
- 内容模板。

### 4.2 发布流程

```text
选择图文动态
→ 编辑
→ 自动保存草稿
→ 预览
→ 发布前校验
→ 权限/安全/版权检查
→ 提交发布
→ 发布处理中
→ 已发布 / 审核中 / 失败
```

## 5. 小视频体验

### 5.1 素材入口

支持：

- 相机拍摄；
- 相册选择；
- 单视频；
- 多段视频；
- 后续扩展多媒体混合创作。

### 5.2 基础编辑

P0：

- 裁剪；
- 删除片段；
- 封面选择；
- 标题/描述；
- @ 用户；
- 话题；
- 可见范围；
- 预览。

P1：

- 音乐/声音；
- 字幕；
- 文本/贴纸；
- 基础特效；
- 更完整的剪辑能力；
- AI 创作辅助。

### 5.3 视频发布流程

```text
选择/拍摄视频
→ 本地预览
→ 编辑
→ 保存草稿
→ 上传
→ 上传恢复
→ 媒体处理/转码
→ 封面/元数据校验
→ 权限/风控/版权检查
→ 发布
→ 播放页
→ Feed/推荐/搜索等后续分发
```

## 6. 草稿与工作保存

这是 P0，不允许作为后续优化项。

### 6.1 自动保存

系统至少保存：

- 草稿 ID；
- 作者 ID；
- 内容类型；
- 文本；
- 素材引用；
- 编辑状态；
- 可见范围；
- 最近保存时间；
- 客户端/设备上下文；
- 草稿版本。

### 6.2 恢复原则

```text
Create
→ Local Working State
→ Draft
→ Upload/Processing
→ Publish
```

客户端退出、页面刷新、网络断开或上传失败不得直接清空用户工作。

### 6.3 冲突

跨设备编辑发生版本冲突时：

- 不静默覆盖；
- 保留服务端版本；
- 保留本地未提交工作；
- 给用户明确恢复/选择路径。

## 7. 上传与长任务体验

所有媒体上传及处理均视为长任务，而非普通同步请求。

状态至少包括：

```text
CREATED
→ UPLOADING
→ UPLOAD_PAUSED
→ UPLOAD_FAILED
→ UPLOADED
→ PROCESSING
→ PROCESSING_FAILED
→ READY
→ PUBLISHING
→ PUBLISHED
```

终态/异常状态包括：

- CANCELLED
- REJECTED
- MODERATION_PENDING
- DELETED
- EXPIRED

用户必须能够看到当前状态以及下一步可执行操作。

## 8. 弱网与恢复

必须覆盖：

- Wi-Fi → 移动网络切换；
- 临时断网；
- 请求超时；
- 上传中断；
- Worker/服务暂时不可用；
- 客户端进入后台；
- 客户端重新启动；
- Token/session 过期；
- 重复提交。

恢复要求：

```text
失败
→ 保留工作
→ 判断可恢复状态
→ Retry / Resume
→ 继续原流程
```

不得要求用户重新选择已经成功上传的素材。

## 9. 发布状态

用户必须能区分：

- 草稿；
- 上传中；
- 处理中；
- 审核中；
- 发布成功；
- 发布失败；
- 被限制；
- 被删除；
- 权限不足；
- 版权冲突。

所有用户可见限制都应提供安全、可理解的原因和可执行的恢复/申诉路径，但不得暴露内部风控规则、模型细节或安全阈值。

## 10. 发布后的连续体验

发布成功不是终点。

```text
Publish
→ My Content
→ Content Detail
→ Feed Distribution
→ Search/Discovery
→ Follow/Interaction
→ Notification
→ Analytics/Growth
```

发布后必须：

- 能在个人内容空间找到；
- 能打开详情页；
- 能看到发布状态；
- 能进行允许的编辑/删除操作；
- 能进入评论、点赞、收藏、分享等互动；
- 后续进入推荐/搜索等派生分发系统。

## 11. 内容生命周期

图文和视频统一使用内容生命周期：

```text
DRAFT
→ REVIEW
→ SCHEDULED
→ PUBLISHED
→ ARCHIVED
```

异常路径：

```text
SCHEDULED → FAILED
PUBLISHED → HIDDEN → RESTORED
DRAFT/ARCHIVED → DELETED
```

媒体处理状态不得与内容生命周期混为一个状态字段；上传/转码属于媒体任务状态，发布属于内容生命周期。

## 12. 权限、隐私、安全与版权

发布前必须校验：

- 当前用户身份；
- 内容所有权；
- 可见范围；
- 被 @ 用户关系；
- 社交/封禁状态；
- 内容安全；
- 媒体安全；
- 版权/授权；
- 区域策略；
- 平台规则。

高风险内容不得绕过审核直接进入公开分发。

## 13. 高并发与成本原则

发布链路不得把所有动作设计成同步数据库写入。

推荐边界：

```text
User Intent
→ API
→ Authoritative Content State
→ Domain Event
→ Async Processing
→ Derived State / Distribution
```

高频派生行为，例如曝光、播放、互动等，不得直接成为推荐的可信原始事实，应经过事件准入、风险/信任处理和聚合。

媒体大对象进入对象存储；结构化权威元数据进入数据库；缓存、队列和派生状态不得成为未经批准的权威事实。

## 14. API / Event 契约要求

发布能力必须拥有稳定的应用 API，不得向客户端暴露 Payload 内部实现。

最低能力：

- create draft；
- update draft；
- get draft；
- list drafts；
- upload session；
- resume upload；
- submit publish；
- get publish status；
- update published content；
- delete content；
- get my content。

事件至少覆盖：

- draft.created；
- draft.updated；
- media.uploaded；
- media.processing.completed；
- media.processing.failed；
- content.submitted；
- content.moderation.pending；
- content.published；
- content.rejected；
- content.hidden；
- content.deleted。

所有命令必须定义幂等键/重复提交行为。

## 15. UX 状态机

统一状态：

```text
Initial
→ Editing
→ Saving
→ Saved
→ Uploading
→ Processing
→ Publishing
→ Success
```

异常状态：

```text
Offline
Timeout
Conflict
Unauthorized
Forbidden
UploadFailed
ProcessingFailed
ModerationPending
Rejected
Deleted
Restricted
Expired
```

每个异常状态必须至少提供：

1. 当前发生了什么；
2. 用户的工作是否安全；
3. 下一步能做什么；
4. 是否可以重试/恢复。

## 16. 幂等与重复提交

以下操作必须具备幂等语义：

- 创建草稿；
- 保存草稿；
- 创建上传会话；
- 完成上传；
- 提交发布；
- 删除/隐藏内容；
- 修改内容权限。

用户连续点击“发布”不得产生多个相同内容。

## 17. 可访问性与性能

P0 发布链路必须支持：

- 清晰的控件语义；
- 键盘/辅助技术可访问的 Web 体验；
- 非颜色单独表达状态；
- 可读的错误信息；
- 字体缩放；
- 合理触控区域；
- 视频字幕/文本替代能力的架构预留。

性能原则：

- 快速打开创作壳；
- 素材选择后立即给本地反馈；
- 上传与界面操作解耦；
- 长任务后台化；
- 合理预取；
- 不因后台处理阻塞用户继续浏览；
- 发布成功后快速返回可用内容状态。

## 18. 验收用例

### P0-POST-01 登录后发现发布入口

登录成功后，用户可以在合理路径内发现创建入口。

### P0-POST-02 发布图文

用户可以完成文字+多图创建、预览、发布，并在个人内容空间看到结果。

### P0-POST-03 发布小视频

用户可以从相册/拍摄进入视频创作，完成基础编辑、上传、处理、发布和播放。

### P0-POST-04 草稿恢复

退出页面/重启客户端后，未完成工作仍可恢复。

### P0-POST-05 弱网恢复

上传过程中断网，恢复网络后可以继续，不要求重新选择已完成素材。

### P0-POST-06 重复发布

连续点击发布不会产生重复内容。

### P0-POST-07 处理失败

视频转码失败时，用户看到明确失败状态，并可以重新处理或重新上传。

### P0-POST-08 审核状态

内容进入审核时，用户可以看到审核中状态；拒绝时可以看到安全的原因及可用申诉路径。

### P0-POST-09 发布后闭环

发布成功后可以进入详情、个人内容空间，并参与后续互动/分发。

### P0-POST-10 跨设备恢复

同一账户在另一设备可以继续未完成草稿，发生冲突时不得静默覆盖。

### P0-POST-11 权限/版权

无权发布或版权状态不满足条件时，发布被安全阻断且用户得到可理解反馈。

### P0-POST-12 数据一致性

内容权威状态、媒体处理状态、审核状态、派生 Feed 状态之间必须具有明确一致性和恢复规则。

## 19. 与现有能力层级的映射

本能力属于现有内容生产与发布体系，不新增新的顶层 L1。

主要映射：

```text
L1 Content
├─ Content Production
├─ Content
├─ Content Relations
└─ Media / Media Processing

L1 User Identity
L1 Safety / Risk / Trust
L1 Content Moderation / Appeals
L1 Copyright / Rights
L1 Personal Content Space
L1 Feed / Distribution
L1 Notification
L1 Analytics / Growth
```

UX 主链路映射：

```text
J02 Authentication / Session
→ J13 Personal Space
→ J15 Creation / Draft / Publish
→ J06 Content Consumption
→ J04 Home / Feed
→ J11 Social Interaction
→ J16 Creator Studio
```

## 20. Implementation Admission

本能力进入代码实施前必须完成：

```text
Capability Mapping
→ L3/L4 Mapping
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security Contract
→ Privacy/Rights Contract
→ Cost/Runtime Review
→ UX State Machine
→ Failure/Recovery Contract
→ Test/Acceptance Contract
→ READY
```

不得因为“先把上传做出来”而跳过上述准入条件。

## 21. 禁止项

以下实现方式禁止：

- 修改 Payload Core；
- 将 Payload 内部结构直接暴露给客户端；
- 用单个同步请求完成整个视频上传/处理/发布生命周期；
- 丢弃未完成草稿；
- 失败后要求用户重新创作；
- 把高频互动直接写成推荐可信事实；
- 用缓存作为未经批准的权威内容状态；
- 未定义幂等语义就允许重复发布；
- 没有状态反馈的后台长任务；
- 静默覆盖跨设备编辑；
- 未经版权/权限检查直接公开分发；
- 用 UX 需求偷偷新增未审核的 L1/L2 能力。

## 22. 完成定义

只有同时满足以下条件，才能将“登录后图文/小视频发布体验”标记为 DONE：

1. Data Contract PASS；
2. API Contract PASS；
3. Event Contract PASS；
4. Permission/Security PASS；
5. Privacy/Rights PASS；
6. Draft/Recovery PASS；
7. Upload/Processing PASS；
8. UX Journey PASS；
9. Local Test PASS；
10. CI PASS；
11. 弱网/失败恢复测试 PASS；
12. 重复提交/幂等测试 PASS；
13. 移动端/H5 验收 PASS；
14. 用户接受验收 PASS。

在上述条件全部满足前，状态只能保持 **IMPLEMENTATION PENDING / IN IMPLEMENTATION / CI PENDING / USER ACCEPTANCE PENDING** 等中间状态，不得宣称“已经达到百度 APP 级体验”。
