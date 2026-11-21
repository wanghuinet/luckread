# LuckRead Observability / SLI / SLO / Error Budget Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一平台 telemetry、SLI、SLO、告警、错误预算和隐私脱敏语义，使可靠性可以量化、比较和审计。

## 2. Three Layers

```text
Telemetry = observation
SLI = measured indicator
SLO = target
Error Budget = allowed unreliability
```

Observability 数据不是业务事实 authority。

## 3. Required Correlation

关键请求/异步链至少支持：

```text
requestId
correlationId
traceId
operationId
resourceId
```

## 4. SLI Families

至少覆盖：

```text
availability
latency
error rate
success rate
freshness
queue lag
recovery time
data convergence
```

按业务域增加 specialized SLI。

## 5. SLO

P0 服务必须声明：

```text
indicator
measurement window
target
degraded threshold
owner
```

不得以“稳定”作为无指标描述。

## 6. Error Budget

SLO 未达标时：

```text
consume budget
→ risk review
→ release / feature decision
→ remediation
```

业务功能扩张不得无限消耗可靠性预算而无治理动作。

## 7. Alerting

告警应区分：

```text
PAGE
TICKET
INFO
```

告警必须避免噪声放大并包含 owner / action。

## 8. Sampling

高流量路径允许采样，但：

- 关键安全/审计证据不得因普通采样策略丢失；
- 采样率必须可解释；
- PII redaction 在采样前后都必须成立。

## 9. Privacy / Redaction

禁止 telemetry 包含：

```text
password
token
payment credentials
recovery secrets
private message body
unnecessary personal data
```

## 10. Dependency Observability

外部 OSS 至少应可观测：

```text
availability
latency
error rate
retry
quota
cost where available
```

## 11. Release / Regression

重要发布必须比较：

```text
before
vs
canary / after
```

发现 SLO regression 时触发回滚或 remediation policy。

## 12. Cost

Telemetry 本身必须有：

```text
retention policy
sampling policy
ingestion budget
storage budget
```

## 13. Acceptance

验证 request correlation、latency SLI、availability SLO、queue lag、dependency outage alert、PII redaction、sampling、release regression、error-budget action。

## 14. STOP Conditions

- 关键路径无可观测关联；
- SLO 无指标/窗口/目标；
- telemetry 泄露敏感数据；
- 告警无 owner/action；
- 采样导致关键安全/审计证据丢失；
- telemetry 成为业务同步依赖。

## 15. READY Gate

```text
Correlation
→ SLI
→ SLO
→ Error Budget
→ Alerting
→ Privacy
→ Sampling
→ Dependency
→ Cost
→ Acceptance Evidence
→ READY
```

## 16. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
