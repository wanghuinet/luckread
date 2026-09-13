# LuckRead Media / Media Processing System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Media 系统负责图片、视频、音频、漫画页、封面、附件等媒体资产的生命周期；Media Processing 负责上传、校验、转码、缩略图、封面、字幕/音轨等派生处理。

媒体二进制数据进入对象存储；结构化媒体元数据、权限与处理状态由 Media Domain 权威维护。

## 2. 核心链路

```text
Create Asset
→ Upload Intent
→ Authorized Upload
→ Integrity / Malware / Type Validation
→ Persist Media Metadata
→ Processing Task
→ Derived Outputs
→ Moderation / Rights
→ Ready / Failed
→ Content Reference
```

## 3. 能力边界

- image/video/audio/document upload
- multipart/resumable upload
- asset metadata
- thumbnail/preview/cover
- video transcoding and adaptive renditions
- audio encoding/waveform
- subtitle/closed-caption assets
- comic page ordering
- processing task/status/retry
- media replacement/versioning
- reference tracking
- deletion/retention
- rights metadata

## 4. Authority

Media Asset、Media Version、Processing Task、Media Reference 由 Media Domain 管理；原始/派生二进制进入 R2 或等价 object storage；Content/Creator/IP 只保存稳定引用，不复制媒体权威状态。

## 5. API

`/v1/media`、`/v1/media/uploads`、`/v1/media/tasks`。

必须支持 requestId、idempotency、cursor、stable errors、authorization、quota/rate limit。上传完成不能等价于媒体已可播放，客户端必须读取 processing state。

## 6. Event

至少覆盖 `media.upload.created`、`media.upload.completed`、`media.processing.started`、`media.processing.completed`、`media.processing.failed`、`media.moderation.pending`、`media.ready`、`media.deleted`。

消费者采用 at-least-once + idempotency；处理任务必须可重试、可重放、可审计。

## 7. Security / Rights

上传必须验证 actor、resource scope、content type、size/quota、malware/safety boundary；私有媒体必须使用受控访问。版权/授权状态不得被 Media 自行推断为最终权利事实。

## 8. Reliability

支持断点续传、失败恢复、重复完成请求、任务超时、部分处理失败、worker 重试、DLQ/quarantine、派生结果重建。任何处理任务不能导致原始资产丢失。

## 9. Performance / Cost

- 大文件采用 multipart/resumable upload
- 上传与处理异步化
- 派生文件按需生成
- 重复内容可采用受控去重，但不得破坏权威引用
- 热门缩略图/封面可缓存
- processing concurrency 必须受预算控制
- 大批量媒体处理使用 Task/Queue

## 10. UX

覆盖选择、上传中、暂停、继续、失败、处理中、审核中、完成、被拒、删除、弱网、跨设备继续编辑。用户工作不得因处理失败丢失。

## 11. Acceptance

P0 验证：图片/视频/音频上传、断点续传、重复提交、完整性校验、处理状态、失败重试、缩略图/转码、字幕、权限隔离、删除收敛、引用关系、任务恢复、跨设备状态。

## 12. STOP

- 媒体二进制进入关系型权威表作为主存储
- Content 复制 Media 权威状态
- 上传成功被误认为处理完成
- 无断点续传/失败恢复
- 处理任务不可重建
- 私有媒体可被越权读取
- 删除后派生资源无限期暴露
- 无 quota/rate limit
- 处理任务无幂等

## 13. READY

```text
Product Boundary → L1-L4 → Data → API → Event → Permission/Security
→ Rights/Privacy → Recovery → Test → Performance/Cost → Observability
→ CI Evidence → User Acceptance → READY
```

当前：**IMPLEMENTATION PENDING**。
