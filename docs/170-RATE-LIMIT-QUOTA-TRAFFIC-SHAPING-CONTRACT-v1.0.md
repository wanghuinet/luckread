# LuckRead Rate Limit / Quota / Traffic Shaping Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一平台请求、写入、上传、事件、Webhook、分析和高风险操作的流量保护语义。

## 2. Control Layers

```text
Edge
→ API
→ Principal
→ Resource / Operation
→ Domain
```

不同层级可独立限流，但不得发生语义冲突。

## 3. Limit Dimensions

支持：

```text
per-IP
per-user
per-app
per-organization
per-resource
per-operation
per-endpoint
per-region
```

限流 key 必须选择能表达真实风险的最小必要维度。

## 4. Burst vs Sustained

必须区分：

```text
BURST_LIMIT
SUSTAINED_LIMIT
CONCURRENCY_LIMIT
DAILY_QUOTA
MONTHLY_QUOTA
```

不能只使用单一 QPS 限制保护全部业务。

## 5. Quota vs Billing

```text
Quota = stability / fairness control
Billing = commercial accounting
```

二者不得互相替代。

## 6. Response Contract

被限流时应返回稳定错误语义，并在适用时提供：

```text
code
retryAfter
limit
remaining
resetAt
requestId
```

## 7. Emergency Throttle

Platform Operations 必须可以对异常流量执行：

```text
soft throttle
hard throttle
feature-specific throttle
principal quarantine
```

紧急限流必须可审计、可撤销。

## 8. Fairness

高频单一主体不得无限占用共享资源。

系统应避免低价值流量阻塞关键业务流量。

## 9. High-Risk Operations

以下操作应使用更严格限制：

```text
login / recovery
publish
payment / payout
bulk moderation
bulk export
credential rotation
API administration
```

## 10. Async Interaction

Queue backlog 不得简单通过丢弃关键事件解决。

高吞吐非关键事件可降采样/聚合，但必须符合事件合同。

## 11. Cost

限流策略应同时考虑：

```text
Worker execution
D1 reads/writes
R2 operations
Queue volume
external dependency cost
```

## 12. Observability

监测：

```text
limit hits
429 rate
queue depth
concurrency saturation
quota exhaustion
emergency throttle activation
```

## 13. Acceptance

验证 burst、sustained、per-user、per-app、per-org、concurrency、retryAfter、emergency throttle、quota isolation、high-risk protection。

## 14. STOP Conditions

- 高风险操作无保护；
- quota 被当成 billing truth；
- 429 无稳定机器语义；
- 限流配置无法审计/回滚；
- 单一主体可以长期压垮共享资源。

## 15. READY Gate

```text
Dimensions
→ Burst/Sustained
→ Quota Semantics
→ Error Response
→ Fairness
→ Emergency Control
→ Observability
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
