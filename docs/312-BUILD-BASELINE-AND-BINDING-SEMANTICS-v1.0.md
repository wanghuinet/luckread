# 312 — 构建基线与 Cloudflare 绑定语义契约

- **版本**：v1.0
- **状态**：P0 FROZEN
- **日期**：2026-09-13
- **Canonical Source**：本文档是「构建期 / 运行期 Cloudflare 绑定获取方式」的唯一权威定义
- **相关**：`300-ARCHITECTURE-BASELINE`、`311-FINAL-AUDIT-AND-GREEN-REPORT`

---

## 1. 背景

审计（见 `311`）判定代码开发准入为 RED，其中一项硬阻断是：

> `next build` 无法完成。

本文档记录该阻断的**根因、修复、验证结果**，并冻结构建期与运行期的绑定语义，
避免后续再次出现「本地能跑、构建失败」或「构建成功、迁移打到本地库」这类静默错误。

修复仅涉及 `src/payload.config.ts` 一个文件，**未新增任何 collection、业务逻辑或 API**，
因此不违反 Contract-First 门禁（契约冻结之前不得写功能代码）。

---

## 2. 缺陷清单（均已修复并验证）

### D-01 模块路径不存在 —— 构建直接失败

```
src/payload.config.ts:13   import migrations from './db/migrations'
```

| 问题 | 事实 |
|---|---|
| 路径不存在 | `src/db/` 不存在，实际迁移模块在 `src/migrations/index.ts` |
| 无别名兜底 | `tsconfig.json` 的 `paths` 仅含 `@/*` 与 `@payload-config`，无 `db` 映射 |
| 导入形式错误 | `src/migrations/index.ts` 仅导出 `export const migrations`，**无 default export** |

路径错误 + 导入形式错误 = 双重失效。`tsc` 与 webpack 均无法解析。

**修复**：`import { migrations } from './migrations'`

---

### D-02 构建期请求远程绑定 —— page data 收集阶段崩溃

`getPlatformProxy({ remoteBindings: isProduction })`。

`next build` 以 `NODE_ENV=production` 运行 → `isProduction === true` →
`remoteBindings: true` → Wrangler 尝试建立远程会话 → Cloudflare API 返回：

```
binding D1 of type d1 must have a valid `database_id` specified [code: 10021]
Failed to obtain a preview token
```

根因：`wrangler.jsonc` 中 `database_id` 仍为占位符 `"DATABASE_ID"`。

**关键约束（不得破坏）**：`remoteBindings` 不能简单地一律设为 `false`。
`deploy:database` 依赖 `payload migrate` 在 `NODE_ENV=production` 下打到**真实远程 D1**。
若构建期与迁移期共用同一开关而一律改本地，会导致**迁移写进本地 SQLite、线上库未更新**的静默故障。

**修复**：`remoteBindings: isProduction && isPayloadCLI`

| 场景 | `isProduction` | `isPayloadCLI` | remoteBindings | 结果 |
|---|---|---|---|---|
| `next build` | true | false | **false** | 本地代理，不触网 |
| `next dev` | false | false | false | 本地代理 |
| `payload migrate`（生产） | true | **true** | **true** | 真实远程 D1 ✅ |
| Worker 运行期 | — | — | 走 `getCloudflareContext` | 真实绑定 |

---

### D-03 分支判断依赖 `process.argv` —— 在构建 worker 中失效

原逻辑：

```ts
const cloudflare = isCLI || !isProduction
  ? await getCloudflareContextFromWrangler()
  : await getCloudflareContext({ async: true })
```

`isCLI` 通过检查 `process.argv` 是否匹配 `next/dist/bin/next` 来判断。

**失效原因**：Next 在 "Collecting page data" 阶段会 **fork 出独立 worker 进程**，
这些 worker 拥有自己的 `argv`，不匹配主进程的 CLI 路径 → `isCLI === false` →
落入 `getCloudflareContext()` 分支 → 试图建立远程连接 → 构建失败。

这也解释了为什么仅修复 D-02 无效：worker 根本没走 `getPlatformProxy`。

**修复**：改为**运行时检测**，不依赖 argv：

```ts
const isWorkerRuntime =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

const cloudflare = isWorkerRuntime
  ? await getCloudflareContext({ async: true })
  : await getCloudflareContextFromWrangler()
```

语义更清晰：**部署后的 Worker 内**用请求上下文绑定；**Node 环境**（dev / build / CLI）
一律走 Wrangler 平台代理。

---

## 3. ADR-B001：以运行时检测而非 argv 判断绑定来源

- **Decision**：用 `navigator.userAgent === 'Cloudflare-Workers'` 区分 Worker 与 Node。
- **Context**：`argv` 检测在 Next 构建 worker 中不可靠（子进程 argv 与主进程不同）；
  `NEXT_PHASE` 同样无法保证传播到 fork 出的 worker。
- **Alternatives**：
  1. 保持 argv 检测 —— 已验证失效。
  2. `NEXT_PHASE === 'phase-production-build'` —— 无法确认传播到 worker，风险高。
  3. 为 `wrangler.jsonc` 填入真实 `database_id` —— 只是绕过，未解决「构建不该触网」这一本质问题，
     且引入云资源依赖，使构建无法离线执行。
- **Reason**：运行时环境是唯一在**所有**进程形态下都稳定的信号。
- **Trade-offs**：依赖 workerd 的 `navigator.userAgent` 取值；若 Cloudflare 变更该标识需同步更新。
- **Consequences**：构建完全离线可执行，不依赖任何真实云资源。

---

## 4. 验证结果

| 检查项 | 命令 | 结果 |
|---|---|---|
| TypeScript | `tsc --noEmit -p tsconfig.json` | ✅ 0 error |
| 生产构建 | `next build --webpack` | ✅ Compiled successfully，静态页 6/6 |
| Contract CI | `node scripts/contract-ci.mjs` | ✅ GREEN |

构建产物路由表：

```
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin/[[...segments]]
├ ƒ /api/[...slug]
├ ƒ /api/graphql
├ ƒ /api/graphql-playground
└ ƒ /my-route
```

---

## 5. 构建通过 ≠ 可以开发

**构建 GREEN 只说明脚手架可编译，不代表契约已完备。** 以下阻断项依然存在：

| # | 阻断项 | 状态 |
|---|---|---|
| B-01 | `master` 分支 **0 commits**，313 个文件仅在 git index | 🔴 未解决 |
| B-02 | `wrangler.jsonc` 的 `database_id` 仍是占位符；R2 未创建 | 🔴 未解决 |
| B-03 | `collections: [Users, Media]`，领域集合 **0 个**，无 migration 基线 | 🔴 未解决 |
| B-04 | OpenAPI 缺 Block/Mute、Report/Appeal、Revision（RC-01~RC-03） | 🔴 API 仍 RED |
| B-05 | 文档编号重复 7 组；`215`/`216` 同名不同内容 | 🟡 已用别名表消解 |

**可立即开工的部分**（不依赖 D1 与 collection，契约已冻结）：
authz policy evaluator、state machine validator、cursor codec、idempotency key 编解码。

---

## 6. 不变量

- **INV-BUILD-001**：`next build` 不得建立任何远程 Cloudflare 连接。
- **INV-BUILD-002**：构建成功不依赖 `database_id` 是否为真实值。
- **INV-BUILD-003**：`payload migrate` 在 `NODE_ENV=production` 下必须作用于**远程** D1，
  禁止因构建优化而降级为本地绑定（否则产生静默迁移失败）。
