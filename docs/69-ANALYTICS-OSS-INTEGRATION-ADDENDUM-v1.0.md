# LuckRead Analytics / Experiment / Growth — OSS Integration Addendum v1.0

**关联合同：`docs/69-ANALYTICS-EXPERIMENT-GROWTH-CONTRACT-v1.0.md`**

**状态：CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 目的

本文件只定义成熟开源 Analytics 工具的接入边界，不改变 69 主合同中的权威性、事件质量、实验、隐私、金融和可重建性规则。

## 2. PostHog 集成

LuckRead 可通过 Adapter 使用 **PostHog** 的产品分析、Session Replay、Feature Flags、Experiments 等成熟能力；PostHog 官方产品覆盖 Product Analytics、Feature Flags、Experiments、Session Replay 等能力。

推荐边界：

```text
LuckRead Event Contract
→ Event Quality / Risk
→ Analytics Adapter
→ PostHog
→ Dashboard / Experiment / Feature Flag
→ Decision Evidence
→ LuckRead Product Action
→ New Event
```

## 3. 权威边界

PostHog 不成为：

- User Authority
- Content Authority
- Creator Authority
- Risk Authority
- Commerce Authority
- Wallet/Ledger Authority

PostHog 中的用户、事件、实验和指标均必须服从 LuckRead 的 identity mapping、privacy/consent、event-quality 和 retention contract。

## 4. Cloudflare 优先策略

当前 Cloudflare 部署优先使用 Workers、Queues、D1/R2、Cache/KV 和 Cloudflare 原生 Analytics/observability 能力。PostHog 是可插拔的分析产品，不是 v1 强制基础设施。

```text
Cloudflare Native Analytics / Event Pipeline
            ↓
       Analytics Adapter
            ↓
       PostHog (optional)
```

PostHog 故障不得阻塞核心业务请求，也不得阻止权威事件进入平台事件链路。

## 5. Event Rules

发送到 PostHog 前必须经过：

```text
Schema Validation
→ Deduplication
→ Timestamp Validation
→ Identity / Session Validation
→ Risk / Trust Filtering
→ Consent / Purpose Check
→ Analytics Adapter
```

禁止把未经验证的原始事件直接作为核心 KPI 或增长决策依据。

## 6. Experiment Boundary

PostHog Feature Flags/Experiments 可以作为实验执行工具，但 LuckRead 必须保留自己的：

- experimentId
- assignmentVersion
- eligibility
- exposure evidence
- guardrail metrics
- approval state
- audit record

```text
LuckRead Experiment Contract
→ Assignment / Eligibility
→ PostHog Flag or Experiment Adapter
→ Exposure
→ Outcome
→ LuckRead Analysis / Decision
```

实验工具不能绕过 LuckRead 的权限、风险、隐私和审批规则。

## 7. Privacy / Cost

- 不发送不必要的敏感字段；
- identity 使用稳定的内部映射标识，不暴露内部认证凭据；
- retention 必须符合平台数据生命周期；
- 高频事件优先批量/异步发送；
- PostHog 不应成为主业务请求同步依赖；
- 分析工具产生的派生数据必须允许重建/删除。

## 8. STOP

- PostHog 成为业务事实权威；
- PostHog Dashboard Revenue 直接修改 Wallet/Ledger；
- PostHog bypass Risk/Privacy/Consent；
- PostHog outage 阻塞核心业务；
- 实验没有 LuckRead assignment/exposure/guardrail 证据；
- 直接暴露内部用户认证数据。

## 9. Decision

**PostHog：保留为可插拔 OSS/产品分析能力；Cloudflare 原生能力优先；当前不强制安装。**
