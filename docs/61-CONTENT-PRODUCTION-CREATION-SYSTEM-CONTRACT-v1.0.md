# LuckRead Content Production / Creation System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Content Production 负责从创意到发布的生产工作流：编辑器、草稿、协作、素材、版本、预览、定时发布、修订和创作工具。它不是 Content 权威数据的替代品。

## 2. 核心链路

```text
Idea
→ Draft
→ Edit
→ Autosave
→ Validation
→ Preview
→ Moderation / Rights
→ Schedule / Publish
→ Revision
→ Analytics / Growth
```

## 3. 能力

- article/editor
- rich text / structured blocks
- media insertion
- autosave
- draft/version/revision
- collaborative editing boundary
- preview
- scheduled publishing
- rollback
- content templates
- series/chapter authoring
- localization/translation workflow
- creator tool integrations

## 4. Authority

Draft/Revision/Production Session 属于 Production Domain；已发布内容的最终权威属于 Content Domain；媒体属于 Media；作者身份属于 Creator；版权属于 Rights。

草稿不得默认进入公开搜索、推荐、Feed 或 Trending。

## 5. API

`/v1/production/drafts`、`/v1/production/revisions`、`/v1/production/preview`、`/v1/production/publish`。

必须支持 optimistic concurrency、revision id、idempotency、requestId、权限校验和稳定错误。

## 6. 版本与并发

每次可保存状态必须有版本号；冲突不能静默覆盖。支持恢复最近版本、历史版本和明确的 publish revision。

## 7. Event

`draft.created`、`draft.updated`、`revision.created`、`preview.created`、`publish.requested`、`publish.completed`、`publish.failed`。

事件消费必须幂等；autosave 不得造成无限事件/数据库写放大。

## 8. Security / Privacy

草稿属于私有工作空间；协作者只能访问被授予的资源；预览 token 必须短时、可撤销；发布动作必须重新验证权限和内容状态。

## 9. Performance / Cost

Autosave 使用 debounce/batch；大型编辑内容采用增量/版本策略；媒体上传与处理异步；预览结果可缓存；禁止每次键盘输入同步持久化。

## 10. Acceptance

P0 验证草稿、自动保存、刷新恢复、版本、冲突、预览、发布、定时发布、撤回/修订、权限隔离、媒体引用、失败恢复。

## 11. STOP

- 编辑器直接修改 Payload 内部实现
- 草稿默认公开
- 并发编辑静默覆盖
- 每次输入同步写主库
- 发布绕过 moderation/rights
- 无版本恢复
- 无权限隔离

## 12. READY

Data/API/Event/Permission/Security/Rights/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 全链路完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
