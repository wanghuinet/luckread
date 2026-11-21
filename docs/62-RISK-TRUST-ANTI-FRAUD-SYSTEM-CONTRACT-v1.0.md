# LuckRead Risk / Trust / Anti-Fraud System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Risk / Trust 是平台级决策层，负责账号、设备、行为、内容、交易、社交和活动风险控制。它不拥有业务事实，只产生风险信号、决策和审计结果。

## 2. 核心链路

```text
Raw Signal
→ Identity / Device Context
→ Feature Extraction
→ Rule / Model Decision
→ Risk Score / Action
→ Challenge / Limit / Block / Review
→ Feedback
→ Trust Update
```

## 3. 风险域

- account abuse
- credential abuse
- bot/automation
- spam
- fake engagement
- follow/like/comment farming
- content manipulation
- marketplace fraud
- payment abuse
- promotion/campaign abuse
- collusion
- device/session anomaly

## 4. Trust Principle

原始行为不等于可信行为。推荐、Trending、Creator Growth、广告和商业结算必须使用经过 Risk/Trust Admission 的有效信号。

## 5. API

`/v1/risk/check`、`/v1/risk/challenges`、`/v1/risk/decisions`、`/v1/trust/signals`。

内部接口必须有 policyVersion、decisionId、reasonCode、expiresAt、requestId；禁止客户端伪造 risk/trust decision。

## 6. Decision

风险决策至少支持 allow、monitor、challenge、rate_limit、degrade、hold、block、review。高风险动作可要求二次验证或人工审核。

## 7. Privacy / Security

风险特征必须遵循最小化、目的限制、访问控制、保留期限和审计。不得把敏感数据作为无边界特征传播。

## 8. Reliability

Risk 服务不可用时必须定义 fail-open / fail-closed policy；高价值金融/权限动作默认更保守。决策应可重放、解释、审计；规则版本必须可追踪。

## 9. Performance / Cost

热规则本地/缓存化；高频信号异步聚合；低价值 telemetry 可采样；复杂模型不得阻塞所有请求路径；决策超时必须有明确 fallback。

## 10. Acceptance

P0 验证 bot、刷赞、刷粉、刷评论、异常登录、活动套利、支付风险、挑战、限流、封禁、误判恢复、规则版本、审计、故障 fallback。

## 11. STOP

- Raw Event 直接进入推荐/增长/结算
- 客户端可伪造风险结论
- 无 decision reason/version
- 高价值操作无风险策略
- 无 fail-open/closed 定义
- 风险数据无限期保留
- 风险决策不可审计/重放

## 12. READY

Data/API/Event/Policy/Permission/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
