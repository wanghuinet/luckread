# LuckRead Copyright / Rights / Licensing System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

Rights 负责作品、媒体、IP、衍生关系和商业使用的权利事实与授权边界。它是平台级权利权威，不由 Content、Media、Commerce 或 Marketplace 各自解释版权。

## 2. 核心模型

```text
Work / Media / IP
→ Right Holder
→ Right Type / Territory / Window
→ License / Restriction
→ Entitlement
→ Usage Decision
→ Audit / Revocation
```

## 3. 能力

- ownership claims
- copyright registration metadata
- license/grant
- territory/window
- exclusive/non-exclusive boundary
- derivative/remix rights
- commercial usage rights
- takedown/revocation
- rights conflict
- provenance
- evidence/audit

## 4. Decision

任何需要权利判断的发布、播放、下载、商业化、广告、IP 衍生、Marketplace 交易必须经过明确 rights check。Decision 必须绑定 policy/version、scope、effective/expiry 和 source。

## 5. API

`/v1/rights`、`/v1/licenses`、`/v1/entitlements`、`/v1/rights/check`、`/v1/rights/conflicts`。

要求 requestId、idempotency、stable errors、authorization、audit references。

## 6. Event

`rights.claimed`、`rights.licensed`、`rights.updated`、`rights.revoked`、`rights.conflict.detected`、`rights.restriction.changed`。

撤销必须具备快速传播机制，不能只更新一个主记录。

## 7. Provenance

Remix、引用、翻译、剪辑、二创、IP 衍生必须记录来源与关系。Provenance 是可查询、可审计的结构化事实。

## 8. Security / Privacy

权利证明、合同和内部法律证据属于受控数据；公开 API 只暴露必要授权结果，不泄露内部证据。

## 9. Reliability / Cost

常用 rights check 可缓存，但缓存必须有版本和失效机制；revocation 优先传播；复杂冲突进入异步 case；不得因为缓存继续授权已撤销权利。

## 10. Acceptance

P0 验证 ownership、license、territory/window、播放/发布检查、商业化检查、衍生 provenance、撤销传播、冲突、审计、缓存失效、越权保护。

## 11. STOP

- Content 自行定义最终版权
- Commerce 自行授予版权
- 无 territory/window
- 无 provenance
- 撤销不能快速传播
- rights cache 无版本/TTL
- 内部证据公开
- 无审计

## 12. READY

Data/API/Event/Policy/Permission/Security/Privacy/Test/Recovery/Performance/Observability/CI/User Acceptance 完成后才能 READY。

当前：**IMPLEMENTATION PENDING**。
