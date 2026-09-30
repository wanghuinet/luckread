# LuckRead MCN Center L1-L4 可追溯与契约准入矩阵 v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**  
**定位：MCN Center 的实现准入层；本文件不直接授权业务代码实现。**

## 1. 目标

本文件承接 `44-MCN-CENTER-EXPERIENCE-AND-OPERATING-SYSTEM-CONTRACT-v1.0.md`，把 MCN Center 从产品体验契约进一步收敛到可实现、可测试、可审计的 L1→L4 责任链。

原则：

```text
MCN Journey
→ L1 Domain
→ L2 Capability
→ L3 Responsibility
→ L4 Atomic Responsibility
→ Data Contract
→ API Contract
→ Event Contract
→ Permission / Security
→ Privacy / Rights / Risk
→ Cost / Runtime
→ Test / Acceptance
→ READY
```

MCN Center 与 Creator Center 必须共享身份、内容、IP、权限、事件、Ledger 等领域契约，但不得形成第二套互相冲突的权威状态。

## 2. L1 主域

| L1 | 核心职责 | 关键权威状态 |
|---|---|---|
| Organization / MCN | 机构、成员、团队、组织关系 | organization / membership |
| Creator | 创作者归属、合作关系、状态 | creator / creator-affiliation |
| Creator Studio | 内容生产与发布工作台 | content / draft / task |
| Creator Growth | 机构视角的创作者成长 | growth-plan / derived metrics |
| Content | 机构内容管理 | content lifecycle |
| Media | 机构素材与媒体引用 | media / asset reference |
| IP Graph / IP Economy | IP、作品、授权、合作 | IP / rights relation |
| Audience / Community | 粉丝、会员、社区经营 | relationship / membership |
| Brand Collaboration | 商务合作 | campaign / collaboration |
| Advertising | 广告资产与投放协作 | campaign / delivery |
| Monetization / Commerce | 商业化 | order / entitlement / revenue |
| Wallet / Ledger | 收益、分成、结算 | ledger entries |
| Analytics | 机构、Creator、Content、IP 数据 | derived analytics |
| Safety / Risk / Moderation | 风险、审核、处罚、申诉 | enforcement decision |
| Copyright / Rights | 权属、授权、版权事件 | rights / provenance |
| Platform / Open Ecosystem | API、应用、开发者能力 | app / integration |
| Audit / Governance | 敏感操作、合规证据 | audit records |

## 3. L2→L3→L4 核心映射

### 3.1 机构与成员

**L2：Organization Management**

- L3 创建/认证机构
  - L4 创建机构档案
  - L4 验证机构状态
  - L4 处理机构审核结果
- L3 成员管理
  - L4 邀请成员
  - L4 接受/拒绝邀请
  - L4 移除成员
  - L4 查看成员状态
- L3 角色与权限
  - L4 创建角色绑定
  - L4 分配角色
  - L4 回收权限
  - L4 校验敏感操作权限
- L3 团队协作
  - L4 创建团队
  - L4 分配 Creator
  - L4 分配内容任务
  - L4 查看任务状态

### 3.2 Creator 管理

**L2：Creator Relationship**

- L3 招募
  - L4 创建邀请
  - L4 接受/拒绝合作
  - L4 记录合作状态
- L3 Creator 归属
  - L4 绑定 Creator
  - L4 解除绑定
  - L4 处理归属冲突
- L3 Creator 生命周期
  - L4 active
  - L4 suspended
  - L4 terminated
  - L4 appeal/review
- L3 Creator 经营视图
  - L4 内容规模
  - L4 粉丝增长
  - L4 收益摘要
  - L4 IP 摘要

### 3.3 内容运营

**L2：Content Operations**

- L3 内容发现
  - L4 搜索
  - L4 筛选
  - L4 排序
- L3 内容状态
  - L4 draft
  - L4 processing
  - L4 moderation pending
  - L4 scheduled
  - L4 published
  - L4 restricted
  - L4 archived/deleted
- L3 批量运营
  - L4 批量选择
  - L4 批量修改
  - L4 批量发布/下线
  - L4 幂等保护
  - L4 操作审计
- L3 内容任务
  - L4 创建任务
  - L4 更新进度
  - L4 失败恢复
  - L4 任务重试

### 3.4 素材中心

**L2：Asset Operations**

- L3 Asset Library
  - L4 上传引用
  - L4 元数据查询
  - L4 标签
  - L4 搜索
  - L4 删除/归档
- L3 权属与引用
  - L4 记录 owner
  - L4 记录 provenance
  - L4 校验引用关系
  - L4 阻止非法删除

### 3.5 IP 与版权

**L2：IP Operations**

