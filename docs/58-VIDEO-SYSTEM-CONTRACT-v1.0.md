# LuckRead Video System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Video 系统负责短视频、长视频、视频作品、播放体验与视频生命周期；媒体上传/转码由 Media 系统负责，Video 不拥有通用 Media 二进制存储权威。

## 2. 核心模型

```text
Video Work
→ Video Version
→ Media References
→ Processing
→ Moderation / Rights
→ Publish
→ Playback / Distribution
→ Analytics
```

## 3. 能力

- short video
- long video
- multi-part video
- cover/preview
- adaptive playback
- captions/subtitles
- audio track selection
- playback resume
- quality selection
- watch history
- replay/live linkage
- clips/derivative references
- scheduled publishing

## 4. Authority

Video Work 与 Video Version 由 Content/Video Domain 管理；Media 文件与 processing state 由 Media Domain 管理；播放统计属于 Event/Analytics 派生体系；Rights 由 Rights Domain 权威管理。

## 5. Playback

```text
Request
→ Auth / Entitlement
→ Content / Rights / Safety Eligibility
→ Playback Manifest
→ Adaptive Media Delivery
→ Interaction / Telemetry
```

不得因为缓存或 CDN 派生状态绕过权限、版权、下架和地域策略。

## 6. API

`/v1/videos`、`/v1/videos/{id}/playback`、`/v1/videos/{id}/progress`、`/v1/videos/{id}/clips`。

要求 requestId、cursor、idempotency、stable errors、entitlement checks、rate limits。

## 7. Event

覆盖 video.created、video.updated、video.published、video.started、video.completed、video.progressed、video.hidden、video.deleted、video.clip.created。

播放事件必须经过 Event Admission / Trust 后才能进入推荐、增长和商业分析。

## 8. Safety / Rights

播放前必须检查 visibility、moderation、copyright、region、account restriction、entitlement。版权限制必须有快速下线传播路径。

## 9. Reliability

支持弱网、自适应码率、播放失败重试、断点续播、媒体处理失败恢复、下架传播、回放状态恢复。播放遥测允许丢失/采样，但不能伪造为权威财务事实。

## 10. Cost / Performance

- CDN/object delivery 优先
- 热门 manifest/metadata 可缓存
- playback telemetry 异步聚合
- 禁止每次播放同步写主业务库
- p50/p95/p99 首帧与切换预算必须定义
- 大规模转码走任务队列

## 11. UX

覆盖加载、首帧、缓冲、切清晰度、全屏、横竖屏、字幕、断点续播、失败重试、删除/限制、网络切换、跨设备观看进度。

## 12. Acceptance

P0 验证短视频、长视频、播放、字幕、清晰度、进度同步、弱网恢复、权限/版权过滤、删除传播、播放事件幂等/聚合、处理失败恢复、跨设备续播。

## 13. STOP

- Video 复制 Media 权威状态
- 播放绕过 rights/safety
- 每次播放同步写业务数据库
- Raw telemetry 直接作为推荐事实
- 删除后仍稳定播放
- 无断点恢复
- 无 playback entitlement
- 无处理失败恢复

## 14. READY

Data/API/Event/Permission/Security/Rights/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 全链路证据完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
