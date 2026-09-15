# Luckread Five-Way Alignment — Step 04

## API Inventory v1.0

Status: **NOT_GREEN / discovery gate**

### Purpose

把现有公共 API 事实从两个已有权威入口统一发现出来：

1. `contracts/api/api-inventory.v1.json`：产品/API completeness inventory；
2. `contracts/openapi/v1/openapi.yaml`：canonical HTTP surface。

本步骤不把 Payload Admin API、内部服务调用或任意代码 route 自动升级为公共 API。

### Discovery rule

每一个 `/v1/*` OpenAPI operation 必须同时出现在 API inventory；反向也必须成立。

机器检查只做确定性映射：

`METHOD + PATH → operationId + domain + OpenAPI source`

不会进行模糊语义推断，也不会因为代码中存在 route 就自动创建 API Contract。

### Status rule

发现到的 operation 初始为 `DRAFT`，因为发现事实不等于已经完成 schema、permission、scope、state、resource budget、idempotency、integration/e2e 等完整证据。

已有 API Inventory 明确要求这些证据维度后，才能继续进入 Contract Green。fileciteturn304file0

### Exit criteria

本步骤 GREEN 前必须能够证明：

- API inventory 与 canonical OpenAPI 双向一致；
- 每个 operation 有唯一 `operationId`；
- 每个 `/v1/*` endpoint 有 domain 归属；
- schema / permission / scope / state / budget / retry / event / idempotency / mapping / E2E 后续均有明确证据入口；
- 未声明的实际公共 route 不得静默进入公共 API 面。

下一阶段继续建立 Code Evidence Inventory，再进行五方 Cross-System Mapping。