- L3 IP 管理
  - L4 创建/编辑 IP
  - L4 关联 Creator
  - L4 关联作品
- L3 授权
  - L4 创建授权
  - L4 校验授权范围
  - L4 到期处理
  - L4 撤销授权
- L3 Remix / Derivative
  - L4 记录来源
  - L4 校验 derivative authorization
  - L4 保存 provenance
- L3 Copyright Incident
  - L4 创建事件
  - L4 限制相关内容
  - L4 提交申诉
  - L4 记录处理结果

### 3.6 粉丝、会员、社区

**L2：Audience Operations**

- L3 粉丝经营
  - L4 粉丝查询
  - L4 分群
  - L4 互动摘要
- L3 会员
  - L4 membership 状态
  - L4 entitlement 查询
  - L4 变更事件
- L3 社区
  - L4 评论管理
  - L4 社区成员管理
  - L4 moderator action

### 3.7 商务与广告

**L2：Business Operations**

- L3 Brand Collaboration
  - L4 创建合作机会
  - L4 brief
  - L4 proposal
  - L4 approval
  - L4 delivery
  - L4 attribution
- L3 Campaign
  - L4 创建 campaign
  - L4 targeting reference
  - L4 delivery state
  - L4 pause/resume
- L3 Commerce
  - L4 product/reference binding
  - L4 order reference
  - L4 entitlement
  - L4 refund state

所有资金事实必须由 Ledger 权威化，MCN Center 只能发起命令或读取聚合结果。

### 3.8 收益与结算

**L2：Revenue & Settlement**

- L3 Revenue Attribution
  - L4 记录来源
  - L4 记录 creator share
  - L4 记录 organization share
- L3 Settlement
  - L4 settlement period
  - L4 statement generation
  - L4 reconciliation
  - L4 payout status
- L3 Dispute
  - L4 创建争议
  - L4 冻结相关结算
  - L4 处理结果

禁止：

```text
MCN UI
→ 直接修改 balance
```

必须：

```text
Business Event
→ Ledger
→ Reconciliation
→ Settlement
→ Read Model
```

### 3.9 数据中心

**L2：MCN Analytics**

- L3 Creator Analytics
  - L4 content performance
  - L4 audience growth
  - L4 retention
- L3 Content Analytics
  - L4 exposure
  - L4 consumption
  - L4 engagement
- L3 IP Analytics
  - L4 work scale
  - L4 audience
  - L4 commercial performance
- L3 Organization Analytics
  - L4 creator portfolio
  - L4 revenue summary
  - L4 operational efficiency

派生指标必须标记来源、时间窗口、版本和计算口径，并支持重建/对账。

### 3.10 风控、审核、版权

**L2：Governance Operations**

- L3 Moderation
  - L4 submit review
  - L4 review result
  - L4 restriction
  - L4 restoration
- L3 Risk
  - L4 risk signal reference
  - L4 enforcement action
  - L4 appeal
- L3 Copyright
  - L4 ownership check
  - L4 rights conflict
  - L4 takedown
  - L4 appeal

内部风控/排序阈值不得通过 MCN UI 暴露。

## 4. API Contract

所有 MCN API 必须使用稳定版本前缀，例如：

```text
/v1/mcn/organizations
/v1/mcn/members
/v1/mcn/creators
/v1/mcn/content
/v1/mcn/assets
/v1/mcn/ip
/v1/mcn/audience
/v1/mcn/collaborations
/v1/mcn/campaigns
/v1/mcn/analytics
/v1/mcn/settlements
/v1/mcn/tasks
/v1/mcn/audit
```

统一要求：

- request ID；
- actor identity；
- organization context；
- authorization；
- DTO validation；
- idempotency key for mutations；
- cursor pagination；
- stable error model；
- rate limiting；
- optimistic concurrency where required；
- no Payload internal model leakage；
- no direct client access to authoritative ledger/risk internals。

## 5. Event Contract

MCN 业务动作必须通过领域事件连接异步系统，例如：

```text
mcn.created
mcn.member.invited
mcn.member.joined
mcn.member.role_changed
creator.attached_to_mcn
creator.detached_from_mcn
content.assigned_to_team
content.published
content.restricted
asset.referenced
ip.linked
rights.changed
campaign.created
campaign.delivered
revenue.attributed
settlement.created
settlement.reconciled
settlement.paid
moderation.completed
copyright.incident_created
```

事件必须包含：

- eventId；
- eventType；
- eventVersion；
- actorId；
- organizationId；
- target reference；
- occurredAt；
- correlationId；
- requestId；
- source；
- idempotency/deduplication information。

高频曝光、播放、互动等不得直接成为收益、成长或推荐的权威事实，必须经过 Trust/Risk/Validation/Aggregation。

