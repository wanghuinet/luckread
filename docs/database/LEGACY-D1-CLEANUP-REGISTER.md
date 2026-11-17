# Legacy D1 Cleanup Register

基准分支：`main`
基准提交：`0e23ac6784f58f78fba8ca001ff4896d2fdc0484`
本清理批次：`chore/legacy-d1-cleanup-batch-1`

本登记表区分生产数据库运行时依赖、仍可被选择的旧适配器，以及仅作为迁移来源保留的历史材料。名称中出现 `D1-01` 至 `D1-05` 的 Neon 数据库域编号、Hyperdrive binding 名称，不等同于 Cloudflare D1 运行时连接，不得据此删除。

## 状态定义

- `DELETE_NOW`：确认无调用方且不承担历史证据职责，立即删除。
- `REPLACE_THEN_DELETE`：业务入口仍存在旧实现，替换为 Neon 后删除旧实现。
- `DELETE_NEXT_VERSION`：存在本地/测试/兼容依赖，暂时保留；代码必须有 `@deprecated-next-version` 标记。
- `NEEDS_CONFIRMATION`：生产调用关系、资源归属或证据用途尚未完全确认，不得删除。

## 清理登记

| 文件路径 | Worker | 旧代码类型 | 当前状态 | 处理结果 / 保留原因 | Neon 替代实现 | 删除条件 | 目标版本 |
|---|---|---|---|---|---|---|---|
| `workers/W02-identity/src/index.ts` | W02 | D1 env 类型、多个 createD1* Store 入口及 Neon 缺省回退 | REPLACE_THEN_DELETE | 已有 Postgres runtime store composition，但路由仍在多个入口回退到 D1 store；不可只删类型而丢失账户状态、注册回滚、角色/MFA 等能力 | `workers/W02-identity/src/neon/runtime.ts` 中的 Postgres stores | 所有 D1 调用点改为必需 Postgres store；移除 D1 env、createD1* imports/calls；对应路由保留 fail-closed 行为 | 下一个版本 |
| `workers/W02-identity/src/neon/runtime.ts` | W02 | `d1` driver 默认值及旧 provider 选择 | DELETE_NEXT_VERSION | 当前 driver 未配置时默认 `d1`；生产 Neon 配置显式设置 `W02_DATABASE_DRIVER=neon`。本轮尚未核对所有本地/测试构造器 | 同文件 Postgres runtime | W02 所有入口及测试改为显式 Neon；不存在依赖 D1 默认值的 fixture | 下一个版本 |
| `workers/W02-identity/wrangler.jsonc` | W02 | D1 binding 和历史部署配置 | NEEDS_CONFIRMATION | 同目录 `wrangler.neon.jsonc` 为 D1-free 配置；旧配置还可能作为迁移来源或测试配置被脚本读取，不能仅凭重复配置删除 | `workers/W02-identity/wrangler.neon.jsonc` | 全仓确认无脚本、CI、测试、部署命令引用旧配置；确认迁移来源证据已独立归档 | 待确认后下一个版本 |
| `workers/W05-social/src/neon/runtime.ts` | W05 | D1 driver 默认值、D1 空依赖分支及 legacy fallback 选择 | REPLACE_THEN_DELETE | Neon Postgres stores 已覆盖社交读写与推送；但 runtime 仍允许 `d1` 分支并返回空依赖，不能在未清点 index.ts 所有 D1 store 入口前直接删除 | `workers/W05-social/src/entry.ts` 注入的 Postgres stores；同文件 Postgres composition | W05 所有业务路由只接受必需 Postgres stores；无 env.DB/D1 store 调用；推送端点继续使用独立 W09-owned Neon domain pool | 下一个版本 |
| `workers/W05-social/wrangler.jsonc` | W05 | 配置文件名称含 legacy D1 binding domain 编号的 Hyperdrive 配置 | NEEDS_CONFIRMATION | 当前配置显式选择 Neon，且绑定 `HYPERDRIVE_D1_02`、`HYPERDRIVE_D1_03` 实际承载 Neon 域连接；不可误删现有 Hyperdrive/Service Binding | 当前配置内现有 Neon Hyperdrive | 仅在确认 binding 改名不会破坏 Worker 配置、secret/部署脚本和资源映射后才可改名；本清理任务不创建新资源 | 待确认 |
| `workers/W08-creator/src/neon/runtime.ts` | W08 | D1 driver、D1_01 runtime 分支及 createD1 store fallback | REPLACE_THEN_DELETE | Postgres creator store 已存在且由 Neon runtime 选择；旧分支仍可被显式选择，需先核对 W08 配置和测试入口 | `createPostgresW08CreatorStore` / `getW08PostgresPool` | 所有 W08 入口与测试 fixture 只使用 Postgres store；移除 D1 类型、binding、factory 和 fallback | 下一个版本 |
| `workers/W07-subscription-commerce/src/index.ts` | W07 | D1_01/D1_04 Env 类型、selected runtime env 兼容注入 | NEEDS_CONFIRMATION | 文件同时包含 Neon membership/payment runtime 入口；需要逐路由确认 selected DB wrapper 是否仍被调用，不能直接删除以免影响订阅、支付、退款和 webhook | `src/neon/membership-database-runtime.ts`、`src/neon/payment-method-read-runtime.ts` 及对应 Postgres stores | W07 所有业务入口明确只使用 Neon stores；无 D1 注入/prepare/batch 路径；支付幂等和 webhook 状态写入保持原有边界 | 待确认 |
| `workers/W02-identity/wrangler.neon.jsonc` | W02 | 无；Neon 生产配置 | NEEDS_CONFIRMATION | 当前 Neon 生产配置；不是 D1 代码，必须保留 | 本文件本身 | 不适用 | 保留 |
| `workers/W05-social/src/entry.ts` | W05 | 无；Neon 生产入口 | NEEDS_CONFIRMATION | 明确组合 Neon 社交 stores 与独立 push endpoint Neon store；不是旧 D1 fallback | 本文件本身 | 不适用 | 保留 |

## 本轮结论

- 本轮已确认至少存在 W02、W05、W08、W07 的旧 D1 运行时代码/接口，不能宣称全仓 D1 清理完成。
- 本登记表是已发现项，不是全仓最终总表；后续批次必须继续覆盖 W01、W03、W06、W10、W11 及所有 Worker 的配置、脚本、测试和迁移目录。
- 历史 D1 migration、PostgreSQL 迁移来源、只读核对记录、不可逆操作记录、回滚证据，不因包含 D1 字样而自动列为删除项。
- `HYPERDRIVE_D1_01` 至 `HYPERDRIVE_D1_05` 若连接 Neon，只是沿用的数据库域命名；除非完成全链路重命名评估，否则保留。
- 本轮没有删除生产资源、部署 Worker、切换流量或修改线上数据库。
