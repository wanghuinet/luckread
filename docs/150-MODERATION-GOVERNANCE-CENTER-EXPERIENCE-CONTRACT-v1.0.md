# LuckRead Moderation / Governance Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：63 Moderation / Appeals + 62 Risk / Trust + 64 Rights + 71 Platform Operations**

## 1. 定位

Moderation / Governance Center 是内容安全、社区治理、版权/权益治理及平台规则执行人员的统一工作台，负责案件、队列、证据、规则、处罚、申诉、恢复、审计与治理指标的操作体验。

治理决定由 Moderation / Risk / Rights 等权威域持有。本中心不得成为新的业务事实或风险评分权威。

## 2. Benchmark / Superiority

借鉴大型内容平台的审核台、风险控制台、申诉中心和运营治理工作流，目标是：案件上下文完整、队列优先级清晰、证据可追溯、规则可解释、批量操作安全、误伤可恢复、审计不可篡改。

## 3. Information Architecture

```text
Moderation / Governance Center
├── Governance Overview
├── Review Queues
├── Priority / Escalation
├── Case Detail
│   ├── Subject
│   ├── Content
│   ├── Context
│   ├── Evidence
│   └── History
├── Policy / Rule Reference
├── Decisions / Actions
├── Appeals
├── Restoration / Reversal
├── Copyright / Rights Cases
├── Risk Signals
├── Bulk Operations
├── Audit / Evidence
├── Quality / Accuracy
└── Governance Analytics
```

## 4. Core Journeys

### 4.1 Review
`Queue → Case → Context → Evidence → Policy → Decision → Action → Audit`

### 4.2 Appeal
`Appeal → Original Decision → Evidence → Re-review → Decision → Notify → Audit`

### 4.3 False-positive recovery
`Detected → Restriction → Appeal/Review → Restore → Propagate → Verify`

### 4.4 Escalation
`Signal → Priority → Specialist Queue → Decision → Downstream Enforcement`

## 5. Experience Requirements

- 审核人员必须一次看到完成决定所需的最小完整上下文；
- 队列必须按风险、时效、影响范围等策略排序，而不是只按进入时间；
- 每个决定必须区分事实、证据、规则、决策与执行结果；
- 批量处罚必须预览影响范围、要求权限确认并提供失败/回滚信息；
- 申诉必须保留原决策上下文，不要求重新收集已存在证据；
- 对合法内容的恢复必须能沿原上下文回溯并验证传播结果；
- 敏感证据按最小权限展示，防止内部规则外泄；
- Web / Android / iOS 的治理操作上下文需要安全连续。

## 6. Authority Boundary

```text
Moderation Decision → 63
Risk Decision / Trust → 62
Legal Rights / Authorization → 64
Content / Media → corresponding content domains
Creator / User → corresponding identity domains
Operational Runtime → 71
Analytics → 69
```

## 7. API / Event Surface

中心只通过稳定治理 API 获取 queue、case、evidence、decision、appeal、audit 与 aggregate 数据，不直接读写业务表或 Payload internals。

治理 mutation 必须使用 actor scope、requestId、correlationId、expectedVersion、idempotencyKey，并记录不可抵赖审计。

## 8. Safety / Privacy / Reliability

证据、举报人信息、受保护身份信息、内部风险信号属于敏感数据。必须最小权限、分级脱敏与访问审计。

必须处理重复案件、重复处罚命令、事件乱序、撤销传播延迟、批量部分失败、误操作、申诉竞态、下游失败及恢复重试。

## 9. Quality / Anti-Bias Controls

治理中心必须支持质量抽检、人工复核、模型/规则版本关联、误伤率分析、申诉通过率、恢复时延与处理一致性指标。

不得把模型结果直接等同最终治理决定；高影响动作必须遵循平台规定的人工/策略升级路径。

## 10. Acceptance / Superiority Gate

验证：案件处理步数、关键上下文完整率、证据追溯率、决策一致性、误伤恢复率、申诉处理时效、批量操作安全性、权限隔离、审计完整性和异常恢复，并通过 139 Global Product & Experience Superiority Gate。

**STOP：** 第二 Moderation/Risk 权威、无证据处罚、批量操作无预览/权限保护、申诉丢失上下文、内部风险规则泄漏、无法恢复误伤、审计不可追溯、低于行业基线。
