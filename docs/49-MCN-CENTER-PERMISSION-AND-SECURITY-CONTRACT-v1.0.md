# LuckRead MCN Center Permission and Security Contract v1.0

**状态：PERMISSION-SECURITY-CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：MCN Center 的身份、机构、资源、操作、数据、财务、版权、API 与审计安全边界。**

## 1. 安全原则

MCN Center 不是“登录后所有数据可见”的后台，而是多租户、资源级、操作级授权系统。

```text
Authenticated Actor
→ Organization Membership
→ Role
→ Permission
→ Resource Scope
→ Resource State
→ Policy
→ Allow / Deny
→ Audit
```

核心原则：
- 默认拒绝；
- 最小权限；
- 资源级授权；
- 职责分离；
- 敏感操作二次确认/增强认证；
- 所有授权判断服务端执行；
- 权限变化即时失效旧授权缓存；
- 安全事件可审计；
- 不暴露内部风险规则与 Payload internals。

## 2. Security Domains

P0 安全边界：

1. Identity / Authentication
2. Organization Isolation
3. Membership / RBAC
4. Resource Authorization
5. Content Operations
6. IP / Copyright / Rights
7. Audience / Privacy
8. Brand / Campaign
9. Financial / Settlement
10. Moderation / Risk
11. API / Integration Credentials
12. Audit / Governance
13. Session / Device Security
14. Data Export / Deletion

## 3. Actor Model

支持以下主体：

```text
User
Organization
Organization Member
Creator
Team
Service Account
Developer / Integration
Platform Operator
```

最终授权主体必须可追溯到 authenticated actor 或受控 service identity。

## 4. Organization Isolation

所有 MCN 数据访问必须具有 organization scope。

```text
request
→ organizationId
→ membership lookup
→ scope check
→ resource check
```

禁止：
- 仅根据 URL 中的 organizationId 信任客户端；
- 通过 creatorId/contentId 推断组织权限；
- 跨机构枚举资源；
- 通过错误响应差异泄露其他组织资源存在性。

## 5. RBAC Baseline

默认角色：

| Role | 核心职责 |
|---|---|
| Owner | 组织最高管理、关键权限、财务与组织生命周期 |
| Admin | 日常组织与成员管理 |
| Editor | 内容与素材运营 |
| Analyst | 数据分析与只读聚合 |
| Moderator | 审核、社区、安全运营 |
| Finance | 收益、结算、财务报表 |
| Developer | API、集成、技术配置 |

角色不是最终授权唯一依据，还必须检查 resource scope、action 和 resource state。

## 6. Permission Naming

统一：

```text
<domain>:<resource>:<action>
```

例如：

```text
mcn:organization:read
mcn:organization:update
mcn:member:invite
mcn:member:remove
mcn:role:grant
mcn:creator:read
mcn:creator:manage
mcn:content:read
mcn:content:edit
mcn:content:publish
mcn:content:bulk_manage
mcn:ip:read
mcn:ip:manage
mcn:rights:grant
mcn:rights:revoke
mcn:campaign:manage
mcn:analytics:read
mcn:finance:read
mcn:settlement:approve
mcn:audit:read
mcn:integration:manage
```

权限名称必须稳定、可版本化。

## 7. Scope Model

权限至少支持：

```text
Organization Scope
Team Scope
Creator Scope
Content Scope
IP Scope
Campaign Scope
Settlement Scope
```

例如 Editor 可以被限制为：

```text
Organization A
→ Team B
→ Creator C/D
→ assigned content only
```

不能因为拥有 `mcn:content:edit` 就获得全部机构内容。

## 8. Sensitive Role Separation

以下权限原则上不能由普通 Admin 自行授予自己：

- Owner
- Finance sensitive permissions
- Settlement approval
- Payout-related operations
- Rights ownership/grant/revoke
- Developer credential management
- Security policy administration

需要更高权限、双人审批或平台策略时，必须进入受控 workflow。

## 9. Financial Security

金融相关权限单独隔离：

```text
Finance Read
≠
Settlement Approve
≠
Payout Execute
```

资金事实必须来自 Ledger / Settlement domain。

