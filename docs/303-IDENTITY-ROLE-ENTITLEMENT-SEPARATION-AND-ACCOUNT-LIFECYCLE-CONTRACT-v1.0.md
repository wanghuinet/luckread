# LuckRead Identity / Role / Entitlement / Ownership 分离与账户生命周期合同 v1.0

**Status:** P0 / CANONICAL
**Related:** `docs/08-P0-IDENTITY-AND-API-FOUNDATION-CONTRACT-v1.0.md`（注册 UX，本文档补数据/状态模型）
**Related:** `docs/72-USER-CENTER-PROFILE-SETTINGS-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`（用户体验层）
**Related:** `docs/301`（L0–L8）、`docs/302`（授权缓存）

---

## 0. 审计发现

| 检查项 | 结果 |
|---|---|
| Identity / Role / Entitlement / Subscription / Org Membership / Account State / Ownership **七者分离** | ❌ 未定义 |
| 用户生命周期完整状态机（12 态） | ⚠️ `docs/72` §12 有部分，无完整转换矩阵 |
| `scheduled` / `pending_deletion` 等状态 | ⚠️ 不统一 |
| 企业用户 / 个人用户区分 | ❌ 未定义（见 `docs/304`） |

---

## 1. 七类概念必须分离（P0）

**禁止**把以下概念合并进 `Role`。这是权限系统重构的头号来源。

| 概念 | 定义 | 载体 | 是否授权输入 |
|---|---|---|---|
| **Identity** 身份 | 你是谁（认证主体） | `Identity`、`Credential` | ✅ subject_id |
| **Role** 角色 | 你在平台承担的职责 | `RoleAssignment` | ✅ |
| **Entitlement** 权益 | 你被授予的能力条目 | `EntitlementGrant` | ✅ |
| **Subscription** 订阅 | 你的付费状态 | `Subscription` | ✅ |
| **Organization Membership** 组织成员 | 你属于哪些组织及其中角色 | `OrgMembership` | ✅ |
| **Account State** 账户状态 | 账户是否可用 | `User.account_state` | ✅（状态门） |
| **Resource Ownership** 资源归属 | 你拥有哪些资源 | 资源表 `owner_id` | ✅ |

### 1.1 规则

- **Role 是 Entitlement 的集合（分组），不是权限本身。** API 必须校验 `permission`，不得只校验 role 名。
- **Entitlement 可独立于 Role 授予**（促销、补偿、合作、临时开通）。
- **Subscription 产生 Entitlement，但不等于 Entitlement**（赠送权益同样产生 Entitlement）。
- **OrgMembership 的作用域是组织内**，不授予平台级能力。
- **Account State 是否决性输入**，优先于 Role（见 `docs/301` §6）。
- **Ownership 是资源级**，与 Role 无关；转让所有权不改变角色。

### 1.2 授权求值顺序（固定）

```text
1. 解析 Identity（认证）
2. 读取 Account State        → 若非 active → 状态门裁决
3. 展开 DENY 列表            → 命中即拒
4. 展开 Role → Permission
5. 并入 Entitlement Grant
6. 并入 Subscription → Entitlement
7. 并入 OrgMembership / IP Scope
8. 并入 Temporary / Delegated Grant（校验未过期）
9. 评估 Resource Ownership / Scope
10. 与请求 resource+action 求交
```

---

## 2. 用户生命周期状态机

### 2.1 状态（12 态）

```text
UNREGISTERED
PENDING_VERIFICATION
ACTIVE
RESTRICTED
FROZEN
SUSPENDED
BANNED
DELETION_REQUESTED
DELETION_PENDING
DELETED
RESTORED
REACTIVATED
```

