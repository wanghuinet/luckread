# LuckRead Platform Operations L1-L4 Traceability & Contract Admission v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**

## 1. 目的

本文件将 `71-PLATFORM-OPERATIONS-GOVERNANCE-RELIABILITY-CONTRACT-v1.0.md` 从平台架构合同提升为可执行的 L1-L4 能力追踪与准入合同。

原则：

- L1 定义平台能力域；
- L2 定义可独立验收的能力组；
- L3 定义系统能力；
- L4 定义可实现、可测试、可审计的最小能力单元；
- 每个 L4 必须能够追踪到 Data / API / Event / Permission / Security / Runtime / Cost / Test；
- 未完成链路的能力不得进入 IMPLEMENTATION。

## 2. Platform Operations L1

**L1-40 Platform / Open Ecosystem / Operations**

Platform Operations 是跨业务域的运行治理层，不拥有 User、Content、Creator、Commerce、Wallet/Ledger 等业务事实。

## 3. L1-L4 Traceability Matrix

| L2 | L3 | L4 | Data | API / Control | Event | Security / Permission | Runtime | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Operations | Deployment | version tracking | deployment/version metadata | deployment control | deployment.started/completed/failed | operator authorization | Workers deployment | version evidence + rollback |
| Operations | Release | release promotion | release metadata | release control | release.promoted/rolled_back | release permission | CI → Workers | smoke + rollback |
| Operations | Configuration | config lifecycle | config metadata | config read/write | config.changed | secret/config separation | Workers/KV/secrets | change audit |
| Observability | Telemetry | trace correlation | telemetry metadata | telemetry export | trace/metric/log emitted | redaction policy | OTel/Cloudflare | correlation verified |
| Observability | Logging | structured logs | log metadata | log query/export | log emitted | secret redaction | Workers/runtime | privacy test |
| Observability | Metrics | SLI metrics | metric definitions | metrics export | metric sample | access control | Cloudflare/OTel | SLI evidence |
| Reliability | Timeout | bounded execution | timeout policy | timeout configuration | timeout event where needed | abuse protection | Workers/Queue | timeout test |
| Reliability | Retry | bounded retry | retry state | retry policy | retry scheduled/exhausted | idempotency required | Queues/Workflows | duplicate test |
| Reliability | Idempotency | operation dedupe | idempotency key/state | idempotent API | dedupe result | caller authorization | D1/DO/Queue | replay test |
| Reliability | Failure Isolation | dependency degradation | dependency health state | degraded-mode control | dependency.failed/recovered | boundary enforcement | Adapter/runtime | outage isolation |
| Reliability | Queue Recovery | retry/DLQ | task state | queue controls | retry/dead-letter | consumer authorization | Queues | DLQ recovery |
| Reliability | Replay | event/task replay | replay metadata | replay control | replay.started/completed | operator scope | Queue/Worker | deterministic replay |
| Reliability | Backfill | historical repair | backfill job state | backfill control | backfill.started/completed | elevated permission | Worker/Workflow | reconciliation |
| Reliability | Rollback | deployment rollback | deployment state | rollback control | rollback.started/completed | release operator scope | Workers | rollback evidence |
| Incident | Incident Management | incident lifecycle | incident record | incident control | incident.opened/updated/resolved | operator RBAC | D1 + Worker | incident evidence |
| Capacity | Capacity Governance | threshold policy | capacity metrics | alert/control | threshold crossed | operator policy | Cloudflare metrics | threshold test |
| Cost | Cost Governance | budget policy | cost budget/usage | budget control | budget.threshold | finance/operator scope | Cloudflare billing data | budget evidence |
| Governance | Audit | administrative audit | audit record | audit query | audit event | immutable/audited access | D1 | audit completeness |
| Governance | Dependency | OSS registry | dependency metadata | dependency approval | dependency.changed | security review | Adapter boundary | registry evidence |
| Governance | Compatibility | upgrade validation | compatibility matrix | upgrade gate | compatibility.checked | change authorization | CI/runtime | upgrade test |
| Security | Secret Management | secret lifecycle | secret metadata, not secret value | secret binding | rotation event | least privilege | Worker secrets | rotation test |
| Security | Privacy | telemetry/data classification | classification metadata | redaction controls | privacy violation alert | privacy policy | all runtimes | leakage test |
| Security | Supply Chain | dependency security | SBOM/advisory metadata | admission gate | dependency.alert | security approval | CI | vulnerable dependency gate |
| Platform | SLO/SLA | service objectives | SLO/SLI definitions | status endpoint/control | SLO breach | operator access | Cloudflare/OTel | objective evidence |

