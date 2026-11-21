# LuckRead Feature Flag / Configuration / Policy Versioning Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一 Feature Flag、运行配置和 Policy Version 的 owner、作用域、发布、回滚、失效和审计语义。

## 2. Configuration Classes

```text
STATIC_CONFIG
RUNTIME_CONFIG
FEATURE_FLAG
POLICY_CONFIG
SECURITY_CONFIG
EXPERIMENT_CONFIG
```

每项必须有明确 owner 与作用域。

## 3. Required Record

```text
configId
name
version
owner
scope
environment
valueType
sensitivity
status
createdAt
updatedAt
expiresAt (where applicable)
rollbackVersion
```

敏感配置不得进入源码或公开 DTO。

## 4. Flag Lifecycle

```text
DRAFT
→ REVIEWING
→ APPROVED
→ ACTIVE
→ PAUSED
→ RETIRED
```

## 5. Rollout

Feature Flag 必须能表达：

```text
all
region
platform
app
organization
user cohort
percentage
```

高风险配置必须支持 kill switch。

## 6. Evaluation

配置读取必须：

```text
resolve scope
→ validate version
→ evaluate policy
→ return deterministic result
```

不同 Worker/Domain 不得各自实现同名 flag 的不同语义。

## 7. Versioning

Policy / config 语义变化必须递增版本。

历史结果需要可解释时必须保存当时的 `policyVersion`。

## 8. Compatibility

配置发布顺序必须兼容当前代码：

```text
Compatible code
→ Config / Flag rollout
→ Verify
→ Increase scope
→ Cleanup
```

禁止先发布只支持新配置语义的代码，再让旧配置长期存在。

## 9. Expiry

临时 Feature Flag 必须有 `expiresAt` 或明确永久批准理由。

过期 flag 必须进入 cleanup/retirement。

## 10. Security

以下变化属于 high-risk：

```text
authentication
authorization
payment
rights
moderation
risk thresholds
privacy
credential behavior
```

必须加强审批和审计。

## 11. Audit

每次变更至少记录：

```text
actor
configId
oldVersion
newVersion
scope
reason
approval
requestId
createdAt
```

## 12. Emergency Change

紧急修改必须：

```text
emergency reason
minimal scope
short lifetime
post-change review
rollback target
```

不得用 emergency 流程绕过长期治理。

## 13. Cache Interaction

Config cache 必须带 version，并支持快速失效。

高风险 policy 不得因 stale config 长时间使用旧安全规则。

## 14. Observability

监测：

```text
flag evaluation errors
config propagation lag
rollout scope
unexpected exposure
rollback activation
expired flags
```

## 15. Acceptance

验证 scoped rollout、deterministic evaluation、version pinning、kill switch、rollback、expiry、stale cache、high-risk approval、emergency path 和 audit。

## 16. STOP Conditions

- 无 owner/version；
- 同名配置语义不一致；
- 高风险 policy 可无审计修改；
- flag 永久存在无理由；
- stale config 绕过安全策略；
- rollback 无目标；
- rollout 范围不可验证。

## 17. READY Gate

```text
Class
→ Owner
→ Scope
→ Version
→ Rollout
→ Compatibility
→ Expiry
→ Security
→ Audit
→ Rollback
→ Acceptance Evidence
→ READY
```

## 18. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
