# LuckRead Global Scope / Tenant / Organization Isolation Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义 User、Creator、MCN、Merchant、Advertiser、Developer、Support、Platform Operator 等多角色场景下的身份、组织、租户、资源与授权边界，防止跨主体数据泄露或越权操作。

## 2. Scope Hierarchy

默认 scope 层级：

```text
PLATFORM
  → ORGANIZATION / TENANT
    → TEAM / PROJECT / APP
      → USER / SUBJECT
        → RESOURCE
```

具体 Domain 可以裁剪层级，但必须明确继承和边界。

## 3. Identity vs Scope

```text
Authentication = who are you?
Scope = which boundary are you acting in?
Authorization = what may you do here?
```

知道 `userId` / `resourceId` 不等于拥有访问权限。

## 4. Principal Types

至少支持：

```text
END_USER
CREATOR
ORG_OWNER
ORG_ADMIN
TEAM_MEMBER
MERCHANT
ADVERTISER
DEVELOPER
SUPPORT_AGENT
PLATFORM_OPERATOR
PLATFORM_ADMIN
SYSTEM_WORKER
```

`SYSTEM_WORKER` 不得天然拥有所有业务权限。

## 5. Resource Scope

每个敏感资源必须声明：

```text
ownerType
ownerId
tenantId where applicable
visibility
accessPolicy
```

## 6. Authorization Model

统一请求链：

```text
Authentication
→ Principal
→ Active Scope
→ Resource Resolution
→ Domain Authorization
→ Policy / Risk Check
→ Action
→ Audit
```

Domain authorization 是最终业务允许条件。

## 7. Delegation

组织/团队允许委托角色，但必须：

```text
grant
→ effective time
→ scope
→ permissions
→ expiry / revoke
→ audit
```

不得出现无限期隐式管理员权限。

## 8. Support / Break-Glass

Support 或 Platform Operator 的特殊访问必须使用：

```text
explicit approval
limited scope
purpose
short lifetime
full audit
```

Break-glass 使用后必须记录开始、结束、目标资源和结果。

## 9. Cross-Tenant Deny

默认规则：

```text
No explicit cross-tenant grant
→ DENY
```

不得依赖前端隐藏字段、URL 不可猜测或数据库查询条件偶然实现隔离。

## 10. Organization Membership Lifecycle

```text
INVITED
→ ACTIVE
→ SUSPENDED
→ REMOVED
```

成员离开/移除后必须及时失效旧 scope/session/token。

## 11. Resource Transfer

Creator、Merchant、Developer App 等资源发生所有权转移时必须：

```text
verify current owner
→ authorize transfer
→ update authoritative owner
→ revoke stale delegated access
→ propagate
→ audit
```

转移不能复制出两个最终 owner。

## 12. Service-to-Service Authorization

内部服务/Queue consumer/Workflow worker 必须带有最小必要 service scope。

```text
Internal = trusted transport
≠ unlimited business authority
```

## 13. Public API / OAuth Scope

第三方 App scope 必须映射到：

```text
App
→ User consent where required
→ App scope
→ Resource scope
→ Domain authorization
```

App scope 不能绕过资源拥有者授权。

## 14. Privacy Boundary

聚合 Center 不得因为拥有跨域读取能力而突破原 Domain privacy policy。

敏感字段访问必须与业务动作绑定，不得只依赖 broad read role。

## 15. Cache / Token Interaction

授权结果不得长期依赖 stale cache。

scope/revocation/role changes 必须有快速失效机制。

## 16. Audit

高风险 scope 变化至少记录：

```text
actor
principal
scope
resource
action
reason
approval
requestId
correlationId
createdAt
```

## 17. Failure / Recovery

权限系统故障时默认：

```text
FAIL CLOSED for sensitive operations
```

可安全降级的公开读取可以使用经过合同允许的缓存，但不得扩大访问边界。

## 18. Observability

监测：

```text
authorization deny rate
cross-scope deny
stale permission usage
role change propagation lag
break-glass usage
credential revocation lag
```

日志必须脱敏。

## 19. Acceptance

P0 至少验证：

1. user isolation；
2. organization isolation；
3. team role scope；
4. resource owner access；
5. delegated role expiry；
6. removed member revocation；
7. cross-tenant deny；
8. support break-glass；
9. OAuth scope + domain authorization；
10. stale authorization cache；
11. resource transfer；
12. service worker least privilege。

## 20. STOP Conditions

- cross-tenant access can pass by ID knowledge；
- internal worker has implicit universal authority；
- role removal does not revoke access；
- break-glass has no approval/audit；
- App scope bypasses domain authorization；
- stale cache grants sensitive access；
- resource transfer leaves duplicate owners。

## 21. READY Gate

```text
Principal
→ Scope Hierarchy
→ Resource Ownership
→ Authorization
→ Delegation
→ Revocation
→ Break-glass
→ Privacy
→ Audit
→ Failure Closed
→ Acceptance Evidence
→ READY
```

## 22. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
