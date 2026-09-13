# LuckRead L0–L8 权限层级合同 v1.0

**Status:** P0 / CANONICAL
**Canonical Source:** L0–L8 层级的唯一权威定义。
**Related:** `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`（RBAC 机制，本文档定义层级，二者互补不冲突）
**Related:** `docs/302-AUTHORIZATION-CACHE-SECURITY-CONTRACT-v1.0.md`

---

## 0. 审计发现

全库检索 `L0`-`L8` **命中 0**。现有 `04-P0-PERMISSION-RBAC-CONTRACT` 定义了 **8 个扁平角色**
（`user` / `creator` / `editor` / `moderator` / `mcn_admin` / `mcn_editor` / `admin` / `super_admin`），
但**没有层级、没有默认权限、没有升级/降级/封禁条件、没有数据范围**。

本文档补齐层级。**不推翻** 04 的角色列表，而是把角色**映射**到层级上。

---

## 1. 核心原则

### `LAYER-INVARIANT-001`

> **层级（Layer）不是角色（Role）。**
> 层级决定**能力上限与默认权限**；角色是层级的**具名实例**。
> 一个层级可包含多个角色；一个角色在任一时刻只属于一个层级。

### `LAYER-INVARIANT-002`

> **层级不得绕过资源归属（Ownership）。**
> 高层级 ≠ 可访问任意资源。跨用户/跨组织访问仍需 Scope 授权。

### `LAYER-INVARIANT-003`

> **层级不得由缓存推断。** 层级判定必须走权威源（D1-01）。见 `AUTHZ-CACHE-INVARIANT-001`。

---

## 2. L0–L8 总表

| 层 | 名称 | 典型用户 | 认证 | 数据范围 | 管理后台 |
|---|---|---|---|---|---|
| **L0** | Anonymous 未认证 | 游客 | 无 | 仅 `public` 可见内容 | ❌ |
| **L1** | Registered 注册未验证 | 刚注册 | 弱 | 自身资源 + public | ❌ |
| **L2** | Verified 已验证用户 | 完成手机/邮箱验证 | 标准 | 自身 + public + 社交互动 | ❌ |
| **L3** | Creator 创作者 | 已开通创作 | 标准 | + 自身内容全状态 + 创作后台 | 创作者后台 |
| **L4** | IP Principal / Org Lead IP 主理人/组织负责人 | IP 主理人、MCN 管理员 | 强 | + 所属 IP/组织全资源 | IP/MCN 后台 |
| **L5** | Operator 运营 | 平台运营、编辑 | 强 + MFA | 跨用户只读 + 内容运营动作 | 运营后台（受限） |
| **L6** | Moderator 审核/风控 | 审核员、风控 | 强 + MFA | 审核队列 + 处置动作 | 审核后台 |
| **L7** | Admin 管理员 | 平台管理员 | 强 + MFA | 租户内全部（除安全/密钥/审计） | 管理后台 |
| **L8** | Super Admin 超级管理员 | 超管 / Break-Glass | 强 + MFA + 审批 | 全平台含安全配置 | 全后台 |

---

## 3. 逐层定义

每一层必须定义：用户类型 / 可访问 / 不可访问 / 默认权限 / API 权限 / 管理后台 / 数据范围 / 操作范围 / 升级条件 / 降级条件 / 封禁条件。

### L0 — Anonymous

- **用户类型：** 未登录 / 无有效 Token
- **可访问：** `visibility=public` 且 `state=published` 的内容；公开创作者主页；公开搜索；公开 Feed
- **不可访问：** 任何私有资源、任何写操作、任何用户维度数据、任何管理接口
- **默认权限：** `content.read.public`、`search.read.public`、`feed.read.public`、`taxonomy.read`
- **API 权限：** 仅 `GET` 类公开端点；**写端点一律 401**
- **管理后台：** 无
- **数据范围：** `visibility ∈ {public}`
- **操作范围：** 只读
- **升级条件：** 完成注册 → L1
- **降级条件：** N/A（初始层）
- **封禁条件：** IP/设备风控命中 → 请求拒绝（无账户可封）
- **限流：** 最严格（见 `docs/170`）

### L1 — Registered（未验证）

- **用户类型：** 已注册但未完成手机/邮箱验证
- **可访问：** 自身 profile、自身设置；public 内容
- **不可访问：** 发布内容、评论、点赞、关注、上传、创建 IP、加入组织、任何商业化能力
- **默认权限：** L0 + `user.read.self`、`user.update.self`
- **API 权限：** 仅 `/api/v1/auth/*` 与 `/api/v1/users/me` 相关
- **管理后台：** 无
- **数据范围：** `owner_id = self`
- **操作范围：** 账户自助
- **升级条件：** 完成手机或邮箱验证 → L2
- **降级条件：** 验证信息失效/撤回 → 回 L1
- **封禁条件：** 注册滥用、批量注册、黑产命中 → `suspended`/`banned`

### L2 — Verified

