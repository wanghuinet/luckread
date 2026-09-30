# LuckRead Authorization Cache Security Contract v1.0

**Status:** P0 / SECURITY-CRITICAL / CANONICAL
**Defines:** `AUTHZ-CACHE-INVARIANT-001`
**Related:** `docs/300`（ARCH-INVARIANT-003）、`docs/301`（L0–L8）、`docs/167`（缓存失效/热键/击穿）

---

## 0. 审计发现

全库检索 `AUTHZ-CACHE-INVARIANT-001` **命中 0**。
`docs/167-CACHE-INVALIDATION-HOT-KEY-STAMPEDE-CONTRACT` 存在，但其 17 个章节全部关于
**失效策略、热键、击穿、成本、可观测性**，**没有**关于「缓存不得作为授权边界」的安全规范。

**结论：这是 P0 安全缺口。缓存导致的权限泄漏是最高危缺陷类别之一。**
本文档是 Canonical Source；`docs/167` 继续负责缓存性能语义。

---

## 1. 不变量

### `AUTHZ-CACHE-INVARIANT-001`

> **Cache HIT ≠ Authorization Proof.**
> 缓存命中**永远不是**授权证明。
> 任何从缓存取得的数据，在用于放行、渲染、返回给调用方之前，
> **必须**基于权威源（D1-01）重新完成授权判定。
> 缓存只能缓存「**已经完成授权判定**」的**结果负载**，
> 且该负载必须绑定判定时的**主体版本与策略版本**，命中后仍需校验版本未变。

### `AUTHZ-CACHE-INVARIANT-002`

> **授权判定失败必须 Fail Closed。**
> 当授权所需的任何输入（主体、版本、策略、资源范围）不可得时，
> 默认结果 = **DENY**。禁止因可用性而默认放行。

### `AUTHZ-CACHE-INVARIANT-003`

> **缓存 Key 必须包含完整安全主体维度。**
> 缺失任一维度即视为 Key 构造缺陷（安全缺陷，非性能缺陷）。

### `AUTHZ-CACHE-INVARIANT-004`

> **任何权限撤销必须触发确定性失效。**
> 撤销后到失效完成之间的窗口必须有上界，且该窗口内**不得**依赖缓存放行。

---

## 2. Security Principal（安全主体）

授权判定的输入主体，定义为：

```text
SecurityPrincipal = {
  subject_id,              // 用户 / 服务主体 ID（来自 D1-01）
  account_state_version,   // 账户状态版本（每次状态/封禁变化 +1）
  role_version,            // 角色分配版本（每次角色变更 +1）
  entitlement_version,     // 权益版本（订阅/权益变化 +1）
  subscription_version,    // 订阅状态版本
  organization_version,    // 组织成员关系版本
  policy_version,          // 平台策略版本
  session_id,              // 会话标识
  token_version            // 令牌版本（登出/改密/吊销 +1）
}
```

**规则：**

- 任一 `*_version` 变化 ⇒ 该主体所有授权缓存**立即失效**。
- `subject_id` **必须**来自权威源，**不得**来自缓存、JWT claim 中的可过期副本以外的地方
  （JWT 只能作为**提示**，状态与版本必须查权威源或带版本的短 TTL 校验）。
- 服务主体（Service Principal）同样适用，且必须带 `tenant_scope`。

---

## 3. Cache Key 规范

### 3.1 授权相关缓存 Key 必须包含

```text
authz:{policy_version}:{subject_id}:{account_state_version}:
{role_version}:{entitlement_version}:{subscription_version}:
{organization_version}:{resource_type}:{resource_scope}:{action}
```

### 3.2 内容/列表类缓存 Key 必须包含 viewer 维度

```text
view:{policy_version}:{viewer_id | anon}:{viewer_state_version}:
{visibility_set}:{resource_type}:{resource_id}:{representation_version}
```

### 3.3 禁止

- ❌ 用 `user_id` 单独作为授权缓存 Key
- ❌ 用角色名字符串作为 Key（角色变更不会使 Key 变化）
- ❌ 把「是否有权限」的布尔值缓存后**直接作为放行依据**
- ❌ 跨主体共享同一份未过滤权限的结果（如把管理员视角结果缓存给普通用户）
- ❌ 缓存 Key 中省略 `policy_version`（策略更新后无法批量失效）

### 3.4 允许的缓存

| 缓存对象 | 是否允许 | 条件 |
|---|---|---|
| 已授权判定的**内容负载** | ✅ | 绑定 viewer 维度 + 版本；命中后校验版本 |
| 公开内容渲染结果 | ✅ | `visibility=public` 且 `state=published` |
| 权限**集合快照**（用于 UI 展示） | ⚠️ | 仅用于展示，不得作为服务端放行依据 |
| 授权**决策布尔值**作为放行依据 | ❌ | 违反 INVARIANT-001 |
| 账户/会话有效性 | ❌ | 违反 INVARIANT-001 |
| 未过滤权限的搜索结果 | ❌ | 违反 INVARIANT-001 |

---

## 4. 失效机制

### 4.1 版本化失效（首选）

权限相关变更 → **递增对应 version** → 旧 Key 自然不可达。
优点：无需枚举删除，确定性强。

