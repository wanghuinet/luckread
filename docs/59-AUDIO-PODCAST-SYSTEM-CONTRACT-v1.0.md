# LuckRead Audio / Podcast System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Audio / Podcast 负责音频作品、Podcast Show、Episode、播放、订阅、章节和音频内容分发。音频二进制与转码属于 Media Domain。

## 2. 模型

```text
Podcast Show
→ Season / Series
→ Episode
→ Media Version
→ Publish
→ Playback / Subscription
```

普通音频作品也可直接关联 Creator、Content、IP。

## 3. 能力

- Podcast show/episode
- audio work
- cover
- chapters
- transcripts/captions
- upload/process
- playback progress
- speed control
- queue
- subscription/follow
- scheduled publish
- replay/archive
- creator analytics

## 4. Authority

Show/Episode/Content 由对应 Content/Podcast Domain 管理；音频文件由 Media Domain 管理；订阅由 Social/Audience Domain 管理；播放行为属于 Event/Analytics；版权由 Rights Domain 管理。

## 5. API

`/v1/podcasts`、`/v1/audio`、`/v1/audio/{id}/playback`、`/v1/podcasts/{id}/subscribe`。

必须支持 cursor、idempotency、requestId、entitlement/privacy/safety checks、stable errors。

## 6. Event

至少覆盖 podcast.created、episode.published、episode.updated、audio.play.started、audio.play.completed、audio.progressed、subscription.changed。

播放事件采用 at-least-once 消费和聚合；不得逐条同步写推荐权威状态。

## 7. Safety / Rights

必须支持内容可见性、版权、区域限制、下架、审核状态和受限账号；派生缓存不得绕过这些条件。

## 8. Reliability / UX

支持弱网、播放失败重试、断点续播、进度跨设备同步、处理失败恢复、删除/限制状态收敛。

## 9. Performance / Cost

音频使用 object/CDN delivery；热门节目 metadata/cover 可缓存；播放进度和 telemetry 采用异步/聚合策略；批量音频处理走 Task/Queue。

## 10. Acceptance

P0 验证 show/episode、上传处理、播放、进度、章节、订阅、跨设备、弱网恢复、版权/审核、删除传播、事件聚合、失败恢复。

## 11. STOP

- Podcast 复制 Content/Creator 权威
- 音频二进制作为 D1 主存储
- 播放绕过 Rights/Safety
- 高频播放同步写业务库
- 无跨设备进度规则
- 无处理失败恢复
- 无删除/下架传播

## 12. READY

Data/API/Event/Permission/Security/Rights/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 全链路完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
