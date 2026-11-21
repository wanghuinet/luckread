# LuckRead 完整性矩阵 / 反向覆盖审计 v1.0

**Status:** P0
**Purpose:** 验证 `Feature × Domain × Entity × API × Permission × State × Event × Audit × Test` 无缺口。
**判定：** 任一实体出现 ❌ 即为 **开发准入阻断项**。

---

## 1. 实体全覆盖矩阵

图例：✅ 已定义 / ⚠️ 部分或需补 / ❌ 缺失

| 实体 | 域 | 数据模型 | 状态机 | API | 权限 | 事件 | 审计 | 生命周期/删除 | 测试要求 |
|---|---|---|---|---|---|---|---|---|---|
| **User / Account** | D1-01 | ✅ `303` | ✅ `303`+`contracts` | ✅ `/users/me` | ✅ `301` | ✅ | ✅ | ✅ `306` | ✅ |
| **Identity / Credential** | D1-01 | ✅ `303` §3 | ⚠️ 无独立状态机 | ⚠️ 仅经 `/auth/*` | ✅ | ✅ | ✅ | ✅ L4 立即删除 | ⚠️ |
| **Session** | D1-01 | ✅ `303` §3 | ⚠️ | ⚠️ 登出已定义 | ✅ | ✅ | ✅ | ✅ L4 | ⚠️ |
| **Role / RoleAssignment** | D1-01 | ✅ `301` | ⚠️ 无版本状态机 | ⚠️ 仅 admin | ✅ | ✅ | ✅ | N/A | ⚠️ |
| **Entitlement** | D1-01 | ✅ `303` §1 | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | N/A | ⚠️ |
| **Subscription** | D1-01 | ✅ `108-115` | ✅ | ⚠️ **未进 OpenAPI** | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Organization** | D1-01 | ✅ `304` §2 | ✅ `304` | ✅ `/organizations` | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| **OrgMembership** | D1-01 | ✅ `304` | ✅ `304` | ⚠️ 未独立暴露 | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| **Creator** | D1-01 | ✅ `76-83` | ✅ | ✅ `/creators/me` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **IP** | D1-01 | ✅ `304` §3 | ✅ `304` | ✅ `/ips` | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| **IPMember** | D1-01 | ✅ `304` | ✅ | ✅ `/ips/{id}/members` | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| **Content**（Article/Gallery/Video/Audio/Live/Short） | D1-02 | ✅ `10` | ✅ `contracts` | ✅ `/contents` | ✅ | ✅ | ✅ | ✅ `306` | ⚠️ |
| **Revision** | D1-02 | ✅ `10` §4 | ⚠️ | ⚠️ **无 API** | ✅ | ⚠️ | ✅ | ✅ | ❌ |
| **Media** | D1-02 | ✅ `57` | ✅ `contracts` | ✅ `/media` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Comment** | D1-02 | ✅ | ✅ `contracts` | ✅ | ✅ | ⚠️ | ✅ | ✅ `306` | ⚠️ |
| **Like / Favorite** | D1-02 | ✅ | ⚠️ 自然幂等 | ✅ `/interactions/likes` | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| **Follow** | D1-02 | ✅ | ⚠️ 自然幂等 | ✅ `/social/follows` | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| **Block / Mute** | D1-02 | ✅ | ⚠️ | ⚠️ **无 API** | ✅ | ⚠️ | ⚠️ | ✅ L4 | ❌ |
| **Share** | D1-02 | ✅ | N/A | ⚠️ **无 API** | ✅ | ⚠️ | ⚠️ | N/A | ❌ |
| **Feed** | 派生 | ✅ `12/55` | N/A | ✅ `/feed` | ✅ | N/A | ⚠️ | ✅ 移除 | ⚠️ |
| **Search Index** | 派生 | ✅ `53` | ⚠️ | ✅ `/search` | ✅ | N/A | ⚠️ | ✅ 移除 | ⚠️ |
| **Notification** | D1-03 | ✅ `56` | ⚠️ 读/未读 | ✅ `/notifications` | ✅ | ✅ | ⚠️ | ✅ L4 | ⚠️ |
| **ModerationCase** | D1-03 | ✅ `63` | ✅ `contracts` | ✅ `/admin/moderation/cases` | ✅ | ✅ | ✅ | ✅ 保留 | ⚠️ |
| **Report / Appeal** | D1-03 | ✅ `63` | ✅ | ⚠️ **无 API** | ✅ | ✅ | ✅ | ✅ 保留 | ❌ |
| **AuditEvent** | D1-03 | ✅ `contracts/audit-event.json` | N/A | ⚠️ 仅 admin | ✅ | N/A | N/A | ✅ 不可删 | ⚠️ |
| **Job** | D1-03 | ✅ `165` | ⚠️ | ⚠️ 仅内部 | ✅ | ✅ | ✅ | N/A | ⚠️ |
| **IdempotencyRecord** | D1-03 | ✅ `305` | ⚠️ | N/A | N/A | N/A | ⚠️ | ✅ 24h | ⚠️ |
| **FeatureFlag** | D1-03 | ✅ `175` | ⚠️ | ⚠️ 仅 admin | ✅ | ⚠️ | ✅ | N/A | ⚠️ |

---

## 2. 反向覆盖缺口（APP 功能 → API）

> 规则：**禁止**「后台有功能但 APP API 没有」「数据库有字段但 API 无 Contract」。

