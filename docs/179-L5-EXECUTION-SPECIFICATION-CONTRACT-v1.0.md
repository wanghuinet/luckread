# LuckRead L5 Execution Specification Contract v1.0

**状态：ENGINEERING-SPECIFICATION-CONTRACT / IMPLEMENTATION-PENDING**

## 0. Purpose

L5 不是新的产品能力层级，而是把 L4 转换为可由工程师或 AI 稳定实现的执行规格。

```text
L1 Domain
→ L2 Capability
→ L3 Atomic Capability
→ L4 Implementation Responsibility
→ L5 Execution Specification
```

禁止通过 L5 偷塞新的未登记业务能力。

## 1. One L4 → One or More L5

每个 L5 必须有唯一：

```text
l5Id
parentL4Id
owner
version
status
authoritativeSource
```

## 2. Mandatory L5 fields

```text
1. Intent
2. Input Contract
3. Output Contract
4. Preconditions
5. Validation Rules
6. Authorization / Scope
7. State Transition
8. Data Mutation / Query Boundary
9. Concurrency / Version Semantics
10. Idempotency
11. Transaction Boundary
12. Event Side Effects
13. Async Operation Identity
14. Cache / Derived-State Effects
15. Error Mapping
16. Retry / Recovery
17. Audit
18. Observability
19. Cost / Latency Budget
20. Test Mapping
21. Evidence Mapping
```

## 3. Input Contract

必须明确：

```text
field
primitive / domain type
required / optional
normalization
format
range
maximum size
sensitive classification
```

客户端输入不得直接成为业务事实。

## 4. Output Contract

必须明确：

```text
success shape
resource reference
state/version
pagination/cursor where applicable
async operation reference where applicable
user-visible safe result
```

内部实现对象不得直接作为公共 DTO。

## 5. Preconditions

至少检查：

```text
authentication
resource existence
ownership / scope
current state
policy version
required version
dependency readiness
legal / rights constraints where applicable
```

## 6. Validation

验证顺序应可确定：

```text
syntax / schema
→ identity / scope
→ business invariants
→ policy / safety
→ concurrency
→ mutation admission
```

失败必须映射到稳定 error code。

## 7. Authorization

每个 mutation/query 必须显式声明：

```text
actor
scope
resource
action
policy source
sensitive fields
break-glass rule where applicable
```

默认拒绝，禁止依赖 UI 隐藏实现授权。

## 8. State Transition

每个状态型 L5 必须定义：

```text
currentState
+ command / trigger
+ guard
→ nextState
```

非法转换必须稳定失败。

## 9. Concurrency

需要并发控制时必须声明：

```text
expectedVersion
conflict condition
retry policy
winner/loser semantics
```

不得通过最后写入覆盖未知并发修改。

## 10. Idempotency

下列操作默认需要幂等：

```text
create mutation with client retry
payment / settlement
publish
delete
membership mutation
moderation enforcement
async submission
webhook/event handling
```

幂等键及结果保留策略必须明确。

## 11. Transaction Boundary

L5 必须声明 authoritative transaction boundary。

跨 Domain 不得伪装成单事务；使用 164 Saga / compensation 或明确最终一致性模型。

## 12. Event Side Effects

必须声明：

```text
eventType
producer
schemaVersion
resourceRef
correlationId
ordering scope
dedupe key
consumer expectation
```

事件不得反向成为新的业务 authority。

## 13. Async Operations

长任务必须使用 165：

```text
operationId
state
progress
result
error
cancel/retry policy
expiry
```

请求返回成功不等于长期操作完成。

## 14. Cache / Derived State

L5 若读取或更新派生状态，必须声明：

```text
source authority
cache key
version/freshness
invalidation
stale policy
stampede policy
rebuild path
```

## 15. Error Mapping

统一映射至 166：

```text
category
code
severity
retryability
user-safe message key
observability attributes
```

禁止将底层数据库、Provider 或 Payload 内部错误直接暴露给客户端。

## 16. Recovery

每个可失败 L5 必须定义：

```text
retry
compensation
resume
manual intervention
final terminal state
```

UNKNOWN 不得伪装成 SUCCESS/FAILURE。

## 17. Audit / Observability

高风险操作至少记录：

```text
requestId
correlationId
operationId where applicable
actorId where safe
resourceId
policyVersion
result
failure reason
```

## 18. Cost / Runtime

每个 L5 必须明确：

```text
expected read/write shape
fan-out bound
pagination bound
queue usage where applicable
latency target
cost risk
Cloudflare resource usage
```

## 19. Test Mapping

L5 必须至少映射：

```text
happy path
validation failure
authorization failure
state conflict
retry / duplicate
recovery
side-effect verification
```

## 20. Evidence Mapping

每个 L5 完成后必须可以产生 176 Evidence：

```text
spec claim
→ test
→ result
→ artifact / log / trace
→ commit
→ timestamp
```

## 21. L5 readiness

```text
L4
→ L5 complete
→ contract mapping complete
→ L6 mapping complete
→ evidence plan complete
→ IMPLEMENTATION-READY
```

## 22. STOP conditions

- L5 introduces unregistered business capability;
- input/output unspecified;
- state transition missing;
- authorization missing;
- concurrency semantics unknown;
- mutation lacks idempotency where required;
- cross-domain boundary hidden;
- async operation lacks identity;
- derived state lacks source authority;
- error cannot be normalized;
- test/evidence mapping absent.

## 23. Global rule

L5 is an engineering execution specification, not a sixth business hierarchy.

```text
NO NEW PRODUCT CAPABILITY AT L5
NO SECOND AUTHORITY AT L5
NO PAYLOAD INTERNAL CONTRACT AT L5
NO DIRECT CROSS-DOMAIN DATABASE CONTRACT AT L5
```
