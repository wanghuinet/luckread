# LuckRead Platform Operations / Governance / Reliability Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Platform Operations 负责生产运行、发布、配置、可观测性、可靠性、故障处理、容量、成本、审计和平台治理。

LuckRead 的运行底座以 Cloudflare 为第一优先，不通过堆叠大型基础设施来解决已经由 Cloudflare 原生能力覆盖的问题。

Cloudflare Workers 原生提供 Workers、D1、KV、R2、Durable Objects、Queues、Workflows、Cache/CDN 等平台能力，因此这些能力默认优先于外部 OSS。 citeturn0search2turn0search11

## 2. Cloudflare-first 基础设施策略

默认架构：

```text
Cloudflare Workers
├── D1
├── R2
├── KV / Cache
├── Queues
├── Durable Objects (only when strong coordination is required)
├── Cron / Workflows where appropriate
└── Observability / Logs / Analytics
```

外部 OSS 只有在 Cloudflare 没有足够成熟的专业能力时才进入系统，并且必须通过 Adapter / API / Event boundary 接入。

## 3. OpenTelemetry Observability

**OpenTelemetry (OTel)** 作为跨服务、跨运行时的标准化 telemetry contract。OpenTelemetry 是 vendor-neutral 的开源 observability framework，覆盖 traces、metrics、logs，并提供 Collector 与多平台集成能力。 citeturn1search1turn1search10

目标链路：

```text
Worker / Payload / Processing Runtime / LiveKit Adapter
→ OpenTelemetry Instrumentation
→ Telemetry Export Boundary
→ Cloudflare / Compatible Observability Backend
```

规则：

- requestId / correlationId / traceId 必须可关联；
- 业务事件与 telemetry 分离；
- 不把密码、token、支付凭据、私密消息内容写入 telemetry；
- telemetry 故障不得阻塞业务请求；
- trace/metric/log 不是业务事实权威；
- 高流量路径必须有采样和成本预算；
- 外部 observability backend 可替换；
- Cloudflare 原生日志/analytics 足够时，不强制运行独立 OTel Collector。

## 4. Durable Workflow

优先使用 Cloudflare Queues / Workflows / Durable Objects 处理平台内部异步与协调。

当出现跨长时间、可恢复、需要 durable execution 的复杂业务流程时，可通过 Workflow Adapter 引入 **Temporal**。Temporal 的定位是 durable execution/workflow infrastructure，因此属于后置能力，而不是 Cloudflare v1 默认依赖。

```text
Business Domain
→ Workflow Contract
→ Cloudflare Queue / Workflow
              │
              └── complex durable workflow
                      ↓
                 Temporal Adapter (optional)
```

Temporal 不得成为 User/Content/Commerce/Ledger 等领域的事实权威。

## 5. Event Bus / Cache OSS 决策

### 5.1 NATS

NATS 作为高性能事件总线候选，但当前 Cloudflare Queues 已覆盖平台异步消息、削峰和可靠投递的主要需求，因此 v1 **不引入 NATS**。

只有当跨外部运行时、跨区域实时事件总线需求明显超过 Queues 边界时，才通过 Event Bus Adapter 评估 NATS。

### 5.2 Redis / Valkey

Redis/Valkey 作为通用高频缓存/协调候选，但 LuckRead 当前优先使用 Cloudflare Cache、KV 和 Durable Objects。外部 Redis/Valkey 不得作为 User/Content/Ledger 等事实权威。

只有在明确出现：

- Cloudflare Cache/KV 无法满足的复杂原子缓存需求；
- 外部运行时共享低延迟状态；
- LiveKit/其他专业基础设施的明确依赖；

时才建立 Adapter，并进行成本、网络和运维评估。

## 6. Release / Deployment

```text
GitHub
→ Contract / Code Review
→ CI
→ Build
→ Cloudflare Worker Version
→ Deployment
→ Smoke / Acceptance
→ Observability Verification
```

Cloudflare Workers 的版本与 deployment 是独立概念；发布系统必须保留版本、部署和回滚证据。 citeturn0search17

## 7. Reliability

必须支持：

- timeout
- retry with bounded attempts
- idempotency
- circuit/degraded mode where needed
- queue retry / DLQ
- replay
- backfill
- rollback
- incident evidence
- dependency isolation

外部 OSS 故障必须尽可能局部降级，不得自动扩散为全站不可用。

## 8. Cost Governance

每个外部 OSS 必须回答：

```text
为什么 Cloudflare 原生能力不够？
为什么这个 OSS 比自研更合理？
运行在哪里？
谁维护？
网络成本？
CPU/Memory 成本？
故障如何降级？
如何替换？
如何删除？
```

禁止为了“开源”而引入大型基础设施。

## 9. Integration Registry

当前基础设施决策：

| 能力 | 方案 | 状态 |
|---|---|---|
| Edge/API | Cloudflare Workers | Primary |
| SQL | Cloudflare D1 | Primary |
| Object Storage | Cloudflare R2 | Primary |
| Cache | Cloudflare Cache/KV | Primary |
| Async Queue | Cloudflare Queues | Primary |
| Strong Coordination | Durable Objects | Conditional |
| Live/RTC | LiveKit | Selected external OSS |
| Media Processing | FFmpeg | Selected processing OSS |
| Search | Meilisearch | Selected external search OSS |
| Vector Search | Cloudflare Vectorize first / Qdrant later | Reserved |
| Analytics | Cloudflare native first / PostHog adapter | Reserved |
| Observability | Cloudflare native + OpenTelemetry contract | Selected standard |
| Durable Workflow | Cloudflare Workflows first / Temporal later | Reserved |
| IAM/SSO | Payload Auth first / Keycloak later | Reserved |
| Commerce | Payload/D1 first / Medusa later | Reserved |
| Event Bus | Queues first / NATS later | Reserved |
| Cache/Coordination | Cache/KV/DO first / Redis/Valkey later | Reserved |

## 10. Security

- secrets never enter logs;
- external OSS credentials only in server-side secret management;
- adapters enforce authentication and authorization;
- dependency upgrades require compatibility/security review;
- public APIs never expose internal OSS schemas or credentials;
- audit sensitive administrative operations.

## 11. Acceptance

P0 必须验证：

1. Worker deployment version evidence;
2. logs/metrics/traces correlation;
3. queue failure/retry/DLQ;
4. dependency outage isolation;
5. rollback;
6. cache degradation;
7. search outage degradation;
8. media processing outage recovery;
9. LiveKit adapter outage isolation;
10. external OSS credential rotation;
11. observability privacy controls;
12. cost/latency budgets。

## 12. STOP

- 外部 OSS 成为未经批准的第二事实数据库；
- Cloudflare 已覆盖的能力被无理由重复部署；
- OSS 故障直接导致核心权威写入不可用；
- telemetry 泄露敏感数据；
- 没有 rollback/recovery evidence；
- 引入 NATS/Redis/Temporal/Keycloak/Medusa 等后无法解释其必要性；
- 没有 Adapter/API/Event boundary；
- 外部基础设施成本没有预算。

## 13. READY

```text
Architecture
→ Contract
→ Dependency / OSS Review
→ Security
→ Cost
→ Reliability
→ Observability
→ CI
→ Deployment
→ Rollback
→ User Acceptance
→ READY
```

当前：**IMPLEMENTATION PENDING**。
