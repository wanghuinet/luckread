# LuckRead Moderation / Appeals System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Moderation 负责内容与行为安全审查、处置、复核和申诉。它与 Risk、Rights、Legal/Operations 协同，但不替代 Content/Creator/Media 的事实权威。

## 2. 核心链路

```text
Submission / Event
→ Policy Eligibility
→ Automated Detection
→ Human Review when required
→ Decision
→ Enforcement
→ Notification
→ Appeal
→ Re-review
→ Final Decision
```

## 3. 能力

- text/image/video/audio moderation
- spam/safety policy
- pre-publish review
- post-publish enforcement
- account/content restrictions
- quarantine
- reviewer queues
- evidence package
- appeal
- re-review
- policy versioning
- audit trail

## 4. Decision

Decision 必须包含 target、policyVersion、reasonCode、severity、scope、effectiveAt、expiresAt、reviewer/automation source。自动决策与人工决策必须可区分。

## 5. API

`/v1/moderation/checks`、`/v1/moderation/decisions`、`/v1/moderation/appeals`、`/v1/moderation/cases`。

用户只能读取自己的可公开解释信息；内部 reviewer/evidence 权限严格隔离。

## 6. Enforcement

支持 hide、limit、quarantine、age/restriction、disable interaction、remove、account restriction 等动作。传播必须有事件机制，不能依赖人工逐库清理。

## 7. Appeals

申诉必须可追踪、去重、限频；必须保存原决策、理由、证据引用、政策版本和复核结果。最终结果必须能回写相关 domain。

## 8. Reliability / Safety

错误不能导致违规内容永久暴露；同时必须避免安全服务故障造成大规模误删。高风险策略使用 fail-closed；低风险非安全关键流程可定义受控 fallback。

## 9. Performance / Cost

异步媒体审核；高风险内容可先 quarantine；重复内容可复用检测结果但必须校验版本/范围；review queue 按优先级调度。

## 10. Acceptance

P0 验证自动审核、人工复核、证据、处置传播、申诉、复审、策略版本、权限隔离、误判恢复、删除/隐藏一致性、故障恢复。

## 11. STOP

- 无 policyVersion/reasonCode
- 处置无传播机制
- 用户可读取内部审核证据
- 无申诉/复审路径
- 自动决策与人工决策不可区分
- 安全故障导致违规内容永久暴露
- 无审计记录

## 12. READY

Data/API/Event/Policy/Permission/Security/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