禁止 MCN API：
- 直接修改 balance；
- 伪造 revenue；
- 绕过 settlement；
- 通过普通 content/campaign mutation 改变财务事实。

高风险金融操作必须：
- 强授权；
- idempotency；
- audit；
- version/concurrency check；
- 可追溯 actor；
- 必要时人工/双人审批。

## 10. Rights / Copyright Security

Rights 权限独立于普通 Content 编辑权限。

```text
Content Editor
≠ Rights Owner
≠ Rights Administrator
```

授权、撤销、许可范围修改必须经过 Rights domain。

必须保存：
- actor
- source/reference
- scope
- effective time
- expiry
- affected resource
- authorization basis

禁止通过删除普通 Content 关系来伪造版权撤销。

## 11. Content Security

Content 操作至少检查：

```text
Actor
→ Organization
→ Creator / Assignment
→ Content ownership / assignment
→ Lifecycle
→ Moderation state
→ Rights state
→ Action permission
```

例如：已删除、被版权限制、审核中的内容不能被普通 Editor 直接发布。

## 12. Creator Security

MCN 对 Creator 的管理权限来自合法 affiliation / assignment。

MCN：
- 可以管理其组织范围内的合作关系；
- 不得复制 Creator identity；
- 不得擅自修改 Creator 的平台身份权威字段；
- 不得因为机构权限自动获得 Creator 私人数据全部访问权。

Creator 可以拥有独立于 MCN 的个人权限与退出/争议流程。

## 13. Audience / Privacy

粉丝、成员、社区数据必须遵守最小访问原则。

默认：
- Analyst 只能看聚合；
- Editor 不获得完整隐私档案；
- Moderator 只获得处理任务所需数据；
- Finance 不因财务权限获得无关用户隐私；
- Developer 不默认获得生产用户数据。

个人数据导出必须：
```text
Purpose
→ Scope
→ Authorization
→ Audit
→ Controlled Export
```

## 14. Moderation / Risk Security

风险与审核决策属于受控域。

普通 MCN 用户只能看到安全的业务状态，例如：

```text
PENDING
RESTRICTED
REJECTED
RESTORED
```

不得暴露：
- 风险阈值；
- 模型分数；
- 规则权重；
- 反作弊检测逻辑；
- 安全探测细节。

对受限状态必须提供合适的申诉/恢复入口，但不能泄露安全机制。

## 15. API Credential Security

Developer / Integration 凭证必须独立管理。

要求：
- scoped credential；
- expiration；
- rotation；
- revocation；
- last-used metadata；
- audit；
- rate limiting；
- replay protection where applicable。

禁止把 access token、refresh token、secret 写入普通日志、事件或 analytics。

## 16. Service-to-Service Authorization

内部服务不得仅凭网络位置获得无限权限。

```text
Service Identity
→ Audience / Scope
→ Action Authorization
→ Audit where sensitive
```

消费者只能访问其职责需要的数据。

## 17. Session / Device Security

支持：
- session expiration；
- revocation；
- suspicious session detection；
- device/session listing；
- logout all sessions for privileged recovery；
- elevated-authentication timeout。

敏感操作应重新验证认证状态。

## 18. CSRF / Request Security

浏览器场景必须根据认证机制实施 CSRF 防护。

所有 mutation：
- schema validation；
- content-type validation；
- request size limits；
- origin checks where applicable；
- rate limits；
- idempotency；
- request ID。

## 19. Authorization Cache

允许缓存授权结果，但必须有明确失效策略：

```text
Role Change
Permission Change
Membership Removal
Scope Change
Credential Revocation
→ Authorization Cache Invalidation
```

安全相关权限不能依赖长期 stale cache。

## 20. Audit Contract

至少记录：

```text
auditId
actorId
organizationId
action
resourceType
resourceId
scope
result
reasonCode
requestId
correlationId
occurredAt
before/after reference where appropriate
```

敏感数据只保存必要引用，不把完整个人数据复制进 Audit。

不可由普通成员修改或删除 Audit。

## 21. Security Event Categories

至少产生安全审计事件：

```text
login failure
privileged login
role granted
role revoked
membership removed
scope changed
credential created
credential revoked
rights granted
rights revoked
settlement approved
payout-related action
bulk destructive action
export requested
export completed
moderation override
security policy changed
```

