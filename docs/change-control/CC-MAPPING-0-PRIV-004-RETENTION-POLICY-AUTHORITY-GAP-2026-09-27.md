# CC-MAPPING-0-PRIV-004-RETENTION-POLICY-AUTHORITY-GAP-2026-09-27

## Status

`GAP_NARROWED / POLICY_INSTANCE_BLOCKED`

## Purpose

记录 AUTH-001 / PRIV-002 进入运行时实现前发现的真实治理缺口：ENT-CONSENT 要求服务端根据适用的生命周期 retention policy 计算 `retentionUntil`，但当前仓库只有生命周期语义合同，没有可执行的 PRIV-004 retention policy authority / approved policy instance。

## Evidence

1. `contracts/entity/PRIV-002-consent-field-contract.v1.json` 将 `retentionUntil` 定义为必填、policy-controlled，且禁止客户端选择。
2. `contracts/persistence/PRIV-002-consent-persistence-contract.v1.json` 要求 `retentionUntil` 由适用 retention policy 在服务端计算。
3. `docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md` 只定义 retention class、生命周期状态和治理边界，没有冻结任何 consent-specific 保留期限。
4. `contracts/capability/reconciliation-batches/AO-privacy-compliance.v1.json` 当前仍将 `PRIV-004` 标记为 `BLUEPRINT_ONLY`。
5. 当前仓库搜索未发现可作为 AUTH-001 运行时输入的、已批准的 `LEGAL_AUDIT` retention policy version → effective retention rule 映射。

## Decision

在 PRIV-004 retention authority 被明确之前：

- 不发明具体保留天数、截止日期或法域规则；
- 不把客户端 `policyVersion` 当作 retention duration；
- 不使用固定常量、默认永久期限或当前时间作为 `retentionUntil`；
- 不绕过 `retentionUntil` 必填约束；
- AUTH-001 的 User + registration envelope + Consent 原子注册运行时暂缓。

## Required minimum authority

PRIV-004 后续变更必须至少冻结：

- 可识别的 policy version；
- `LEGAL_AUDIT` retention class 对应的服务端规则；
- 规则的生效范围/时间；
- 服务端解析失败时的 fail-closed 行为；
- 供 ENT-CONSENT 记录审计的 policy/source authority。

不要求在本 GAP 文档中选择任何具体法律保留期限。

## Non-authorizations

- no new Worker;
- no new D1;
- no new Queue;
- no Payload Core change;
- no client-selected retention;
- no Mapping 0 GREEN;
- no runtime evidence admission.

## 2026-09-27 authority-contract reconciliation

The minimum PRIV-004 Policy Config Authority shape is now admitted by `contracts/privacy/PRIV-004-retention-policy-authority.v1.json` and the companion decision packet. The concrete gap is narrowed to the first approved policy instance; no duration or jurisdiction-specific rule has been invented.

## Next Gate

`PRIV-004::admit the first approved policy instance for ACCOUNT_REGISTRATION / LEGAL_AUDIT, with version, scope, effective period, deterministic rule, approval and provenance evidence.`