| 状态 | 含义 | 登录 | 写操作 | Token |
|---|---|---|---|---|
| `UNREGISTERED` | 未注册 | — | — | — |
| `PENDING_VERIFICATION` | 已注册待验证 | ✅ 受限 | 仅账户自助 | 有效（弱） |
| `ACTIVE` | 正常 | ✅ | ✅ | 有效 |
| `RESTRICTED` | 受限（禁发布/评论/变现） | ✅ | 部分 | 有效 |
| `FROZEN` | 冻结（只读） | ✅ | ❌ | 有效 |
| `SUSPENDED` | 停用（禁登录） | ❌ | ❌ | **全部失效** |
| `BANNED` | 封禁 | ❌ | ❌ | **全部失效** |
| `DELETION_REQUESTED` | 注销申请 | ✅ | ❌ | 有效 |
| `DELETION_PENDING` | 注销冷静期 | ❌ | ❌ | **全部失效** |
| `DELETED` | 已注销 | ❌ | ❌ | 全部失效 |
| `RESTORED` | 已恢复（申诉/误判） | ✅ | ✅ | 需重新登录 |
| `REACTIVATED` | 重新激活（注销后回归） | ✅ | ✅ | 需重新登录 |

### 2.2 合法转换矩阵

| From | To | 触发者 | 权限 | 前置条件 |
|---|---|---|---|---|
| `UNREGISTERED` | `PENDING_VERIFICATION` | 用户 | 匿名注册 | 通过风控/限流 |
| `PENDING_VERIFICATION` | `ACTIVE` | 用户/系统 | 自助 | 手机或邮箱验证通过 |
| `PENDING_VERIFICATION` | `DELETED` | 系统 | `job` | 超时未验证（默认 30 天） |
| `ACTIVE` | `RESTRICTED` | 运营/审核 | `user.restrict` | 有违规记录 |
| `ACTIVE` | `FROZEN` | 运营/审核 | `user.freeze` | 风控命中或调查中 |
| `ACTIVE` | `SUSPENDED` | 管理员 | `user.suspend` | 严重违规 |
| `ACTIVE` | `BANNED` | 管理员 | `user.ban` | 重大违规 + 审批 |
| `ACTIVE` | `DELETION_REQUESTED` | 用户 | 自助 | 无进行中交易/结算 |
| `RESTRICTED` | `ACTIVE` | 运营/审核 | `user.restrict` | 期满或申诉通过 |
| `RESTRICTED` | `FROZEN`/`SUSPENDED`/`BANNED` | 同上 | 同上 | 升级处置 |
| `FROZEN` | `ACTIVE` | 运营 | `user.unfreeze` | 调查结束 |
| `FROZEN` | `SUSPENDED`/`BANNED` | 管理员 | 同上 | 升级处置 |
| `SUSPENDED` | `ACTIVE` | 管理员 | `user.reinstate` | 期满或申诉通过 |
| `SUSPENDED` | `BANNED` | 管理员 | `user.ban` | 升级 |
| `BANNED` | `RESTORED` | 管理员 + L7 审批 | `user.restore` | 申诉成立 |
| `BANNED` | `DELETED` | 系统/用户 | — | 法定留存期满 |
| `DELETION_REQUESTED` | `DELETION_PENDING` | 系统 | `job` | 冷静期开始 |
| `DELETION_REQUESTED` | `ACTIVE` | 用户 | 自助 | 冷静期内撤销申请 |
| `DELETION_PENDING` | `DELETED` | 系统 | `job` | 冷静期结束（默认 15 天） |
| `DELETION_PENDING` | `ACTIVE` | 用户 | 自助 | 冷静期内撤销 |
| `DELETED` | `REACTIVATED` | 用户 + 审核 | `user.reactivate` | 在可恢复窗口内（默认 30 天） |
| `RESTORED`/`REACTIVATED` | `ACTIVE` | 系统 | `job` | 重新登录后自动 |

### 2.3 禁止的转换

- ❌ `DELETED` → `ACTIVE`（必须先 `REACTIVATED`，且在窗口内）
- ❌ `BANNED` → `ACTIVE`（必须 `RESTORED` + 审批）
- ❌ 任意状态 → `UNREGISTERED`
- ❌ `PENDING_VERIFICATION` → 任意业务状态（必须先 `ACTIVE`）
- ❌ 跳过 `DELETION_PENDING` 直接 `DELETED`（除系统强制清除）

### 2.4 每次状态变化必须定义（合规清单）

