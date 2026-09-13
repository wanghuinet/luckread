# LuckRead Security / Secret / Key Lifecycle / Incident Contract v1.0

**状态：P0 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一定义平台凭据、密钥、令牌、会话安全以及安全事件的创建、使用、轮换、撤销、泄露响应和恢复规则。

## 2. Secret Classes

至少区分：

```text
API_KEY
WEBHOOK_SECRET
OAUTH_CREDENTIAL
SESSION_SECRET
ENCRYPTION_KEY
THIRD_PARTY_CREDENTIAL
DEPLOYMENT_SECRET
RECOVERY_SECRET
```

## 3. Secret Lifecycle

```text
PROVISIONED
→ ACTIVE
→ ROTATION_DUE
→ ROTATED
→ REVOKED
→ RETIRED
```

Secret 不得永久有效而无 rotation / revoke 策略。

## 4. Storage Boundary

Secrets 必须只存在于受控 server-side secret storage。

禁止：

```text
source code
client bundle
public API response
ordinary logs
analytics payload
error message
```

## 5. Least Privilege

每个 secret 必须声明：

```text
owner
purpose
scope
environment
createdAt
expiresAt / rotation policy
revocation path
```

Production、staging、development credentials 必须隔离。

## 6. Rotation

轮换应支持：

```text
new credential provisioned
→ overlap window
→ consumers switched
→ old credential revoked
→ verification
```

不可热切换的凭据必须提供受控维护窗口和恢复方案。

## 7. Revocation

发现泄露、越权或异常使用时可立即撤销。

撤销传播必须覆盖：

```text
API
Webhook
Worker
Queue consumer
External integration
Cached authorization where applicable
```

## 8. Security Incident Severity

至少：

```text
S0 Critical compromise
S1 High-impact security incident
S2 Limited security incident
S3 Low-impact event
```

每级必须定义 notification、containment、response owner、closure criteria。

## 9. Incident State Machine

```text
DETECTED
→ TRIAGED
→ CONTAINING
→ CONTAINED
→ ERADICATING
→ RECOVERING
→ VERIFIED
→ CLOSED
```

可进入：

```text
REOPENED
```

## 10. Credential Compromise Response

```text
Detect
→ Revoke affected credential
→ Reduce scope / isolate principal
→ Preserve evidence
→ Identify affected resources
→ Rotate credentials
→ Verify clean state
→ Resume
```

不能只“换密码”而无影响范围核查。

## 11. Break-Glass

紧急管理员访问必须具备：

```text
explicit authorization
purpose
limited lifetime
minimum scope
full audit
post-incident review
```

## 12. Audit

安全敏感操作至少记录：

```text
actor
principal
secret/key reference
operation
scope
reason
requestId
correlationId
createdAt
result
```

日志不能记录 secret value。

## 13. External OSS Credentials

LiveKit、Search、Media Processing 等外部服务凭据必须走统一 secret lifecycle。

第三方故障或泄露不得迫使核心 Domain 暴露凭据或内部状态。

## 14. Token / Session Interaction

Token revocation 必须能够快速阻断高风险操作。

缓存不能长期绕过 session/credential revocation。

## 15. Detection / Anomaly

至少检测：

```text
unexpected source
unusual rate
scope escalation
repeated auth failure
credential reuse pattern
unexpected webhook signing failure
```

## 16. Data Protection

安全事件分析应遵循：

```text
minimum necessary data
purpose limitation
retention policy
redaction
access audit
```

## 17. Recovery

安全事件恢复后必须验证：

```text
credentials rotated
unauthorized sessions revoked
scope corrected
affected resources revalidated
integrity verified
monitoring restored
```

## 18. Performance / Availability

安全控制不能在普通路径中引入无界同步依赖。

检测系统故障时，敏感操作默认 fail closed；可安全公开读取可按策略 degraded。

## 19. Acceptance

P0 至少验证：

1. secret provisioning；
2. rotation；
3. revocation；
4. leaked credential response；
5. session invalidation；
6. break-glass audit；
7. external credential rotation；
8. telemetry redaction；
9. fail-closed sensitive action；
10. incident recovery verification。

## 20. STOP Conditions

- secret进入源码/日志；
- credential 无 rotation/revocation；
- 泄露后无法快速撤销；
- break-glass 无审批/审计；
- session/token revoked 后仍可执行敏感操作；
- 安全事件无 owner/状态机；
- 恢复后未验证完整性。

## 21. READY Gate

```text
Secret Classes
→ Storage
→ Least Privilege
→ Rotation
→ Revocation
→ Incident Severity
→ Containment
→ Recovery
→ Audit
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
