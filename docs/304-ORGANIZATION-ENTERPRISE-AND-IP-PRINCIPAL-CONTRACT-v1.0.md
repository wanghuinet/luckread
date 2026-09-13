# LuckRead Organization / Enterprise / IP 主理人模型合同 v1.0

**Status:** P0 / CANONICAL
**Related:** `docs/44-51`（MCN Center）、`docs/76-83`（Creator System）、`docs/10`（Content & IP Graph）、`docs/301`

---

## 0. 审计发现

| 检查项 | 全库命中 | 结论 |
|---|---|---|
| `主理人`（IP Principal） | **0** | ❌ 缺失，用户明确要求为 IP 的规范角色 |
| `创始人`（IP Founder） | 0 | ✅ 正确——不得创建，统一为主理人 |
| `Department`（部门） | **0** | ❌ 缺失 |
| `Enterprise`（企业） | 12（多在 IP 交易文档） | ⚠️ 无组织/企业账户模型 |
| `Organization` | 89 | ⚠️ 多为泛称，无 Membership/Invitation 完整模型 |

**关键裁决：** 「IP 创始人」**不得**作为独立角色创建。IP 的创建者统一登记为 **IP 主理人（IP Principal）**。

---

## 1. 个人用户 vs 企业用户

| 维度 | 个人用户（Individual） | 企业/组织用户（Enterprise / Org） |
|---|---|---|
| 载体 | `User` | `Organization` + `OrgMembership` |
| 法律主体 | 自然人 | 法人/组织 |
| 资质 | 个人实名（可选） | **企业实名 / 营业执照 / 对公验证（必填）** |
| 结算 | 个人钱包 | **组织钱包 + 对公账户 + 发票** |
| 内容归属 | 个人 | 可归属组织（可配置） |
| IP 归属 | 个人或 IP | **组织可为 IP 权利人** |
| 成员 | 无 | 多成员 + 角色 + 部门 |
| 后台 | 个人中心 | **组织后台 / 企业管理台** |
| 责任 | 个人承担 | 组织承担 + 管理员追责 |

**区分方式（唯一权威判据）：**

```text
user.account_type ∈ { individual, enterprise }
AND ( account_type = enterprise ⇒ 必须存在 active 的 OrgMembership
      且该 Organization.enterprise_verified = true )
```

**规则：**

- `account_type` 是 `User` 上的**属性**，不是 Role。
- 企业用户**仍然是一个 User**（有 Identity、可登录），其企业能力来自 `OrgMembership`。
- **禁止**用 Role 判断企业身份。

---

## 2. Organization 模型

### 2.1 实体

| 实体 | 域 | 说明 |
|---|---|---|
| `Organization` | D1-01 | 组织聚合根（类型：MCN / 企业 / 团队 / 机构） |
| `OrgMembership` | D1-01 | 用户↔组织成员关系（带角色、状态、部门） |
| `OrgInvitation` | D1-01 | 邀请（带 token、过期、角色、邀请人） |
| `OrgTeam` | D1-01 | 团队（组织内子分组） |
| `OrgDepartment` | D1-01 | 部门（层级结构，支持树） |
| `OrgRoleAssignment` | D1-01 | 组织内角色（作用域仅限本组织） |
| `OrgBillingProfile` | D1-01 | 组织计费主体、发票、对公账户 |

### 2.2 组织状态机

```text
DRAFT → PENDING_VERIFICATION → ACTIVE → SUSPENDED → DISSOLVED
                                   ↓
                                RESTRICTED
```

| From | To | 触发者 | 权限 | 前置 |
|---|---|---|---|---|
| `DRAFT` | `PENDING_VERIFICATION` | 创建者 | `org.create` | 填写主体信息 |
| `PENDING_VERIFICATION` | `ACTIVE` | 管理员（平台） | `org.verify` | 企业资质通过 |
| `PENDING_VERIFICATION` | `DRAFT` | 创建者 | `org.update.own` | 补正资料 |
| `ACTIVE` | `RESTRICTED` | 管理员 | `org.restrict` | 违规/风险 |
| `ACTIVE` | `SUSPENDED` | 管理员 | `org.suspend` | 严重违规 |
| `RESTRICTED`/`SUSPENDED` | `ACTIVE` | 管理员 | `org.reinstate` | 整改完成 |
| `ACTIVE` | `DISSOLVED` | 负责人 / 管理员 | `org.dissolve` | **无进行中交易、无未结算、成员已安置** |

