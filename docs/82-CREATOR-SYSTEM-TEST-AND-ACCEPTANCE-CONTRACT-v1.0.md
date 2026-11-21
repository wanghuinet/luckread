# LuckRead Creator System Test & Acceptance Contract v1.0

**状态：TEST-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**  
**定位：L1-03 Creator System 测试、验收与故障恢复合同**

## 1. 测试原则

Creator System 必须同时验证：

```text
Functional
+ Contract
+ Authorization
+ Privacy
+ Consistency
+ Idempotency
+ Event Delivery
+ Recovery
+ Performance
+ Cost Guardrails
```

测试不能通过修改测试规则来掩盖合同缺陷。

## 2. Test Layers

### 2.1 Unit

验证：

- creator state transition；
- qualification evaluation mapping；
- capability derivation；
- version checks；
- DTO redaction；
- authorization predicates；
- event envelope；
- idempotency logic。

### 2.2 Integration

验证：

```text
API
→ Creator authority
→ D1
→ Event publication
→ Queue consumer
→ Projection / Cache
```

### 2.3 Security

验证：

- owner isolation；
- organization scope isolation；
- delegate expiry/revoke；
- external app scope；
- admin/support control；
- sensitive data redaction；
- replay resistance。

### 2.4 Contract

所有公开 API、事件、DTO 和状态迁移必须与 78-81 保持一致。

## 3. P0 Acceptance Matrix

| Domain | Acceptance |
|---|---|
| Identity | Creator 创建、唯一性、User 绑定正确 |
| Profile | 可编辑、版本控制、可见性正确 |
| Qualification | eligibility、expiry、appeal 正确 |
| Verification | request、approve、reject、expire、revoke 正确 |
| Capability | 能力授予/限制/撤销正确且不能客户端自授 |
| Lifecycle | 合法迁移、非法迁移阻止、恢复正确 |
| Authorship | Creator-side attribution 与 provenance 正确 |
| Audience | creator-facing projection 与 Social authority 一致 |
| Organization | MCN/Organization reference 与权限正确 |
| Rights | Rights reference 正确，不能冒充法律权威 |
| Standing | Risk-derived standing 正确、安全摘要正确 |
| Safety | recovery / impersonation / protection state 正确 |
| Growth | growth projection 不修改 authority |
| Analytics | derived metrics 可重建 |
| Monetization | eligibility/projection 正确，资金事实留在 Ledger |
| Collaboration | invite/accept/reject/terminate 幂等 |
| Ecosystem | Marketplace/Open Platform reference 不越权 |
| Governance | policy/appeal/audit reference 正确 |

## 4. Idempotency Tests

重复提交以下请求不得生成重复事实：

```text
profile update
verification request
lifecycle transition
capability change
collaboration creation
collaboration accept
creator deletion request
```

## 5. Concurrency Tests

必须测试：

```text
same creator
same resource
concurrent mutations
```

预期：

```text
one valid commit
remaining requests → VERSION_CONFLICT / stable outcome
```

## 6. Event Tests

至少覆盖：

- duplicate delivery；
- out-of-order delivery；
- consumer timeout；
- retry；
- poison message；
- DLQ；
- replay；
- backfill；
- projection rebuild。

权威状态不得因重复消费而重复变化。

## 7. Failure Scenarios

必须验证：

```text
D1 unavailable
Queue unavailable
Verification provider unavailable
Cache unavailable
Search index unavailable
Dependency timeout
Worker restart
Partial event propagation
```

原则：

```text
authoritative state integrity > derived freshness
```

派生系统失败不得破坏 Creator authority。

## 8. Privacy Tests

验证不同 actor 获得不同字段集合：

```text
Public
Creator Owner
Delegate
Organization Operator
Support
Admin
External App
```

必须确保敏感 evidence、security data、private organization information 不泄露。

## 9. Performance / Load

P0 必须测试：

- Creator profile hot read；
- capability lookup；
- qualification lookup；
- public profile burst traffic；
- high-frequency read with cache；
- concurrent mutation conflict；
- event burst consumption。

指标必须定义：

```text
p50
p95
p99
error rate
queue lag
D1 write volume
cache hit ratio
```

具体阈值进入实现前的环境基线，不得在本合同中虚构单一全球固定数字。

## 10. Recovery Acceptance

至少证明：

```text
failed event
→ DLQ
→ replay
→ projection converges
```

```text
cache lost
→ rebuild from authority
```

```text
search projection lost
→ rebuild from authoritative references
```

## 11. Cross-Domain Acceptance

必须证明：

```text
Creator Center
→ Creator System

MCN Center
→ Creator System

Public Profile
→ Creator System

Open Platform
→ Creator System
```

所有入口看到的是同一个 Creator authority，不允许产生不同 Creator 状态。

## 12. Evidence Requirements

每个 P0 acceptance 至少保留：

```text
testId
contractId
commitSha
input
expected
actual
result
timestamp
```

结果只允许：

```text
PASS
FAIL
BLOCKED
NOT-APPLICABLE
```

## 13. STOP

- P0 acceptance 无对应 L4；
- security acceptance 缺失；
- privacy acceptance 缺失；
- event recovery 缺失；
- authority consistency 未验证；
- performance 只有平均值无 tail latency；
- 无法重建 derived state；
- FAIL/BLOCKED 被人工解释为 PASS。

## 14. Status

```text
TEST / ACCEPTANCE CONTRACT = COMPLETE
IMPLEMENTATION = PENDING
CL / CI = NOT RUN
```