- **用户类型：** 已验证普通用户
- **可访问：** public + 自身全部 + 社交互动 + 收藏 + 举报
- **不可访问：** 创作能力（需显式开通）、他人私有数据、任何后台
- **默认权限：** L1 + `comment.create`、`comment.read`、`interaction.like`、`interaction.unlike`、
  `interaction.favorite`、`social.follow`、`social.unfollow`、`social.block`、`social.mute`、
  `report.create`、`notification.read.self`、`notification.update.self`
- **API 权限：** 全部 `/api/v1/*` 读端点 + 互动类写端点
- **管理后台：** 无
- **数据范围：** `owner_id = self` ∪ `visibility ∈ {public, unlisted?否}`
- **操作范围：** 消费 + 互动 + 举报
- **升级条件：** 申请并通过创作者开通 → L3；被任命为 IP 主理人/组织负责人 → L4
- **降级条件：** 验证撤销、严重违规 → 降 L1 或封禁
- **封禁条件：** 违规累计、欺诈、恶意举报

### L3 — Creator

- **用户类型：** 已开通创作者
- **可访问：** 自身内容**全部状态**（draft/review/scheduled/published/archived）；创作者数据后台
- **不可访问：** 他人内容的管理态、审核队列、他人 IP
- **默认权限：** L2 + `content.create`、`content.update.own`、`content.delete.own`、
  `content.submit_review.own`、`content.publish.own`、`content.unpublish.own`、`content.schedule.own`、
  `revision.create.own`、`revision.restore.own`、`media.upload`、`media.read.own`、
  `creator.read.self`、`creator.update.self`、`creator.stats.read.self`
- **API 权限：** `/api/v1/contents/*`（own scope）、`/api/v1/media/*`、`/api/v1/creators/me/*`
- **管理后台：** 创作者后台（仅自身）
- **数据范围：** `owner_id = self` ∪ `attribution.creator_id = self`
- **操作范围：** 创作 + 发布 + 数据查看
- **升级条件：** 成为 IP 主理人 / 组织管理员 → L4
- **降级条件：** 创作者资格被撤销、认证过期 → 回 L2（**已发布内容保留**）
- **封禁条件：** 侵权、抄袭、刷量、违规变现 → 可叠加 `content_freeze`（只禁发布，不禁登录）

### L4 — IP Principal / Organization Lead

- **用户类型：** IP 主理人、MCN/组织管理员、企业管理员
- **可访问：** 所管辖 IP / 组织的全部资源与成员管理
- **不可访问：** 其他 IP / 组织；平台级配置；审核队列
- **默认权限：** L3 + `ip.read.scope`、`ip.update.scope`、`ip.member.invite`、`ip.member.remove`、
  `ip.member.role.update`、`ip.content.manage.scope`、`ip.revenue.read.scope`、
  `org.read.scope`、`org.member.manage.scope`、`org.billing.read.scope`
- **API 权限：** `/api/v1/ips/{id}/*`（scope）、`/api/v1/orgs/{id}/*`（scope）
- **管理后台：** IP 后台 / MCN 后台 / 组织后台
- **数据范围：** `membership.org_id ∈ self.managed_orgs` ∪ `ip_id ∈ self.managed_ips`
- **操作范围：** 管辖范围内全部业务操作（**不含**处置其他用户账户）
- **升级条件：** 被授予平台运营角色 → L5
- **降级条件：** 成员资格被移除、组织解散、IP 转移 → 回 L3
- **封禁条件：** 组织级违规、洗钱/欺诈、批量侵权

> **注：** 「IP 创始人」**不得**作为独立角色存在，统一为 IP 主理人（见 `docs/304`）。

### L5 — Operator（运营）

- **用户类型：** 平台运营、内容编辑、活动运营
- **可访问：** 跨用户只读内容；内容运营动作（推荐位、专题、置顶、加权）
- **不可访问：** 用户账户处置、审核判定、安全配置、密钥、审计修改
- **默认权限：** `content.read.any`、`content.curate`、`content.feature`、`content.promote`、
  `topic.manage`、`campaign.manage`、`analytics.read`
- **API 权限：** `/api/v1/admin/content/*`、`/api/v1/admin/curation/*`
- **管理后台：** 运营后台（受限）
- **数据范围：** 全平台内容（只读为主），**不含**用户凭据与支付数据
- **操作范围：** 内容编排与分发
- **升级条件：** 被授予审核权限 → L6；被授予管理权限 → L7
- **降级条件：** 角色撤销 → 回 L2/L3
- **封禁条件：** 越权操作、数据外泄 → 立即撤销并审计

### L6 — Moderator（审核 / 风控）

- **用户类型：** 审核员、风控专员
- **可访问：** 审核队列、举报、申诉、风控案例
- **不可访问：** 系统配置、密钥、审计日志修改、其他管理员账户
- **默认权限：** `moderation.queue.read`、`moderation.case.read`、`moderation.decide`、
  `content.unpublish.any`、`content.hide`、`comment.moderate`、`appeal.review`、`appeal.decide`、
  `user.restrict.limited`（**仅限受限，不含封禁**）
