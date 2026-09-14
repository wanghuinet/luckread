# LuckRead 1.0 高价值资产复用分配收口 v1.0

**Status:** CLOSED / CANONICAL ALLOCATION

## 1. 收口原则

1. 复用 1.0 已成熟的业务能力、规则、状态机、权限语义和验收约束；不盲目复制旧架构。
2. 当前 v2.0 Feature Blueprint 是唯一功能源；1.0 文档只作为历史高价值资产来源。
3. 已成熟的 IP / MCN / Organization / Rights / Transaction / Settlement 能力不重新发明。
4. 所有落地必须遵循 Feature ID → Contract → Code/Reuse/Refactor → Test → CI → SHA。
5. 本文完成后，这一批资产不再进入重复审计循环。

## 2. 1.0 → 当前 Feature ID 分配

| 1.0 资产 | 当前归属 | Feature IDs | 处理 |
|---|---|---|---|
| Enterprise / account type | USER / ORG / AUTHZ | USER-001, AUTHZ-006, ORG-001 | 复用语义 |
| Organization | ORG | ORG-001 | 复用 |
| OrgMembership | ORG / AUTHZ | ORG-002, AUTHZ-006 | 复用 |
| OrgInvitation | ORG | ORG-003 | 复用 |
| OrgTeam | ORG | ORG-004 | 复用 |
| OrgDepartment | ORG | ORG-005 | 复用 |
| OrgRoleAssignment | ORG / AUTHZ | ORG-006, AUTHZ-002 | 复用 |
| OrgBillingProfile | ORG / PAY | ORG-007, PAY-001 | 规则复用，新合同落地 |
| MCN | ORG / CREATOR | ORG-001, CREATOR-007 | 复用 |
| IP Principal | CREATOR / RIGHTS / AUTHZ | CREATOR-001, RIGHTS-001, AUTHZ-005 | `principal` 保留；禁止 `ip_founder` |
| IP member roles | AUTHZ / CREATOR | AUTHZ-002, AUTHZ-005, CREATOR-001 | 复用 |
| IP ownership | RIGHTS / AUTHZ | RIGHTS-001, AUTHZ-005 | 复用 |
| Attribution | CONTENT / RIGHTS | CONTENT-009, RIGHTS-001 | 与成员角色解耦 |
| RightsHolder / Licensor | RIGHTS | RIGHTS-001, RIGHTS-002 | 复用 |
| IP verification | RIGHTS / GOV | RIGHTS-002, GOV-006 | 复用 |
| IP transfer | RIGHTS / CREATOR | RIGHTS-005, CREATOR-001 | 复用状态机 |
| IP dissolution | RIGHTS / CREATOR | RIGHTS-006, CREATOR-001 | 复用终态规则 |
| Resource ownership | AUTHZ / CONTENT / MEDIA | AUTHZ-005, CONTENT-009, MEDIA-001 | 复用 |
| Licensing | RIGHTS / PAY | RIGHTS-003, PAY-003 | 复用业务语义 |
| IP transaction | RIGHTS / PAY | RIGHTS-003, PAY-002, PAY-005 | 复用生命周期 |
| Revenue split | PAY / ORG | PAY-008, PAY-009 | 复用 MCN/Creator 分成 |
| Settlement | PAY | PAY-010, PAY-011 | 复用 |
| Wallet / ledger | PAY | PAY-006, PAY-007 | 复用不可变账本原则 |
| Privileged audit | AUTHZ / GOV / OBS | AUTHZ-010, GOV-010, OBS-005 | 复用 |

## 3. 权限模型收口

统一模型：

```text
User Identity → Role → Permission → Entitlement → Ownership → Organization Scope → Resource Scope → Audit
```

IP 角色：

| Role | 权限边界 |
|---|---|
| `principal` | IP 全权限、转移、解散、收益相关操作 |
| `creator` | IP 内创作、提交 |
| `editor` | 编辑、审核草稿 |
| `producer` | 制作、媒体、排期 |
| `operator` | 分发、运营、数据 |

强制规则：`ip_founder` 不创建；`principal` 是唯一 IP 主理人语义；Attribution 与成员角色分离；RightsHolder/Licensor 与成员角色分离；跨组织默认 DENY；组织角色不得自动获得平台级权限；最后一个 organization owner 不得直接移除。

## 4. 状态机复用

### Organization
```text
DRAFT → PENDING_VERIFICATION → ACTIVE → RESTRICTED/SUSPENDED
ACTIVE → DISSOLVED
```

### Organization Member
```text
INVITED → JOINED → ACTIVE → LEFT
                       ↘ SUSPENDED → ACTIVE
                       ↘ REMOVED
```

### IP
```text
DRAFT → PENDING_VERIFICATION → VERIFIED → ACTIVE
                                           ↓
                                      TRANSFERRING
                                           ↓
                                      ACTIVE(new principal)
ACTIVE → SUSPENDED → ACTIVE
ACTIVE → DISSOLVED
```

### Transaction
```text
DRAFT → PENDING → ACTIVE → COMPLETED
                    ↓
                 DISPUTED
                    ↓
              RESOLVED / CANCELLED
```

交易金额、货币、退款、争议和结算的最终枚举由对应 Contract 冻结。

## 5. 资源归属

| Resource | Canonical ownership |
|---|---|
| Content | owner_user + optional owner_org + optional ip |
| Media | uploader + optional owner_org |
| IP | principal + optional owner_org |
| Comment | author（弱归属） |
| Organization | owner/member aggregate |

转移、解散、删除不得简单级联删除业务资产，必须处理依赖、权益、审计和留存。

## 6. 交易与商业能力

- IP Licensing 纳入 RIGHTS + PAY。
- 授权记录授权方、被授权方、范围、期限、地域和权利类型。
- 交易必须经过身份、权限、风险和审计检查。
- 交易完成后才产生最终 entitlement / revenue / settlement。
- MCN 分成与 Creator 收益统一进入 ledger / settlement。
- Refund / chargeback / dispute 不得绕过 entitlement 与 settlement。
- 金融结果必须可追溯到订单、账本和审计事件。

## 7. 实施批次分配

```text
Batch 01 Foundation / Identity / AuthZ primitives
        ↓
Batch 02 Organization / Enterprise / MCN
        ↓
Batch 03 Creator / IP Principal / Rights
        ↓
Batch 04 IP Licensing / Transaction
        ↓
Batch 05 Content Ownership / Attribution
        ↓
Batch 06 Revenue Split / Settlement
```

Batch 01 只提供身份、权限、ownership、scope 原语；不重复实现完整 MCN/IP 业务。后续批次按上述归属实施。

## 8. 复用边界

### 直接复用
- 业务概念与 Feature 语义
- 角色和权限边界
- 状态机
- ownership / attribution 规则
- IP Principal 决策
- MCN 成员模型
- 授权、交易、分成、结算原则
- 审计要求

### 不直接复制
- 旧数据库表结构
- 旧 API 路径
- 旧 Payload 实现
- 已过时架构假设
- 与 v2.0 冲突的字段或状态

## 9. 收口结论

**1.0 高价值资产复用分配：CLOSED**

IP、IP Principal、MCN、Organization、Enterprise、权限、Ownership、Rights、Licensing、Transaction、Revenue Split、Settlement、Audit 均已完成当前 Feature ID 分配。

后续只做 Contract 对齐、冲突消解、实现复用/重构和验证，不再重新设计这一批能力。