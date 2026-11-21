# LuckRead Creator System Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System 权限、安全、隐私与高风险操作控制合同**

## 1. 安全模型

统一授权链：

```text
Authentication
→ Actor
→ Session / App Context
→ Scope
→ Creator Relationship
→ Capability
→ Domain Policy
→ Resource Permission
→ Audit
```

任何内部 Worker、Queue consumer、管理任务或 Creator Center 调用都不得天然绕过本链。

## 2. Actor Classes

| Actor | 默认能力 |
|---|---|
| Creator Owner | 管理自身 Creator 资料、受保护状态和授权范围内操作 |
| Creator Delegate | 仅拥有明确 delegation scope |
| Organization Operator | 仅所属组织范围 |
| Platform Support | 受控 support scope，禁止默认业务写入 |
| Platform Admin | 平台管理范围，必须审计 |
| Service Worker | 服务身份 + 最小机器权限 |
| External App | Open Platform scope，禁止直接存储访问 |

## 3. Scope Model

至少区分：

```text
creator.read
creator.profile.write
creator.qualify.read
creator.verify.request
creator.lifecycle.transition
creator.capability.read
creator.collaboration.write
creator.relationship.read
creator.audit.read
```

高风险 scope 必须单独授予，不通过通配符默认开放。

## 4. Resource Authorization

```text
Actor
→ Scope
→ creatorId relation
→ resource ownership / delegated access
→ action policy
```

用户拥有 User 账号不代表自动拥有任意 Creator。  
MCN 成员拥有组织成员资格不代表自动拥有全部 Creator。  
External App scope 不得绕过 Creator domain authorization。

## 5. Ownership / Delegation

支持：

- owner；
- delegated operator；
- organization scoped operator；
- temporary access；
- revocation；
- expiry。

Delegation 必须包含：

```text
grantor
recipient
scope
resource
issuedAt
expiresAt
revokedAt
reason
```

## 6. High-Risk Operations

以下必须执行增强控制：

- Creator ownership/affiliation change；
- lifecycle suspension/reinstatement；
- capability grant/revoke；
- verification revoke；
- bulk creator mutation；
- sensitive profile change；
- collaboration revenue-split reference change；
- account closure/deletion；
- administrative impersonation/support action。

控制链：

```text
Authentication
→ Authorization
→ Scope
→ Confirmation where required
→ Idempotency
→ Concurrency check
→ Audit
→ Mutation
```

## 7. Verification Security

身份/专业验证证据采用最小化原则：

```text
Client
→ controlled verification flow
→ provider / secure service
→ evidence reference
→ Creator verification state
```

普通 API 不返回原始身份文件、完整证件号或验证秘密。

## 8. Privacy Classes

```text
PUBLIC
CREATOR_PRIVATE
ORG_SCOPED
SUPPORT_CONTROLLED
ADMIN_ONLY
HIGH_SENSITIVITY
```

默认拒绝，只有明确 scope 才能升级可见性。

## 9. Sensitive Data Protection

禁止进入普通日志、事件和 telemetry：

- password；
- refresh/session tokens；
- recovery secrets；
- raw identity documents；
- full payment credentials；
- internal risk features；
- private security signals。

敏感字段必须 redaction / minimization。

## 10. Risk / Moderation Boundary

Creator System 不自行决定：

- 风险评分阈值；
- 欺诈判断；
- 内容违规判断；
- 排序降权规则；
- 版权法律结论。

这些由 Risk/Trust、Moderation、Rights 等 authority 提供结果。Creator System 只维护安全的 Creator-scoped state / projection。

## 11. Admin / Support Access

Support/Admin 不得通过数据库直写 Creator 状态。  
必须使用受控 control API，包含：

```text
actor
reason
scope
target
before/after summary
requestId
approval where required
timestamp
```

紧急操作必须支持事后审计与追责。

## 12. Session / Device Safety

必须支持：

- session expiry；
- suspicious session notification；
- re-authentication for high-risk action；
- session revocation reference；
- device/context awareness。

Creator API 不返回安全内部检测细节。

## 13. External App Security

External App 访问链：

```text
Developer
→ App
→ OAuth / App Authorization
→ Scoped Token
→ Creator API
→ Domain Authorization
```

禁止：

```text
External App → D1/R2/Payload internals
```

## 14. Audit

以下必须可审计：

- ownership change；
- verification action；
- capability action；
- lifecycle action；
- deletion；
- delegation grant/revoke；
- admin/support access；
- policy-sensitive mutation。

审计记录不得被普通 Creator API 修改或删除。

## 15. Reliability / Abuse Controls

必须覆盖：

```text
rate limit
quota
replay protection
idempotency
concurrency control
abuse detection
lockout / cooldown where justified
```

验证、申诉、生命周期变更等高成本操作必须设置独立 rate/quota。

## 16. Acceptance

P0 至少验证：

- actor 无权限时明确拒绝；
- owner 与 delegate scope 正确隔离；
- MCN scope 不越权；
- External App 不越权；
- admin action 可审计；
- high-risk action 可要求 re-auth/confirmation；
- sensitive evidence 不泄露；
- internal risk signals 不泄露；
- token/secret 不进入日志；
- replay 不产生重复 mutation；
- revocation 及时生效。

## 17. STOP

- 默认 allow；
- wildcard scope 授权全部 Creator；
- External App 直接访问存储；
- 管理员直接 DB 写入；
- 敏感证据进入 public DTO/event/log；
- Creator System 替代 Risk/Rights/Moderation 决策；
- 高风险操作无审计；
- delegation 无 expiry/revoke；
- 无 replay protection。

## 18. Status

```text
PERMISSION / SECURITY = COMPLETE
IMPLEMENTATION = PENDING
CL / CI = NOT RUN
```