## 4. Authority Boundary

Platform Operations may record operational facts, but must not become a second domain authority.

```text
User facts        → User Identity domain
Content facts     → Content domain
Creator facts     → Creator domain
Commerce facts    → Commerce domain
Financial facts   → Wallet / Ledger domain
Media objects     → R2 + Media domain
Operational facts → Platform Operations
Telemetry         → Observability system
```

Operational metadata may reference a domain resource, but may not silently replace its authoritative state.

## 5. API / Control Admission

任何 L4 API 或控制面必须定义：

1. owner;
2. stable identifier;
3. request/response schema;
4. authentication;
5. authorization scope;
6. idempotency requirement;
7. timeout/retry semantics;
8. audit requirement;
9. privacy classification;
10. error model;
11. rate/quota policy;
12. acceptance test;
13. rollback/recovery behavior where applicable。

内部运维控制不得因为“内部 API”而绕过权限、审计或幂等要求。

## 6. Event Admission

平台事件必须至少包含：

```text
eventId
eventType
schemaVersion
occurredAt
producer
resourceRef
correlationId
idempotencyKey / dedupe strategy
delivery semantics
```

事件用于传播事实，不替代事实权威。

## 7. Reliability Admission

所有高频或异步路径必须回答：

```text
What can fail?
→ timeout?
→ retry?
→ duplicate?
→ out-of-order?
→ poison message?
→ DLQ?
→ replay?
→ backfill?
→ rollback?
→ dependency outage?
```

若答案缺失，L4 不得进入 READY。

## 8. Cloudflare Runtime Admission

默认运行链：

```text
Request
  ↓
Worker
  ├─ D1 authoritative state
  ├─ R2 object state
  ├─ Cache/KV derived/hot state
  ├─ Queue asynchronous work
  ├─ Durable Object strong coordination when required
  └─ Workflows durable execution when appropriate
```

外部 OSS 必须经过 Adapter / API / Event boundary。

禁止业务代码直接依赖外部 OSS 私有 schema 作为长期合同。

## 9. Observability Admission

每个关键请求/任务至少能够关联：

```text
requestId
correlationId
traceId
operation
owner
result
latency
failure classification
```

禁止记录密码、token、支付凭据、私密消息正文等敏感内容。

Telemetry 不得阻塞核心业务路径。

## 10. Deployment / Rollback Admission

发布链必须能够证明：

```text
source commit
→ build artifact
→ Worker version
→ deployment
→ smoke result
→ observability result
→ rollback target
```

Rollback 必须是已定义、可执行、可验证的控制，而不是文档中的人工口头步骤。

## 11. External OSS Admission

外部 OSS 进入生产前必须存在：

- capability justification;
- owner;
- Adapter/API/Event boundary;
- data classification;
- authentication/credential policy;
- failure isolation;
- cost budget;
- upgrade policy;
- replacement/removal plan;
- acceptance evidence。

当前已选外部能力遵循 71 主合同：LiveKit、FFmpeg、Meilisearch、OpenTelemetry；PostHog、Temporal、Qdrant、NATS、Redis/Valkey、Keycloak、Medusa 等仍按各自合同处于保留/后置状态。

## 12. STOP Conditions

任一条件成立即 STOP：

- L1/L2/L3/L4 无法追踪；
- L4 没有 Data/API/Event/Test 定义；
- Platform Operations 成为业务事实第二权威；
- 内部控制绕过权限或审计；
- retry 无幂等策略；
- queue 无 DLQ/recovery 策略；
- release 无 rollback evidence；
- telemetry 泄露敏感数据；
- 外部 OSS 无边界或无故障隔离；
- 生产依赖无成本预算；
- dependency upgrade 无安全/兼容性门；
- 任何未批准能力直接进入 IMPLEMENTATION。

## 13. READY Gate

```text
L1
→ L2
→ L3
→ L4
→ Data Contract
→ API / Control Contract
→ Event Contract
→ Permission / Security
→ Runtime Boundary
→ Reliability
→ Observability
→ Cost
→ Test / Acceptance
→ CI
→ Deployment
→ Rollback
→ READY
```

**当前状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**

本文件更新不执行 CL/CI；CL/CI 在文档链完成后统一验证。