# LuckRead MCN Center Test and Acceptance Contract v1.0

**状态：TEST-ACCEPTANCE-CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：将 MCN Center 44–49 全部契约转换为可执行测试、验收证据与最终 READY Gate。**

## 1. 目标

本合同不是测试用例清单的替代品，而是 MCN Center 进入实现阶段前必须满足的质量准入标准。

```text
Experience
→ Traceability
→ Data
→ API
→ Event
→ Permission/Security
→ Test / Acceptance
→ READY
→ Implementation
```

任何单项业务“看起来能用”但没有对应契约、自动化测试或验收证据，都不能标记 DONE。

## 2. Test Layers

P0 测试分为：

1. Schema / Type Test
2. Unit Test
3. Authorization Test
4. API Contract Test
5. Event Contract Test
6. Idempotency / Concurrency Test
7. Integration Test
8. Failure / Recovery Test
9. Security / Privacy Test
10. Data Consistency / Reconciliation Test
11. Performance / Cost Test
12. Accessibility / UX Test
13. CI Regression Test
14. User Acceptance Test

## 3. Evidence Rule

每一个 P0 capability 必须形成可追溯证据：

```text
Capability ID
→ Contract Section
→ Test ID
→ Test Result
→ CI Run
→ Commit SHA
→ Acceptance Evidence
```

禁止：
- 只有截图没有自动化测试；
- 只有单元测试没有 API/权限验证；
- 只有 CI 绿灯但没有 capability mapping；
- 只有人工验证没有可重复步骤。

## 4. Test ID Convention

统一：

```text
MCN-T-<DOMAIN>-<NUMBER>
```

例如：

```text
MCN-T-AUTH-001
MCN-T-CREATOR-001
MCN-T-CONTENT-001
MCN-T-RIGHTS-001
MCN-T-FINANCE-001
MCN-T-EVENT-001
MCN-T-SECURITY-001
```

## 5. Organization / Tenant Isolation

### MCN-T-ORG-001
创建组织后只能读取自身 organization scope。

Expected:
```text
same org → 200
other org → safe 403/404
```

### MCN-T-ORG-002
跨 organization 的 creator/content/IP/resource enumeration 必须失败。

### MCN-T-ORG-003
修改 URL organizationId 不能绕过 membership authorization。

### MCN-T-ORG-004
组织状态变化必须正确影响受保护操作。

## 6. Membership / RBAC

### MCN-T-RBAC-001
Owner 可以执行允许的组织管理操作。

### MCN-T-RBAC-002
Editor 不能修改角色。

### MCN-T-RBAC-003
Analyst 只能执行授权读取。

### MCN-T-RBAC-004
Moderator 只能访问其安全运营 scope。

### MCN-T-RBAC-005
Finance 与 Settlement approval 权限必须分离。

### MCN-T-RBAC-006
Developer credential 权限必须独立。

### MCN-T-RBAC-007
成员移除后旧权限立即失效。

## 7. Resource Scope

### MCN-T-SCOPE-001
Team-scoped Editor 只能操作授权 Team。

### MCN-T-SCOPE-002
Creator-scoped operator 不能读取其他 Creator 资源。

### MCN-T-SCOPE-003
Content assignment 变化后权限正确刷新。

### MCN-T-SCOPE-004
scope cache invalidation 后旧 token/session 不产生越权。

## 8. Creator Affiliation

### MCN-T-CREATOR-001
Creator invitation 可幂等接受。

### MCN-T-CREATOR-002
重复 affiliation 不创建第二条权威关系。

### MCN-T-CREATOR-003
termination 后 MCN 管理权限失效。

### MCN-T-CREATOR-004
MCN API 不创建重复 Creator identity。

### MCN-T-CREATOR-005
Creator dispute 状态可以进入受控流程。

## 9. Content Operations

### MCN-T-CONTENT-001
合法 assignment 可以读取内容。

### MCN-T-CONTENT-002
无权限 Editor 不能修改内容。

### MCN-T-CONTENT-003
不满足 lifecycle/moderation/rights 条件时不能发布。

### MCN-T-CONTENT-004
重复 publish mutation 不产生重复业务事实。

### MCN-T-CONTENT-005
batch operation 支持 partial success。

### MCN-T-CONTENT-006
大批量 operation 自动进入 Task workflow。

## 10. Asset

### MCN-T-ASSET-001
无权访问 asset reference 时不能获得受保护引用。

### MCN-T-ASSET-002
大媒体不会作为普通 API response 全量传输。

### MCN-T-ASSET-003
asset archive 不破坏仍然有效的权威引用关系。

## 11. IP / Rights / Copyright

### MCN-T-RIGHTS-001
普通 Content Editor 不能授予 Rights。

### MCN-T-RIGHTS-002
Rights grant/revoke 必须有 actor、scope、provenance。

### MCN-T-RIGHTS-003
rights revoke 能触发下游受影响派生状态重新计算。