**必须递增版本的事件：**

| 事件 | 递增 |
|---|---|
| 角色分配 / 撤销 | `role_version` |
| 层级升降（`docs/301`） | `role_version` |
| 账户状态变化（受限/冻结/封禁/恢复） | `account_state_version` |
| 订阅变更（升级/降级/取消/过期） | `subscription_version` |
| 权益授予 / 回收 | `entitlement_version` |
| 组织/IP 成员加入/退出/移除/角色变更 | `organization_version` |
| 登出 / 改密 / Token 吊销 / 会话失效 | `token_version` |
| 平台策略更新 | `policy_version`（全局） |

### 4.2 TTL 上界（兜底）

即使版本化失效，授权相关缓存 **TTL 硬上界**：

| 类别 | 最大 TTL |
|---|---|
| 授权判定输入 | **60 秒** |
| 已授权内容负载（登录用户） | 300 秒 |
| 公开内容（L0） | 900 秒 |
| 权限集合快照（仅 UI） | 300 秒 |

### 4.3 撤销传播 SLA

| 变更 | 生效上界 | 强制手段 |
|---|---|---|
| 封禁 / 冻结 / 吊销 Token | **≤ 10 秒** | 主动失效 + 版本递增 + 会话校验 |
| 角色/权限撤销 | ≤ 30 秒 | 版本递增 |
| 订阅/权益变化 | ≤ 60 秒 | TTL 上界自然过期 |

**在生效上界之前，系统不得依赖缓存放行任何敏感操作。**
敏感操作（发布、删除、提权、支付、导出、成员变更）必须**实时鉴权**，`cache_read = none`。

---

## 5. Fail Closed 规则

| 场景 | 行为 |
|---|---|
| 授权输入不可得（D1 超时/错误） | **DENY**（不可降级为放行） |
| 版本校验不一致 | **DENY** + 强制重算 |
| 缓存 Key 维度缺失 | **DENY** + 告警（视为安全缺陷） |
| 缓存服务不可用 | 回源权威鉴权；若权威亦不可用 → **DENY** |
| 策略版本未知 | **DENY** |

**例外：** 纯公开只读内容（`visibility=public` 且 `state=published`）在缓存不可用时可回源，
回源失败则返回 `503`（**不得**降级为无权限校验的「公开内容」放行）。

---

## 6. 强制测试矩阵

以下测试为 **P0 准入门禁**，任一失败不得进入开发：

| # | 场景 | 期望 |
|---|---|---|
| T1 | 用户 A → 用户 B | B 不得看到 A 的私有数据；不得命中 A 的缓存 |
| T2 | 组织 A → 组织 B | 跨组织访问被拒；组织切换后缓存不串 |
| T3 | 管理员 → 普通用户 | 降权后不得访问管理接口；旧管理视角结果不复用 |
| T4 | 付费 → 免费 | 订阅降级后付费权益立即失效（≤60s，敏感 ≤10s） |
| T5 | 正常 → 封禁 | 封禁后 ≤10s 全部敏感操作被拒；Token 失效 |
| T6 | 有权限 → 撤权 | 撤权后 ≤30s 生效；DENY 优先于任何 GRANT |
| T7 | 并发撤权 + 请求 | 不得出现「撤销前缓存放行撤销后请求」 |
| T8 | 缓存 Key 缺维度 | 必须 DENY + 告警（构造缺陷测试） |
| T9 | 缓存服务宕机 | 敏感操作 DENY，不静默放行 |
| T10 | Token 版本不一致 | DENY + 强制重算 |
| T11 | 临时权限过期 | 过期即失效，无静默续期 |
| T12 | IP/组织成员移除 | ≤30s 内失去管辖范围权限 |

---

## 7. 可观测性

必须记录：

- `authz.decision`（allow/deny）、`reason`、`policy_version`、各 `*_version`
- `authz.cache.hit` / `miss` / `bypass`（敏感操作必须 `bypass`）
- `authz.cache.stale_rejected`（版本不一致被拒次数）
- `authz.fail_closed.count`（**必须告警**，正常应为 0 或极低）
- 权限撤销到失效的**传播延迟**（P99）

告警阈值：`authz.fail_closed.count` 突增、传播延迟超 SLA、`stale_rejected` 突增。

---

## 8. ADR

### ADR-C001 — 授权判定不缓存决策，只缓存已授权负载

- **Decision:** 禁止缓存授权布尔决策作为放行依据；只允许缓存已判定负载并绑定版本。
- **Alternatives:** (a) 缓存决策 + 短 TTL；(b) 完全不缓存。
- **Reason:** (a) 在 TTL 内必然存在权限泄漏窗口，且撤销无法瞬时生效；(b) 成本过高。
- **Trade-offs:** 每次命中需校验版本，增加一次轻量读取。
- **Consequences:** 需要版本表与版本递增逻辑，所有权限变更点必须递增版本。

### ADR-C002 — 授权失败 Fail Closed

- **Decision:** 授权输入不可得时 DENY。
- **Reason:** 授权是安全边界，可用性不得凌驾正确性。
- **Consequences:** D1 故障会导致部分拒绝，需通过 SLO 与容量保障缓解，而非降级放行。