- **API 权限：** `/api/v1/admin/moderation/*`、`/api/v1/admin/appeals/*`
- **管理后台：** 审核后台 / 风控后台
- **数据范围：** 审核相关全平台
- **操作范围：** 内容处置 + 有限用户限制
- **升级条件：** 被授予管理权限 → L7
- **降级条件：** 角色撤销、误判率超标 → 回 L5/L2
- **封禁条件：** 滥用处置权、受贿、泄密

> **约束：** L6 **不得**自行封禁 L7/L8 账户；跨层处置需 L7+ 审批（`docs/169` §11）。

### L7 — Admin（管理员）

- **用户类型：** 平台管理员
- **可访问：** 租户内全部业务数据与管理功能
- **不可访问：** 密钥明文、审计日志修改/删除、自身权限提升、其他 L7/L8 账户处置
- **默认权限：** L5+L6 全部 + `user.read.any`、`user.restrict.any`、`user.suspend`、
  `role.assign`（**不含 L8 角色**）、`org.manage.any`、`subscription.manage.any`、
  `config.manage`（不含安全配置）、`feature_flag.manage`
- **API 权限：** `/api/v1/admin/*`（除 `/admin/security/*`、`/admin/audit/*`）
- **管理后台：** 管理后台（安全中心与审计中心只读）
- **数据范围：** 全租户
- **操作范围：** 全业务管理
- **升级条件：** 双人审批 + Break-Glass 流程 → L8
- **降级条件：** 离职、权限复核未通过、角色撤销
- **封禁条件：** 越权、违规提权、数据外泄

### L8 — Super Admin / Break-Glass

- **用户类型：** 超级管理员、紧急访问账户
- **可访问：** 全平台，含安全配置、密钥管理、审计查看
- **不可访问：** **审计日志的修改与删除**（任何层均禁止）
- **默认权限：** 全部，含 `secret.manage`、`audit.read.any`、`security.manage`、`role.assign.any`
- **API 权限：** `/api/v1/admin/*` 全部
- **管理后台：** 全部
- **数据范围：** 全平台
- **操作范围：** 全部（审计例外）
- **升级条件：** 双人审批 + 有时限授予（默认 ≤ 4h）
- **降级条件：** 时限到期自动降级、审批撤销
- **封禁条件：** 滥用立即吊销 + 安全事件响应（`docs/169` §8–§10）

---

## 4. 层级与现有角色的映射

| 现有角色（04-P0） | 层级 |
|---|---|
| `user`（未验证） | L1 |
| `user`（已验证） | L2 |
| `creator` | L3 |
| `editor` | L5 |
| `mcn_admin` | L4 |
| `mcn_editor` | L4（受限子集） |
| `moderator` | L6 |
| `admin` | L7 |
| `super_admin` | L8 |

**新增必需角色（P0）：** `ip_principal`（L4）、`operator`（L5）、`verified_user`（L2）。

---

## 5. 冲突解决规则（优先级）

当多个授权来源冲突时，**按以下顺序，后者不覆盖前者**：

```text
1. DENY（显式拒绝）          —— 最高优先级，不可被任何 GRANT 覆盖
2. Account State Gate         —— suspended/banned/deleted 直接拒绝（除恢复流程）
3. Resource Ownership         —— owner 显式授权
4. Organization/IP Scope Grant
5. Entitlement / Subscription Grant
6. Temporary / Delegated Grant（未过期）
7. Role Permission（按层级取并集，再按最小权限裁剪）
8. Layer Default Permission
9. Public / Anonymous Default  —— 最低
```

**规则：**

- **DENY 绝对优先。** 任何 DENY 命中即拒绝，不做后续评估。
- **层级只做“上限”不做“放行”。** 高层级不代表拥有低层级未授予的能力。
- **临时权限必须有过期时间**，过期即失效，不得续期静默。
- **降级立即生效**：层级下降后，缓存中的授权必须按 `docs/302` 失效。

---

## 6. 状态门（Account State Gate）

账户状态优先于层级：

| 账户状态 | 效果 |
|---|---|
| `active` | 正常 |
| `restricted` | 禁止发布/评论/变现；可登录可浏览 |
| `frozen` | 禁止全部写操作；可登录只读 |
| `suspended` | 禁止登录；Token 全部失效 |
| `pending_deletion` | 禁止登录；进入冷静期 |
| `deleted` | 全部拒绝；数据按 `docs/306` 处理 |
| `banned` | 全部拒绝；不可自助恢复 |

---

## 7. 开发准入门禁

- [ ] L0–L8 已落地为 `contracts/authz/layers.json`
- [ ] 角色→层级映射已落地，`ip_principal`/`operator`/`verified_user` 已创建
- [ ] DENY 优先与状态门已在鉴权中间件实现
- [ ] 层级变更的缓存失效已实现并有测试
- [ ] 每个层级至少一组授权测试（正例 + 越权反例）