### MCN-T-RIGHTS-004
过期 license 不能继续执行受保护操作。

### MCN-T-RIGHTS-005
copyright restriction 能阻止不允许的发布/分发。

## 12. Audience / Privacy

### MCN-T-PRIVACY-001
Analyst 默认只能读取聚合数据。

### MCN-T-PRIVACY-002
Editor 不得获得无关用户完整隐私档案。

### MCN-T-PRIVACY-003
Finance 权限不能扩大到无关隐私。

### MCN-T-PRIVACY-004
导出需要明确 scope + authorization + audit。

### MCN-T-PRIVACY-005
导出结果使用短期/受控访问能力。

## 13. Collaboration / Campaign

### MCN-T-CAMPAIGN-001
只有授权角色可以创建 campaign。

### MCN-T-CAMPAIGN-002
campaign state transition 遵守 lifecycle。

### MCN-T-CAMPAIGN-003
重复 approve/resume 不产生重复业务事实。

### MCN-T-CAMPAIGN-004
campaign 不直接修改余额。

## 14. Financial / Settlement

### MCN-T-FIN-001
Revenue attribution 来自权威 Ledger/Revenue domain。

### MCN-T-FIN-002
Settlement approve 需要正确金融权限。

### MCN-T-FIN-003
重复 settlement approve 不重复结算。

### MCN-T-FIN-004
Payout-related mutation 必须可审计。

### MCN-T-FIN-005
Ledger/Settlement failure 可以 reconcile。

### MCN-T-FIN-006
普通 Content/Campaign API 无法直接修改 balance。

## 15. Task Center / Batch

### MCN-T-TASK-001
长任务具有明确状态。

### MCN-T-TASK-002
retry 只允许 retryable task。

### MCN-T-TASK-003
retry 幂等。

### MCN-T-TASK-004
cancel 不会产生非法状态跳转。

### MCN-T-TASK-005
batch operation 支持 completed/partial/failed/cancelled。

### MCN-T-TASK-006
task failure 保留恢复路径。

## 16. Event Contract

### MCN-T-EVENT-001
authoritative mutation 后发布正确 event。

### MCN-T-EVENT-002
重复 eventId 不产生重复业务事实。

### MCN-T-EVENT-003
consumer 使用 at-least-once safe handling。

### MCN-T-EVENT-004
同 aggregate 的旧版本不会覆盖新状态。

### MCN-T-EVENT-005
transient failure 采用 retry/backoff。

### MCN-T-EVENT-006
poison message 进入 DLQ/quarantine。

### MCN-T-EVENT-007
DLQ replay 可审计且幂等。

### MCN-T-EVENT-008
event schema version 能向后兼容演进。

### MCN-T-EVENT-009
derived state 可以 rebuild/reconcile。

### MCN-T-EVENT-010
event payload 不包含 secret/token 等敏感凭证。

## 17. Security

### MCN-T-SEC-001
默认 deny。

### MCN-T-SEC-002
跨组织访问被阻止。

### MCN-T-SEC-003
privileged role escalation 被阻止。

### MCN-T-SEC-004
credential 可创建、轮换、撤销并审计。

### MCN-T-SEC-005
service identity 不能获得无限权限。

### MCN-T-SEC-006
session revocation 生效。

### MCN-T-SEC-007
CSRF/request validation 按认证模式生效。

### MCN-T-SEC-008
敏感错误不会泄露 SQL、stack trace、风险规则。

### MCN-T-SEC-009
Audit 普通成员不可篡改。

### MCN-T-SEC-010
security-sensitive mutation 支持 idempotency。

## 18. Audit / Governance

### MCN-T-AUDIT-001
角色变更有 audit。

### MCN-T-AUDIT-002
权限 scope 变更有 audit。

### MCN-T-AUDIT-003
Rights grant/revoke 有 audit。

### MCN-T-AUDIT-004
Settlement approval 有 audit。

### MCN-T-AUDIT-005
Bulk destructive operation 有 audit。

### MCN-T-AUDIT-006
Export 有 audit。

### MCN-T-AUDIT-007
audit record 不可被普通成员修改/删除。

## 19. API Contract Tests

必须验证：

- endpoint existence
- method
- request schema
- response schema
- error schema
- pagination
- authorization
- idempotency
- version conflict
- compatibility
- rate limiting

API contract test 不允许只验证 HTTP 200。

## 20. UX / Journey Acceptance

至少验证：

```text
J14 Creator Onboarding
→ J16 Creator Center
→ J17 Creator Growth
→ J18 Fan / Membership
→ J20 IP Hub
→ J21 Monetization
→ J22 Wallet / Earnings
→ J23 Creator/IP Marketplace
```

每条 P0 Journey 必须覆盖：
- discoverability
- comprehension
- execution
- feedback
- failure recovery
- privacy/security
- accessibility
- performance
- cross-device where applicable

## 21. Failure / Recovery Matrix

必须测试：

