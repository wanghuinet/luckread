# Luckread Five-Way Alignment — Step 05

## Payload Inventory v1.0

Status: **NOT_GREEN / discovery gate**

### Purpose

将已经由 Payload AST discovery 证明的实际配置事实，提升为五方对账使用的 Payload inventory。

当前底层 discovery 已明确使用 `PAYLOAD_CONFIG_DISCOVERED` 分类；这表示事实来自 Luckread 实际 Payload 配置，而不是宣称它是 Payload 框架内置字段或能力。fileciteturn307file0

### Source hierarchy

```text
Payload runtime/version knowledge
        ↓
Luckread actual payload.config.ts
        ↓
AST discovery
        ↓
payload-native-inventory
        ↓
payload-alignment-inventory
```

### Non-negotiable rules

1. 不执行任意 Payload 配置代码来“猜”运行结果。
2. 静态分析无法解析的结构必须 BLOCK，而不是静默丢弃。
3. `PAYLOAD_CONFIG_DISCOVERED` ≠ Payload core native。
4. Collection/field 必须保留精确 sourceRef。
5. 重复 collection 或 field 必须阻断。
6. Payload inventory 是 implementation evidence，不是产品 Feature Contract。
7. 后续五方 mapping 必须通过精确 sourceRef / explicit mapping 建立关系，不做模糊语义推断。

### Exit criteria

GREEN 需要证明：

`Feature → Entity → Payload Collection → Payload Field → API/Code → Persistence`

每一条关系都必须有机器可验证的 evidence；无法证明的关系保持 `NOT_GREEN` 或 `BLOCKED`。

下一阶段进入 Code Evidence Inventory。
