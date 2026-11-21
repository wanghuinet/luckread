# LuckRead Platform Operations Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**父域：71 Platform Operations / Governance / Reliability**

## 1. 定位

Platform Operations Center 是平台工程、SRE、运营与授权管理员的统一运行控制工作台，负责发布、环境、配置、容量、健康度、告警、故障、成本、审计与治理状态的统一体验。

本中心是运行控制与观测体验层，不创建任何业务域权威，不直接修改业务数据库事实，不替代 Cloudflare、Payload 或业务 Domain 的原生权威。

## 2. Benchmark / Superiority

借鉴大型互联网平台的控制台、SRE/运营中心和发布平台经验，目标是：状态统一、告警可行动、变更可审计、故障可定位、恢复可执行、容量与成本可见、危险操作有保护。

核心原则：

`Observe → Understand → Decide → Act → Verify → Audit`

## 3. Information Architecture

```text
Platform Operations Center
├── Global Overview
├── Environments
├── Deployments / Releases
├── Configuration / Feature Flags
├── Service Health
├── Errors / Logs / Traces
├── Incidents
├── Capacity / Performance
├── Cloudflare Resources
│   ├── Workers
│   ├── D1
│   ├── R2
│   ├── KV / Cache
│   ├── Queues / Workflows
│   └── Durable Objects where used
├── Cost / Usage
├── Background Tasks
├── Security / Access
├── Audit / Change History
└── Governance / Readiness
```

## 4. Core Journeys

### 4.1 Release
`Change → Validation → Preview → Deploy → Health Check → Promote / Rollback`

### 4.2 Incident
`Alert → Triage → Scope → Mitigate → Recover → Verify → Postmortem`

### 4.3 Capacity
`Signal → Threshold → Forecast → Scale Action → Verify`

### 4.4 Configuration
`Draft → Validate → Review → Publish → Observe → Rollback`

## 5. Experience Requirements

- 首页必须区分正常、降级、故障与未知状态；
- 每个告警必须给出影响范围、优先级、证据、建议动作与当前责任上下文；
- 发布必须支持预览、健康检查、失败停止和可审计回滚；
- 配置变更必须有版本、操作者、原因与生效范围；
- 高风险操作必须二次确认并显示影响范围；
- 故障处理不得依赖人工翻查多个无关联控制台才能获得最小上下文；
- 成本与容量必须关联业务/技术指标，但不得伪造归因；
- 多环境状态必须明确区分，禁止把测试状态误认为生产状态。

## 6. Cloudflare-First Boundary

```text
Workers → execution
D1 → authoritative structured state
R2 → large object/media storage
KV / Cache → hot derived state
Queues / Workflows → asynchronous work
Durable Objects → narrowly scoped strong coordination
Cron → scheduled work
```

中心可以展示这些资源的健康与使用情况，但不得绕过正式部署、数据迁移、权限和治理流程直接操作底层资源。

## 7. API / Event Surface

通过稳定 operations、deployment、observability、incident、capacity、cost、audit API 提供数据与命令。不得直接把 Cloudflare provider 内部响应作为稳定业务 DTO。

代表性操作：deployment status、rollback、incident acknowledge、incident transition、config publish、feature flag change、task retry、resource health、cost summary。

所有变更携带 requestId、correlationId、actorId、expectedVersion 与审计引用。

## 8. Reliability / Safety

必须处理部署并发、重复回滚、配置竞争、告警风暴、监控延迟、数据源不可用、部分区域异常、队列积压、任务重复与权限即时变化。

核心原则：

- 无健康证据不得宣称恢复；
- 无变更审计不得执行高风险操作；
- 不允许将缓存健康状态当作权威资源状态；
- 观察系统故障不得阻塞业务核心路径。

## 9. Security / Access

至少区分：

```text
VIEW_OPERATIONS
OPERATE_DEPLOYMENT
OPERATE_CONFIG
OPERATE_INCIDENT
OPERATE_CAPACITY
VIEW_COST
OPERATE_COST_POLICY
VIEW_AUDIT
ADMIN_PLATFORM
```

危险命令遵循最小权限、环境隔离、审批/二次确认和不可抵赖审计。

## 10. Observability

关键链路统一关联：

```text
requestId
correlationId
deploymentId
changeId
incidentId
resourceId
traceId
```

支持从用户可见异常追溯到请求、服务、变更和基础设施证据。

## 11. Performance / Cost

中心页面不得同步聚合全部日志与指标；采用预聚合、时间窗口查询、缓存和异步报告。高基数原始事件必须受控，避免为 Dashboard 产生不必要的 Cloudflare/存储/计算成本。

## 12. Acceptance / Superiority Gate

验证：故障发现时间、故障定位时间、恢复完成时间、发布回滚效率、配置变更可追溯率、告警误报率、容量可见性、成本透明度、权限隔离和跨环境误操作防护，并通过 139 Superiority Gate。

**STOP：** 无审计高风险操作、生产测试环境混淆、无法回滚、健康状态造假、权限越权、直接绕过治理修改资源、观测系统拖垮业务、低于行业基线。
