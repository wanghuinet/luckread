# LuckRead Novel / Comic / Drama / Series System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本系统负责长内容作品、漫画、剧集、系列和章节/集数组织，统一支撑 IP 化内容消费与创作者生产；不拥有通用 User、Media、Rights、Ledger 权威。

## 2. 统一模型

```text
IP / Creator
→ Work
→ Series / Season
→ Chapter / Episode
→ Media / Text Representation
→ Lifecycle
→ Distribution
```

小说以 Chapter 为核心；漫画以 Page/Chapter 为核心；剧集以 Episode/Season 为核心。

## 3. 能力

- work creation
- novel/chapter
- comic/chapter/page
- drama/series/season/episode
- serial publishing
- catalog/order
- cover/material
- draft/autosave
- scheduled publishing
- free/paid access boundary
- progress/bookmark
- recommendations and related works
- copyright/IP relation

## 4. Authority

Work/Series/Chapter/Episode metadata 由 Content/Long-form Content Domain 管理；媒体文件由 Media Domain 管理；作者身份由 Creator Domain；IP/rights 由 IP/Rights Domain；付费 entitlement 由 Membership/Commerce Domain。

## 5. API

`/v1/works`、`/v1/novels`、`/v1/comics`、`/v1/dramas`、`/v1/series`，统一 cursor、requestId、schemaVersion、stable errors、idempotency、visibility/entitlement checks。

## 6. Event

覆盖 work.created、chapter.created/published、episode.published、series.updated、content.hidden/deleted、progress.updated、entitlement.changed。

消费事件 at-least-once + deduplication；阅读进度等高频行为异步聚合。

## 7. UX

必须支持目录、章节阅读、漫画翻页、剧集播放、进度恢复、收藏/书架、更新提醒、付费/权益状态、删除/下架、弱网、跨设备继续。

## 8. Safety / Rights

章节/集数继承并受内容、版权、区域、审核和账号策略约束。衍生作品必须保留 provenance，不得未经授权建立可商业化关系。

## 9. Performance / Cost

正文/页面/视频引用与大媒体分离存储；章节读取支持缓存；长列表使用 cursor；阅读/观看行为不得逐次同步写主业务库；热门作品采用缓存与预聚合。

## 10. Acceptance

P0 验证作品创建、章节/页面/集数、排序、发布、草稿恢复、阅读/观看进度、权益、版权/审核、跨设备、删除传播、事件聚合、失败恢复。

## 11. STOP

- Work 复制 Creator/IP 权威
- Rights 被内容系统自行授权
- 付费权益绕过 Membership/Commerce
- 高频阅读进度同步写主库
- 删除/限制后仍稳定暴露
- 无 provenance
- 无目录/章节一致性规则

## 12. READY

Data/API/Event/Permission/Security/Rights/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