## 6. Permission / Security Contract

权限采用：

```text
Organization
→ Team
→ Role
→ Permission
→ Resource Scope
→ Action
```

至少支持：

- Owner
- Admin
- Editor
- Analyst
- Moderator
- Finance
- Developer

敏感操作必须满足：

```text
Authentication
→ Authorization
→ Scope Check
→ Confirmation if required
→ Idempotency
→ Audit
```

高风险操作包括：

- Creator 归属变更；
- 大批量内容删除/下线；
- 版权授权；
- 财务/结算；
- 成员权限提升；
- API credential；
- 广告投放；
- 机构解散/冻结。

## 7. Data Ownership

权威状态必须唯一归属：

| 数据 | Authority |
|---|---|
| Organization | Organization domain |
| Membership | Organization domain |
| Creator identity | Creator domain |
| Content | Content domain |
| Media | Media domain |
| IP | IP domain |
| Rights | Rights domain |
| Audience relationship | Social/Audience domain |
| Campaign | Business/Advertising domain |
| Revenue fact | Ledger domain |
| Settlement | Ledger/Settlement domain |
| Moderation decision | Safety/Moderation domain |
| Analytics | Derived analytics domain |

MCN Center 是**操作与聚合层**，不是新的权威数据库。

## 8. Idempotency / Consistency

所有以下操作必须幂等：

- invite member；
- attach creator；
- assign content；
- batch publish；
- batch delete；
- create campaign；
- submit settlement；
- payout request；
- rights grant/revoke。

禁止重复提交导致：

- 重复 Creator 绑定；
- 重复发布；
- 重复扣款；
- 重复收益；
- 重复结算；
- 重复授权。

## 9. Cost / Runtime Contract

MCN Dashboard 不得每次请求实时扫描全部 Creator、Content、Event。

采用：

```text
Authoritative State
→ Domain Event
→ Queue / Aggregation
→ Derived Read Model
→ Cache
→ Dashboard
```

高频数据采用聚合窗口；可重建数据不得被当成唯一事实。

## 10. Audit Contract

必须记录：

- actor；
- organization；
- action；
- target；
- before/after summary；
- timestamp；
- request/correlation ID；
- result；
- failure reason where applicable。

财务、版权、权限、审核、批量运营操作必须可审计。

## 11. Acceptance Matrix

P0 必须验证：

- MCN 登录后可看到机构 Dashboard；
- 可邀请/管理 Creator；
- 可管理团队与权限；
- 可查看和运营内容；
- 可执行受保护的批量操作；
- 可管理素材；
- 可查看 IP 与版权状态；
- 可管理粉丝/会员/社区；
- 可管理品牌合作；
- 可查看商业化数据；
- 收益与结算可追溯；
- 风险/审核状态可恢复；
- 所有敏感操作有审计；
- 重复提交不会造成重复业务事实；
- Dashboard 在高数据量下不依赖全表扫描；
- Web/H5 与移动端保持关键状态连续；
- 失败时保留工作并提供恢复路径。

## 12. Admission STOP Conditions

以下任一情况禁止进入 IMPLEMENTING：

1. MCN 新增能力没有 L1/L2/L3/L4 映射；
2. 权威状态不明确；
3. MCN Center 创建第二套 Creator/Content/IP/Ledger 权威状态；
4. 钱流绕过 Ledger；
5. 权利关系没有 provenance；
6. 批量操作没有幂等；
7. 权限没有 resource scope；
8. 敏感操作没有 audit；
9. 高并发数据直接实时扫描全量明细；
10. 派生指标不能重建/对账；
11. API 暴露 Payload 内部实现；
12. 风控/排序内部规则通过 UI 泄露；
13. 失败状态没有 recovery path；
14. P0 没有 executable acceptance test。

## 13. Implementation Gate

```text
MCN Experience Contract
→ L1/L2/L3/L4 Traceability PASS
→ Data Contract PASS
→ API Contract PASS
→ Event Contract PASS
→ Permission/Security PASS
→ Privacy/Rights/Risk PASS
→ Cost/Runtime PASS
→ Observability/Audit PASS
→ Test/Acceptance PASS
→ READY
→ Implementation
→ Local PASS
→ CI PASS
→ User Acceptance PASS
→ DONE
```

## 14. 当前结论

本文件完成 MCN Center 从“产品功能列表”到“实现准入合同”的第一阶段闭环。

当前允许：架构评审、Data/API/Event/Permission 合同细化。

当前禁止：在合同未闭环前直接大规模编写 MCN 业务代码。

**目标不是做一个比 YouTube/TikTok 多几个菜单的后台，而是建立机构级 Creator + Content + IP + Business Operating System。**