**`DISSOLVED` 是终态**，不可恢复。必须先完成：成员移除、内容归属转移、资金结算、法务留存。

### 2.3 成员状态机

```text
INVITED → JOINED → ACTIVE → SUSPENDED → REMOVED
                       ↓
                     LEFT
```

| 转换 | 触发者 | 权限 | 说明 |
|---|---|---|---|
| →`INVITED` | 组织管理员 | `org.member.invite` | 生成一次性 token + 过期时间 |
| `INVITED`→`JOINED` | 被邀请人 | 自助 | 接受邀请 |
| `JOINED`→`ACTIVE` | 系统 | — | 完成后自动 |
| `ACTIVE`→`LEFT` | 成员 | 自助 | **主动退出**，不影响组织 |
| `ACTIVE`→`REMOVED` | 组织管理员 | `org.member.remove` | **移除**，需审计 |
| `ACTIVE`→`SUSPENDED` | 组织管理员 | `org.member.suspend` | 暂停 |
| `SUSPENDED`→`ACTIVE` | 组织管理员 | `org.member.reinstate` | 恢复 |
| `INVITED`→(过期) | 系统 | `job` | 过期作废，不可复用 |

**规则：**

- 组织**必须至少保留 1 个 `owner`**。移除最后一个 owner 必须被拒绝（或强制要求先转让）。
- 成员移除后：其组织内权限**立即失效**（递增 `organization_version`，见 `docs/302`）。
- 成员移除**不删除**其已产出内容；内容归属按 §4 处理。
- 组织解散时，成员自动 `REMOVED`，**不得**级联删除成员 User。

### 2.4 组织内角色（作用域仅限本组织）

| 角色 | 说明 | 层级映射 |
|---|---|---|
| `owner` | 所有者（唯一或少数） | L4 |
| `admin` | 组织管理员 | L4 |
| `manager` | 部门/团队负责人 | L4（受限） |
| `editor` | 内容编辑 | L4（受限） |
| `analyst` | 数据只读 | L4（只读） |
| `billing` | 财务 | L4（计费域） |
| `member` | 普通成员 | L3 |

**规则：** 组织角色**不得**授予平台级能力。跨组织访问一律 DENY。

---

## 3. IP 主理人模型（IP Principal）

### 3.1 裁决

> **「IP 创始人」不得作为独立角色创建。**
> IP 的创建者自动登记为 **IP 主理人（`ip_principal`）**。
> 该裁决理由见 ADR-I001。

### 3.2 IP 成员角色（封闭枚举）

| 角色 | 说明 | 能力 |
|---|---|---|
| `principal` | 主理人（唯一） | IP 全部权限、转移、解散、收益 |
| `creator` | 创作者 | 在 IP 下创作、提交 |
| `editor` | 编辑 | 编辑 IP 下内容、审核草稿 |
| `producer` | 制作人 | 制作流程、媒体、排期 |
| `operator` | 运营 | 分发、数据、活动 |

**Content Attribution（作者）单独建模**，不等于成员角色：

- `Attribution.author` 指向内容创作者（可为 `User` 或 `Creator`）
- 作者**不必**是 IP 成员
- 作者拥有署名权与内容归属，但**不自动获得** IP 管理权限

**Rights（权利）单独建模：**

- `RightsHolder`（权利人）：可为个人、组织、IP
- `Licensor`（授权方）：授权来源
- 权利关系与成员角色**解耦**

### 3.3 IP 状态机

```text
DRAFT → PENDING_VERIFICATION → VERIFIED → ACTIVE
                                    ↓
ACTIVE → SUSPENDED → REINSTATED
ACTIVE → TRANSFERRING → ACTIVE(新主理人)
ACTIVE → DISSOLVED（终态）
```