| Failure | Expected |
|---|---|
| Network timeout | preserve intent/work + retry path |
| Session expired | re-auth + resume safe operation |
| Permission revoked | deny + explain safe state |
| Version conflict | no silent overwrite |
| Upload failure | resumable/retryable task |
| Processing failure | task recovery |
| Moderation rejected | safe state + appeal where applicable |
| Rights conflict | stop protected operation |
| Settlement failure | no duplicate financial fact + reconcile |
| Queue unavailable | retry/degrade safely |
| Consumer failure | retry/DLQ |
| Partial batch | show per-operation result |

## 22. Concurrency / Idempotency Matrix

高风险 mutation 必须至少执行：

```text
same request twice
same Idempotency-Key twice
concurrent different requests
stale version
retry after timeout
replay after success
```

Expected：
- no duplicate creator affiliation;
- no duplicate publish fact;
- no duplicate settlement;
- no duplicate role grant;
- no duplicate rights grant;
- no lost authoritative update.

## 23. Performance / Cost Acceptance

P0 API 必须定义：
- expected throughput
- p50/p95/p99 latency target
- maximum page size
- query cost budget
- batch threshold
- async threshold
- cache policy where applicable

禁止用无限横向读取、全表扫描或同步大批量写入作为默认实现。

高频行为应验证：

```text
Raw Event
→ Trust / Admission
→ Aggregation
→ Derived Read Model
```

而不是每次行为都同步写权威状态。

## 24. Accessibility Acceptance

P0 MCN Center 页面至少验证：
- keyboard navigation
- focus visibility
- semantic labels
- screen-reader compatibility
- non-color-only status
- scalable text
- sufficient touch target
- reduced motion where applicable
- localized strings

## 25. CI Requirements

READY 前至少需要：

```text
lint PASS
→ typecheck PASS
→ unit PASS
→ API contract PASS
→ authorization PASS
→ event PASS
→ integration PASS
→ security PASS
→ failure/recovery PASS
→ build PASS
```

若仓库已有更高等级治理门禁，以更严格门禁为准。

## 26. Acceptance Evidence Record

每个 P0 capability 最终需要记录：

```text
Capability ID
Test IDs
Environment
Commit SHA
CI Run ID
Result
Observed At
Known Exceptions
Reviewer
Acceptance Status
```

允许：

```text
PASS
PASS-WITH-APPROVED-EXCEPTION
FAIL
BLOCKED
NOT-APPLICABLE
```

`PASS-WITH-APPROVED-EXCEPTION` 必须有明确 owner、风险、期限与补偿措施，不能作为永久 DONE。

## 27. Final READY Gate

MCN Center 只有同时满足以下条件才能进入 READY：

```text
44 Experience Contract                 PASS
45 L1-L4 Traceability                  PASS
46 Data Contract                       PASS
47 API Contract                        PASS
48 Event Contract                      PASS
49 Permission/Security Contract        PASS
50 Test/Acceptance Contract             PASS

P0 Data Tests                           PASS
P0 API Tests                            PASS
P0 Event Tests                          PASS
P0 Authorization Tests                  PASS
P0 Security Tests                       PASS
P0 Failure/Recovery Tests               PASS
P0 Performance/Cost Tests               PASS
P0 UX Tests                             PASS
CI Gates                                PASS
Evidence Completeness                   PASS
User Acceptance                         PASS

→ MCN-CENTER-READY
```

## 28. DONE Definition

MCN Center 不得因为代码 merge 就标记 DONE。

真正 DONE：

```text
Contract PASS
→ Implementation PASS
→ Local PASS
→ CI PASS
→ Security PASS
→ Recovery PASS
→ Performance/Cost PASS
→ Evidence PASS
→ User Acceptance PASS
→ DONE
```

## 29. STOP Conditions

任何一个成立都禁止 READY：

1. P0 capability 无测试 ID；
2. 测试不能追溯到 capability；
3. 关键权限没有 negative test；
4. 关键 mutation 没有 idempotency/concurrency test；
5. event 没有 duplicate/replay test；
6. financial flow 没有 reconciliation test；
7. rights flow 没有 authorization/provenance test；
8. cross-tenant isolation 未验证；
9. sensitive data exposure 未验证；
10. failure/recovery 未验证；
11. derived state 无 rebuild test；
12. API compatibility 未验证；
13. CI 未覆盖 P0 gates；
14. acceptance evidence 缺失；
15. 用户验收未完成；
16. 存在未批准的高风险 exception。

## 30. Implementation Admission

50 完成后，只有在 44–50 全部 PASS 时，MCN Center 才允许进入代码实现：

```text
Product Experience
→ Capability Traceability
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security
→ Test/Acceptance
→ READY
→ IMPLEMENTATION
```

**结论：MCN Center 契约链 44–50 完成，达到实现准入所需的文档层闭环；实际实现仍必须等待 READY Gate 的可执行测试、CI 与用户验收全部 PASS。**