## 22. Bulk Operation Security

批量操作是高风险能力。

必须：

```text
Permission
→ Resource Scope
→ Operation Preview / Validation
→ Idempotency
→ Confirm where required
→ Task
→ Audit
→ Partial Result
→ Reconciliation
```

大规模删除、权限变更、版权操作、财务操作不得通过一个无确认的普通按钮完成。

## 23. Data Classification

建议最低分类：

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
```

示例：
- Public content metadata → PUBLIC/INTERNAL
- Organization operations → INTERNAL
- Revenue / contracts → CONFIDENTIAL
- credentials / sensitive personal data / security data → RESTRICTED

访问策略必须与分类绑定。

## 24. Data Export / Deletion

导出和删除都属于受控 mutation。

Export：
```text
Authorize
→ Scope
→ Generate Task
→ Audit
→ Expiring Access
```

Deletion：
```text
Authorize
→ Dependency Check
→ Rights / Retention Check
→ Task / Workflow
→ Audit
→ Reconciliation
```

不得因为 UI 删除按钮存在，就允许直接删除权威记录。

## 25. Security Failure Responses

安全失败统一采用安全错误模型：

```text
unauthenticated
forbidden
not found / safely indistinguishable where needed
conflict
rate limited
security review required
```

禁止通过错误消息泄露：
- 其他机构是否存在；
- 用户隐私；
- 内部权限结构；
- 风险模型；
- SQL/stack trace。

## 26. Security Observability

至少监控：
- authentication failures
- authorization denials
- privileged actions
- unusual export volume
- bulk operation anomalies
- credential creation/revocation
- settlement approvals
- rights changes
- moderation overrides
- cross-scope access attempts
- rate-limit violations

安全指标不得作为业务排名信号直接使用。

## 27. P0 Security Acceptance

必须可执行验证：

1. 无机构成员不能访问 MCN 资源；
2. A 机构成员不能读取 B 机构资源；
3. Editor 不能授予自己 Owner；
4. Analyst 不能修改内容；
5. Finance 不能因为财务权限读取无关隐私；
6. Rights 操作不能由普通 Content Editor 绕过执行；
7. Settlement approve 需要正确金融权限；
8. 权限撤销后授权缓存及时失效；
9. 重复敏感 mutation 不产生重复事实；
10. 批量删除可审计并支持恢复/失败处理；
11. API credential 可撤销；
12. secret 不进入普通日志/event；
13. export 需要明确授权并生成审计记录；
14. 风险规则和安全阈值不会泄露；
15. Audit 普通成员不可篡改；
16. service identity 不获得无限权限；
17. session revocation 生效；
18. Payload internals 不成为权限合同的一部分。

## 28. STOP Conditions

以下任一情况禁止进入 IMPLEMENTING：

1. 默认 Allow；
2. 只做角色检查、不做资源 Scope；
3. 跨组织资源可枚举；
4. 权限缓存没有失效机制；
5. 财务权限可以直接修改余额；
6. Rights 可以被普通 Content API 绕过；
7. Developer credential 无 scope/rotation/revocation；
8. Audit 可被普通成员删除/修改；
9. 敏感数据默认全员可读；
10. security/risk internals 暴露给客户端；
11. bulk destructive action 没有受控 workflow；
12. export 没有 scope/audit；
13. service-to-service 默认全权限；
14. security-sensitive mutation 没有 idempotency；
15. 无可执行 security acceptance。

## 29. READY Gate

```text
Identity PASS
→ Organization Isolation PASS
→ RBAC PASS
→ Resource Scope PASS
→ Sensitive Role Separation PASS
→ Financial Security PASS
→ Rights Security PASS
→ Privacy PASS
→ Credential Security PASS
→ Session Security PASS
→ Audit PASS
→ Bulk Operation Security PASS
→ Data Classification PASS
→ Export / Deletion PASS
→ Observability PASS
→ Acceptance PASS
→ PERMISSION-SECURITY-CONTRACT-READY
```

**结论：MCN Center Permission / Security Contract v1.0 完成。下一阶段进入 Test / Acceptance Contract；当前仍保持 IMPLEMENTATION PENDING。**