| From | To | 触发者 | 权限 | 前置 |
|---|---|---|---|---|
| `DRAFT` | `PENDING_VERIFICATION` | 创建者 | `ip.create` | 填写 IP 资料 |
| `PENDING_VERIFICATION` | `VERIFIED` | 管理员 | `ip.verify` | 资质/权属通过 |
| `PENDING_VERIFICATION` | `DRAFT` | 创建者 | `ip.update` | 补正 |
| `VERIFIED` | `ACTIVE` | 主理人 | `ip.activate` | 完成设置 |
| `ACTIVE` | `SUSPENDED` | 管理员 | `ip.suspend` | 违规/争议 |
| `SUSPENDED` | `ACTIVE` | 管理员 | `ip.reinstate` | 解决 |
| `ACTIVE` | `TRANSFERRING` | 主理人 | `ip.transfer` | 双方确认 + 无未结交易 |
| `TRANSFERRING` | `ACTIVE` | 系统 | — | 转移完成，新主理人 |
| `ACTIVE` | `DISSOLVED` | 主理人/管理员 | `ip.dissolve` | 内容已安置、收益已结算 |

### 3.4 IP 转移规则

- 转移必须：双方确认 + 冷静期 + 无进行中交易/结算 + 审计。
- 转移后：原主理人 → `creator` 或移除（可配置）；新主理人获得 `principal`。
- 转移**不改变**已发布内容的 Attribution。
- 转移必须递增所有相关成员的 `organization_version`。

### 3.5 IP 解散规则

- 解散前必须处理：内容归属、授权合约、未结算收益、进行中争议。
- 解散**不得**级联删除内容（内容可转移到其他 IP 或转个人）。
- `DISSOLVED` 为终态。

---

## 4. 资源归属（Resource Ownership）

| 资源 | 归属字段 | 可转让 | 组织解散时 | 用户删除时 |
|---|---|---|---|---|
| Content | `owner_user_id` + 可选 `owner_org_id` + `ip_id` | ✅ | 转给指定成员或主理人 | 见 `docs/306` |
| Media | `uploader_id` + `owner_org_id?` | ✅ | 同上 | 同上 |
| Comment | `author_id`（弱归属） | ❌ | 保留（匿名化作者） | 匿名化 |
| IP | `principal_id` + `owner_org_id?` | ✅（转移） | 转移 | 转让或解散 |
| Organization | — | ❌ | — | 移交 owner |

---

## 5. ADR

### ADR-I001 — IP 创始人合并为 IP 主理人

- **Decision:** 不创建 `ip_founder` 角色；IP 创建者登记为 `principal`。
- **Context:** 需要区分「创建动作」与「持续权责」。
- **Alternatives:** (a) 保留独立 founder 角色；(b) 用 creator 代替。
- **Reason:** (a) 会形成双主角色，权限冲突且无法处理转让；
  (b) creator 是内容创作角色，不能承担 IP 权责。
  `principal` 语义单一：唯一、可转让、权责完整。
- **Trade-offs:** 需要记录 `created_by` 作为历史字段（保留，非权限依据）。
- **Consequences:** IP 转移即 principal 转移，无需额外角色迁移。

### ADR-I002 — 企业身份用 account_type + OrgMembership 判定，不用 Role

- **Reason:** 企业身份是法律主体属性，不是职责；用 Role 判定会导致
  角色撤销后企业能力丢失、以及无法表达「同一人属于多个组织」。
- **Consequences:** 授权求值必须先解析 OrgMembership 再判定企业能力。

---

## 6. 开发准入门禁

- [ ] `ip_principal` 角色已创建；**不存在** `ip_founder`
- [ ] Organization 6 实体已建模，含 Department / Team / Billing
- [ ] 组织与成员状态机已落地，非法转换返回 `INVALID_STATE`
- [ ] 「最后一个 owner 不可移除」约束已实现
- [ ] 成员移除/角色变更触发 `organization_version` 递增
- [ ] IP 转移与解散的前置校验已实现
