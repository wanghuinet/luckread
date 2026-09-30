# Luckread Five-Way Alignment — Step 06

## Code Evidence Inventory v1.0

Status: **NOT_GREEN / evidence gate**

### Purpose

建立实现证据层，把 Feature、Entity、Field、API Operation、Payload Collection/Field 与实际代码入口连接起来。

### Evidence rules

1. `implementationRef` 只能表示可定位的代码证据，不代表功能完整。
2. API operation 当前默认 `UNRESOLVED`，直到能够从仓库中确定性发现其 runtime implementation。
3. Entity/Field 的既有 implementation evidence 可以复用，但不得被自动升级为数据库或 E2E 证明。
4. Payload evidence 来自已验证的 Payload discovery sourceRef。
5. Test evidence 与 implementation evidence 分开记录。
6. 缺失证据必须显式成为 blocker，不允许以“看起来已经实现”替代。
7. Code Evidence Inventory 是证据索引，不是新的业务 Contract。

### Why NOT_GREEN is intentional

当前 API inventory 只证明 canonical API surface；它不能证明 runtime handler 已实现。因此 API operation 默认 `UNRESOLVED`，直到后续自动 code-route discovery 建立确定性证据。

同理，Payload collection/field 的静态配置发现不能单独证明实际数据库 migration 已执行。

### Exit criteria

进入五方交叉 Mapping 前，所有参与对账的事实都必须拥有可定位 sourceRef；未实现、部分实现、未知实现必须保留状态，不得被转换为 PASS。

下一阶段开始 **Step 07 Cross-System Mapping**，将五个事实面通过显式 mapping 连接，而不是继续复制合同内容。