| 维度 | 要求 |
|---|---|
| **Actor** | 必须记录 `actor_id` + `actor_type`（user/admin/system/job） |
| **Permission** | 必须校验对应权限；系统/作业走服务主体 |
| **Preconditions** | 上表前置条件；不满足返回 `PRECONDITION_FAILED` |
| **Side Effects** | 见下表 |
| **Event** | 必须发 `identity.account_state_changed`（见 `docs/163`） |
| **Audit** | **必须**写 W06 审计，`before`/`after` 全记录（见 `docs/169` §12） |
| **Cache** | 必须递增 `account_state_version`（`docs/302` §4.1） |
| **Token** | 按上表 Token 列处理；失效必须实时 |
| **Data** | 按 `docs/306` 处理；`DELETED` 触发擦除流程 |

### 2.5 副作用矩阵

| 转换 | Token | 会话 | 内容 | 评论 | 社交 | 订阅 | 通知 | 搜索/Feed |
|---|---|---|---|---|---|---|---|---|
| →`RESTRICTED` | 保持 | 保持 | 已发布保留，**禁止新增发布** | 禁新增 | 保持 | 保持 | 保持 | 保留 |
| →`FROZEN` | 保持 | 保持 | 全部隐藏（不可见但不删） | 隐藏 | 保持 | 保持 | 保持 | **移除** |
| →`SUSPENDED` | **失效** | **终止** | 隐藏 | 隐藏 | 保持 | 暂停计费？否 | 停止 | **移除** |
| →`BANNED` | **失效** | **终止** | 隐藏 + 停止分发 | 隐藏 | 保留（不可新增） | 取消并退款策略见商业化 | 停止 | **移除** |
| →`DELETION_PENDING` | **失效** | **终止** | 隐藏 | 隐藏 | 保留 | 停止续费 | 停止 | **移除** |
| →`DELETED` | 失效 | 终止 | 按 `docs/306` | 按 `docs/306` | 按 `docs/306` | 终止 | 清除 | 移除 |
| →`RESTORED`/`REACTIVATED` | 需重登 | 需重登 | 恢复可见（不保证恢复分发位） | 恢复 | 恢复 | 需重新订阅 | 恢复 | 重新入索引 |

---

## 3. Identity / Credential 模型

| 实体 | 域 | 说明 |
|---|---|---|
| `User` | D1-01 | 平台主体，聚合根 |
| `Identity` | D1-01 | 认证身份（phone / email / 第三方 / 用户名），一个 User 可有多个 |
| `Credential` | D1-01 | 密码哈希、WebAuthn、OAuth 绑定；**禁止明文** |
| `Session` | D1-01 | 会话，绑定设备与 `token_version` |
| `Verification` | D1-01 | 验证码/验证记录，带尝试次数与过期 |
| `DeviceRecord` | D1-01 | 设备指纹与信任状态 |

**规则：**

- `User` 与 `Identity` **必须分离**（支持换绑、多登录方式、企业 SSO）。
- 密码**必须**使用 Argon2id 或 bcrypt，**禁止** MD5/SHA1/裸 SHA256。
- 验证码必须：限尝试次数、限有效期、一次性消费、防枚举（见 `docs/307`）。
- 会话必须支持：单设备登出、全部登出、异常登录告警（`docs/72` §6–§7）。

---

## 4. 与现有文档的关系

- `docs/08` 定义**注册 UX**，本文档定义**状态与数据模型**，二者互补。
- `docs/72` §12 的账户生命周期**引用**本文档为 Canonical Source。
- `docs/301` 定义**层级**，本文档定义**状态**；状态门优先于层级。

---

## 5. 开发准入门禁

- [ ] 七类概念已落地为独立实体/表，**未**混入 Role
- [ ] 12 态状态机已落地，非法转换返回 `INVALID_STATE`
- [ ] 每次转换的 Token/Cache/Audit/Event 副作用已实现
- [ ] `account_state_version` 递增已实现
- [ ] 状态机转换测试覆盖全矩阵（正例 + 非法转换反例）