| # | 缺口 | 影响 | 优先级 | 修复 |
|---|---|---|---|---|
| **RC-01** | **Block / Mute 无 APP API** | 用户无法拉黑/静音，核心社交安全功能缺失 | **P0** | 补 `/social/blocks`、`/social/mutes` |
| **RC-02** | **Report / Appeal 无 APP API** | 用户无法举报与申诉 | **P0** | 补 `/reports`、`/appeals` |
| **RC-03** | **Revision 无 API** | 草稿版本/回滚功能无法实现 | **P0** | 补 `/contents/{id}/revisions` |
| **RC-04** | **Share 无 API** | 分享与分享计数无法实现 | **P1** | 补 `/contents/{id}/share` |
| **RC-05** | **Subscription 未进 OpenAPI** | 会员/订阅流程无契约 | **P1** | 补 `/subscriptions` |
| **RC-06** | **Entitlement 查询无 API** | 客户端无法判断权益 | **P1** | 补 `/users/me/entitlements` |
| **RC-07** | **Organization 成员管理无独立 API** | 组织后台无契约 | **P1** | 补 `/organizations/{id}/members` |
| **RC-08** | **IP 内容归属查询无 API** | IP 主页无法实现 | **P1** | 补 `/ips/{id}/contents` |
| **RC-09** | Feed 各类型（creator/ip/topic/hot）参数已定义但无独立校验文档 | 排序与去重语义未契约 | **P1** | 补 Feed 排序/去重契约 |
| **RC-10** | Search 索引延迟未定义系统行为 | 已发布但未同步时表现不明 | **P0** | 见 §3 |

---

## 3. 搜索索引延迟契约（补齐 RC-10）

**问题：** Content 已 `PUBLISHED` 但 Search 尚未同步时，系统应如何表现？

**裁决：**

| 场景 | 行为 |
|---|---|
| 作者本人查询自己的内容 | **必须可见**（读权威源，不依赖索引） |
| 其他用户搜索 | 可能暂不可见，**允许**最终一致 |
| 索引延迟 SLO | P95 ≤ 30s，P99 ≤ 5min |
| 索引失败 | 进 DLQ + W08 重放（`docs/163`） |
| 内容下线/删除 → 索引移除 | **≤ 5 min**（比入索引更严格，防止违规内容扩散） |
| Feed 同理 | 作者本人可见，他人最终一致 |

**强制：** 「我的内容」类查询**必须**读权威源或带 read-your-writes 保证，**禁止**走最终一致索引。

---

## 4. 状态机矩阵汇总

| 实体 | 状态机定义位置 | 状态数 | 终态 | 需乐观锁 |
|---|---|---|---|---|
| User / Account | `303` §2 + `contracts/state-machines/account.json` | 12 | `DELETED` | ✅ |
| Content | `contracts/state-machines/content.json` | 10 | `DELETED` | ✅ |
| Comment | `contracts/enums/comment-state.json` | 8 | `DELETED` | ⚠️ |
| Media | `contracts/enums/media-state.json` | 8 | `DELETED` | ⚠️ |
| Organization | `304` §2.2 + enum | 6 | `DISSOLVED` | ✅ |
| OrgMembership | `304` §2.3 + enum | 6 | `REMOVED`/`LEFT` | ✅ |
| IP | `304` §3.3 + enum | 7 | `DISSOLVED` | ✅ |
| ModerationCase | `contracts/enums/moderation-case-state.json` | 9 | `CLOSED` | ✅ |
| Subscription | `108-115` | — | — | ⚠️ **需补** |
| Job | `165` | — | — | ⚠️ **需补** |

**缺口：** Subscription 与 Job 的**机器可读**状态机缺失 → 需补 `contracts/state-machines/`。

---

## 5. 事件矩阵缺口

| 事件 | 定义 | 状态 |
|---|---|---|
| `identity.account_state_changed` | `303` §2.4 | ✅ |
| `content.published` / `unpublished` / `deleted` / `restored` | `contracts/state-machines/content.json` | ✅ |
| `content.approved` / `rejected` | 同上 | ✅ |
| `org.member.added` / `removed` / `role_changed` | `304` | ⚠️ **需补事件契约** |
| `ip.transferred` / `dissolved` | `304` | ⚠️ **需补** |
| `entitlement.granted` / `revoked` | `303` | ⚠️ **需补** |
| `media.processing.completed` / `failed` | `57` | ⚠️ **需补** |
| `moderation.case.decided` / `appealed` | `63` | ⚠️ **需补** |

---

## 6. 审计矩阵

**必须审计的操作**（`docs/169` §12 + `303` §2.4）：

| 类别 | 已定义 | 缺口 |
|---|---|---|
| 登录 / 登出 | ✅ | — |
| 权限变更 / 角色变更 | ✅ `301` | — |
| 账户状态变化 | ✅ `303` | — |
| 内容发布 / 删除 | ✅ | — |
| 审核判定 | ✅ | — |
| IP 成员变化 | ✅ `304` | — |
| 组织变化 | ✅ `304` | — |
| 订阅变化 | ⚠️ | **需明确审计字段** |
| 敏感操作（导出/支付/提权） | ✅ `307` | — |

---

## 7. 开发准入结论

**阻断项（必须完成才能开工）：**

1. RC-01 Block/Mute API
2. RC-02 Report/Appeal API
3. RC-03 Revision API
4. RC-10 搜索/Feed 索引延迟契约（本文档 §3 已补齐定义，待落地实现）
5. Subscription / Job 机器可读状态机

**非阻断但需排期：** RC-04 ~ RC-09、事件矩阵 5 项、审计字段细化。
