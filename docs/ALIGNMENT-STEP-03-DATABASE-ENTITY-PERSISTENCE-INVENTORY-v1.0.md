# Luckread Five-Way Alignment — Step 03

## Database / Entity / Persistence Inventory v1.0

Status: **NOT_GREEN / discovery baseline**

### Purpose

建立 Feature 对应的数据事实入口，但不猜测 Payload/D1 实际 schema。

本阶段只登记：

- Entity Contract 中已经存在的实体；
- 实体实现位置；
- 当前持久化适配器；
- migration evidence；
- field contract 引用；
- 当前证据是否足以证明实际数据库落盘。

### Non-negotiable rules

1. Entity Contract 是领域实体事实源。
2. `implementationRef` 不等于数据库已验证。
3. `persistenceStatus=NOT_VERIFIED` 必须保持红/未绿状态。
4. 不允许根据 Payload 文档或模型记忆猜测表名、列名、索引或关系。
5. 实际数据库 schema 必须由 adapter、migration 或可重复 schema inspection 证据证明。
6. PROPOSED entity 不得被伪装成已经持久化。
7. 后续步骤必须把 Feature → Entity → Field → Persistence 建立显式映射。
8. Cloudflare/D1 是当前实现事实，不改变领域模型的 PostgreSQL portability 要求。

### Current baseline

`ENT-USER` remains the only domain entity currently classified `VERIFIED` in the Entity Catalog. However, the declared active Payload runtime authority is `workers/W01-payload/`, and the current W01 `Users.ts` contains `auth: true` with `fields: []`. The older root `src/collections/Users.ts` contains six profile/preference fields but is not the declared W01 runtime authority. Therefore the root source must not be used as current W01 implementation evidence.

The active W01 project uses `@payloadcms/db-d1-sqlite`. A dedicated Change Control record captures the source-path drift: `docs/change-control/CC-MAPPING-0-W01-RUNTIME-AUTHORITY-PATH-DRIFT-2026-09-18.md`.

Other identity, permission, subscription, and organization entities remain PROPOSED and must not be converted into database facts by inference.

### Exit criteria

本步骤只有在能够自动发现并证明以下关系后才能 GREEN：

`Entity → Field Contract → Payload Collection → Migration/Schema → Actual Persistence`

下一阶段继续建立 API Inventory，之后由 Cross-System Mapping 统一对账。 
