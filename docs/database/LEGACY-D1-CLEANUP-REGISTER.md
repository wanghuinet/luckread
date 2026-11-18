# Legacy D1 Cleanup Register

基准分支：`main`
基准提交：`74b30e495341c3c72f936ac694eab1c3864b96a2`
本清理批次：`chore/legacy-d1-cleanup-batch-3`

本登记表区分生产数据库运行时依赖、仍可被选择的旧适配器，以及仅作为迁移来源保留的历史材料。名称中出现 `D1-01` 至 `D1-05` 的 Neon 数据库域编号、Hyperdrive binding 名称，不等同于 Cloudflare D1 运行时连接，不得据此删除。

## 状态定义

- `DELETE_NOW`：确认无调用方且不承担历史证据职责，立即删除。
- `REPLACE_THEN_DELETE`：业务入口仍存在旧实现，替换为 Neon 后删除旧实现。
- `DELETE_NEXT_VERSION`：存在本地/测试/兼容依赖，暂时保留；代码必须有 `@deprecated-next-version` 标记。
- `NEEDS_CONFIRMATION`：生产调用关系、资源归属或证据用途尚未完全确认，不得删除。
- `DONE`：对应 D1 运行时代码和测试适配器已从当前 main 删除；历史来源资料仍按各自分类保留。

## 清理登记

| 文件路径 | Worker | 旧代码类型 | 当前状态 | 处理结果 / 保留原因 | Neon 替代实现 | 删除条件 | 目标版本 |
|---|---|---|---|---|---|---|---|
| `workers/W02-identity/src/index.ts` | W02 | D1_01 Env binding、createD1* 路由 fallback、D1 scheduled publisher | REPLACE_THEN_DELETE | **本批已完成：** 生产 HTTP 路由与 scheduled handler 全部要求 Neon runtime；账户状态、注册回滚、MFA、用户名、会话、L8 bootstrap、RoleAssignment 和三类 Queue publisher 均改用 Postgres Stores；文件中已无 D1 binding / createD1 / D1 publisher 引用 | `workers/W02-identity/src/neon/runtime.ts` 与对应 `src/neon/*-postgres.ts` | 本批已移除 W02 Worker 生产入口中的 D1 fallback；后续仅清理测试专用 D1 adapter | 本批完成 |
| `workers/W02-identity/src/neon/runtime.ts` | W02 | D1 database driver option / default | REPLACE_THEN_DELETE | **本批已完成：** driver resolver 只接受显式 `W02_DATABASE_DRIVER=neon`；缺失值和 `d1` 均失败关闭；保留原有 Hyperdrive pool 和所有 PostgreSQL Stores | 同文件 PostgreSQL runtime | D1 provider selection 已从 W02 runtime 删除；保留 Neon-only resolver | 本批完成 |
| `workers/W02-identity/src/auth/principal.ts` | W02 | D1 principal authority Store fallback | REPLACE_THEN_DELETE | **本批已完成：** 默认 principal authority 只从 W02 Neon runtime 取 Postgres Store；测试仍可通过明确的 Store 注入 | `src/neon/principal-authority-postgres.ts` | 生产路径已无 D1 principal Store fallback；测试只需保留纯 Store fixture | 本批完成 |
| `workers/W02-identity/src/auth/better-auth.ts` | W02 | Better Auth D1 environment / D1 database lifecycle adapter profile | DELETE_NEXT_VERSION | `createLuckReadAuth` 现已只构造现有 Neon Hyperdrive pool；显式 D1 仅留在 `buildLuckReadAuth` 的旧 schema/test fixture profile，并由 `@deprecated-next-version` helper 限定，不可作为生产入口 | Better Auth PostgreSQL pool、`mfa-factor-state-postgres.ts`、`mfa-audit-operation-receipts-postgres.ts`、Neon lifecycle callbacks | Better Auth schema/test fixture 改为 PostgreSQL 或隔离 in-memory fixture 后，删除 `D1_01` 类型、`requireLegacyW02D1Database`、D1 hooks 和 `activateVerifiedAccount` | 下一个版本 |
| `workers/W02-identity/src/auth/principal-store.ts` | W02 | D1 PrincipalAuthorityStore adapter | DONE | PR #1939 removed the unreferenced D1 factory and its legacy D1 dependencies; production continues to use the Neon PostgreSQL Store | `src/neon/principal-authority-postgres.ts` | No D1 adapter remains in this module | PR #1939 |
| `workers/W02-identity/src/authz/role-layer-store.ts` | W02 | D1 RoleLayerStore adapter | DONE | PR #1940 removed the legacy D1 SQL adapter; the provider-neutral contract and Neon PostgreSQL implementation remain | `src/neon/role-layer-postgres.ts` | No D1 adapter remains in this module | PR #1940 |
| `workers/W02-identity/src/authz/role-assignment-command.ts` | W02 | D1 CreatorRoleGrant adapter | DELETE_NEXT_VERSION | The legacy D1 creator-role grant factory remains separately scoped; production continues to use the injected Neon Store | `src/neon/creator-role-grant-store-postgres.ts` | Move the remaining creator-role grant tests to PostgreSQL/in-memory Store fixtures, then remove the D1 factory | Next version |
| `workers/W02-identity/src/account/account-state-transition-store.ts` | W02 | D1 account-state transition Store adapter | DELETE_NEXT_VERSION | The D1 fixture is still retained in the account-state Store module; production continues to use the PostgreSQL Store | `src/neon/account-state-transition-store-postgres.ts` | Move account-state Store tests to PostgreSQL/in-memory fixtures, then remove the D1 adapter | Next version |
| `workers/W02-identity/src/auth/registration-rollback-store.ts` and its tests | W02 | D1 registration rollback Store adapter and D1-specific fixtures | DONE | Removed the D1 factory, D1-only normalizers and D1 fake tests; PostgreSQL Store tests preserve normalized identity matching, rollback idempotency, ownership/pending-state/session guards and atomic delete order | `src/neon/registration-rollback-postgres.ts` | No D1 adapter or D1 fixture remains in the registration rollback Store module/tests; historical migration sources are untouched | Current slice |
| `workers/W02-identity/src/auth/mfa-audit-operation-receipt-store.ts`、`src/auth/mfa-enrollment-start-store.ts`、`src/auth/mfa-enrollment-confirm-store.ts`、`src/auth/mfa-factor-state-store.ts`、`src/auth/mfa-status.ts` | W02 | D1 MFA receipts / enrollment / factor-state / status adapters | DELETE_NEXT_VERSION | 所有 D1 factory 已添加统一标记；生产 Better Auth 与 MFA handlers 由 Neon runtime 提供相应 Store | `src/neon/mfa-audit-operation-receipts-postgres.ts`、`mfa-enrollment-start-postgres.ts`、`mfa-enrollment-confirm-postgres.ts`、`mfa-factor-state-postgres.ts` | MFA 单元与集成测试使用 PostgreSQL/in-memory Store 后，删除 D1 adapter 及其依赖 SQL | 下一个版本 |
| `workers/W02-identity/src/auth/session-list-store.ts`、`src/auth/session-revoke-store.ts`、`src/auth/session-logout-store.ts`、`src/auth/username-change-store.ts` | W02 | D1 session / username adapters | DELETE_NEXT_VERSION | D1 factory 已添加统一标记；生产会话和用户名路由全部注入 Neon Stores，认证仍由 Better Auth 和 W02 负责 | `src/neon/session-list-postgres.ts`、`session-revocation-postgres-store.ts`、`session-logout-postgres-store.ts`、`username-change-postgres.ts` | 相关 contract tests 全部使用 Neon/in-memory Store 后删除 D1 factories | 下一个版本 |
| `workers/W02-identity/src/account/publication-journal-publisher.ts`、`src/auth/mfa-audit-publication-journal.ts`、`src/auth/session-revocation-publication-journal.ts` | W02 | D1 scheduled Queue publishers | DELETE_NEXT_VERSION | 三个旧 D1 publisher 均已添加统一标记；生产 scheduled handler 已改用三个 Neon PostgreSQL publisher，并继续使用原有 AUTH013_QUEUE / AUTH013_PROJECTION_QUEUE | `src/neon/account-state-publication-journal-publisher-postgres.ts`、`mfa-audit-publication-journal-publisher-postgres.ts`、`session-revocation-publisher-postgres.ts` | Queue publisher contract tests 使用 Neon/Postgres 实现后删除 D1 SQL publishers；不改 Queue 名称或绑定 | 下一个版本 |
| `workers/W02-identity/src/auth/totp-replay-guard.ts`、`src/auth/mfa-audit-events.ts`、`src/auth/mfa-audit-receipts.ts`、`src/auth/session-revocation-events.ts` | W02 | D1 MFA replay / audit / revocation SQL helpers | DELETE_NEXT_VERSION | D1 helper/factory 已添加统一标记；生产使用 Neon factor-state、receipt、session revocation Stores | 对应 `src/neon/*-postgres.ts` MFA / audit / session Stores | 删除依赖这些 D1 prepared statements 的旧 adapter 后删除 helper；保留安全事件语义和幂等性 | 下一个版本 |
| `workers/W02-identity/src/authz/l8-genesis-bootstrap-readiness.ts`、`src/authz/l8-genesis-bootstrap-command.ts` | W02 | D1 L8 bootstrap read/write functions | DELETE_NEXT_VERSION | 生产 W02 route 已直接调用 PostgreSQL readiness/bootstrap 实现；D1 helper 留作旧 test fixture 并已加标记 | `src/neon/l8-genesis-bootstrap-postgres.ts` | L8 tests 全部迁移到 PostgreSQL fixture 后删除 D1 helpers；不改变 OIDC、单审批和一次性状态安全要求 | 下一个版本 |
| `workers/W02-identity/src/authz/role-assignment.ts` | W02 | D1 base/verified role materialization and global-layer query helpers | DELETE_NEXT_VERSION | D1 role helper functions 已添加统一标记；Better Auth 生产生命周期使用 Neon role assignment PostgreSQL helpers；principal resolution 由 Neon Store 提供 | `src/neon/role-assignment-postgres.ts`、`src/neon/principal-authority-postgres.ts` | 所有角色分配测试和 D1 Better Auth fixture 迁移到 Neon/in-memory role Store 后删除 D1 SQL helpers | 下一个版本 |
| `workers/W02-identity/src/authz/role-version.ts` | W02 | D1 role_authorization_versions read/upsert helpers | DELETE_NEXT_VERSION | 已添加统一标记；Neon `readRoleVersionPostgres` 和数据库触发器已提供等价角色版本行为 | `src/neon/role-assignment-postgres.ts`、W02 PostgreSQL role-version triggers | 角色版本测试使用 PostgreSQL runtime rehearsal/Store helper 后删除 D1 statements | 下一个版本 |
| `workers/W02-identity/src/auth/mfa-challenge-account-state.ts` | W02 | D1 account_state lookup for MFA challenge | DELETE_NEXT_VERSION | 已添加统一标记；旧 D1 MFA factor-state Store 是其唯一兼容消费者 | `src/neon/mfa-factor-state-postgres.ts` 的 `isActiveMfaSubjectPostgres` | D1 factor-state adapter 和相关 D1 test fixture 删除后移除本文件 | 下一个版本 |
| `workers/W02-identity/src/account/account-state-transition.ts` | W02 | D1 authorization / transition / email verification SQL and batch helpers | DELETE_NEXT_VERSION | 三个 D1 transition helper 已添加统一标记；生产账户状态路由和 Better Auth verification lifecycle 均使用 Neon PostgreSQL Store | `src/neon/account-state-transition-store-postgres.ts`、`src/neon/email-verification-activation-postgres.ts` | D1 account state Store 和旧 Better Auth D1 schema/test profile 删除后，移除 D1-only functions；纯状态机 contract 保留 | 下一个版本 |
| `workers/W02-identity/wrangler.jsonc` | W02 | 历史 D1 source binding / Wrangler config | NEEDS_CONFIRMATION | 仍被历史只读证据、部署对照工作流、Neon schema-source contracts / 生成器引用；不得与生产 `wrangler.neon.jsonc` 混淆 | `wrangler.neon.jsonc` | 将旧 D1 binding 的来源证据归档并逐项迁移所有有效 CI/部署引用后再删除；本批不删 | 待确认 |
| `workers/W02-identity/migrations/**` | W02 | D1/SQLite migration lineage and schema-generation source | NEEDS_CONFIRMATION | W02 Neon PostgreSQL migration artifacts以这些历史 D1 migrations 为 schema 来源；Better Auth schema-only config 已经改为纯 PostgreSQL profile，不再声明或构造 D1 binding | W02 `src/neon-postgres-migrations/**`、Better Auth pinned PostgreSQL schema CLI output | PostgreSQL schema generator、lineage manifest 和 migration review 不再依赖这些来源文件，且审计/回滚证据已独立留档后才能删除；本批保留历史来源 | 待确认 |

| `workers/W05-social/src/repost-store.ts`、`share-store.ts`、`profile-pin-store.ts` 及对应 runtime | W05 | Repost、Share、Profile Pin 的 D1 默认适配器、运行时 `D1Database` 参数及路由 `env.DB` 回退 | DELETE | **本批已完成：** 三个 runtime 仅接受必需 Store；路由缺失 Store 时 fail closed；PostgreSQL Store 使用现有 D1-02 Neon Hyperdrive；Store modules 中 D1 专用 adapters 已删除 | `createPostgresRepostStore`、`createPostgresShareStore`、`createPostgresProfilePinStore` | 保留 W03 发布/owner 权限验证、双向 Block 过滤、幂等键、Profile Pin owner-only 限制和已发布内容校验 | 本批完成 |
| `workers/W05-social/src/block-mute-runtime.ts`、`src/block-mute-list-read-store.ts`、`src/block-mute-relation-store.ts`、`src/relationship-graph-runtime.ts`、`src/relationship-graph-store.ts` | W05 | Block/Mute 列表、关系写入与 Relationship Graph 的 D1 Store factories / runtime 默认回退 | DELETE | **本批已完成：** 三组 runtime 仅接受注入的 PostgreSQL Store；缺少 Store composition 时返回 503；D1 adapters 与 SQL fixtures 已移除，路由测试改为内存 Store；现有 PostgreSQL Stores 和 Neon D1-02 composition 保留 | `block-mute-list-read-store-postgres.ts`、`block-mute-relation-store-postgres.ts`、`relationship-graph-store-postgres.ts`、`src/neon/runtime.ts` | 保留 Block/Mute 幂等 upsert、双向 Block 隐藏关系、Mute 独立性、缓存失效及列表游标；不改变 W05/W09 所有权 | 本批完成 |
| `workers/W05-social/src/notification-push-delivery-runtime.ts`、`src/notification-push-fanout-runtime.ts`、`src/notification-push-fanout-store.ts`、`src/notification-push-send-result-store.ts` 及 push 专用 D1 adapters | W05 | Durable push fan-out、delivery claim、send result、receipt 与 W09 endpoint access 的 D1 Store fallback | DELETE | **本批已完成：** scheduled push 执行器及 fan-out 仅接受注入 Store；W05 outbox/delivery/receipt 和 W09 endpoint 均使用 PostgreSQL Store；专用 D1 adapters 与 D1-only 测试已删除 | `createPostgresNotificationPushFanoutStore`、`createPostgresNotificationPushDeliveryClaimStore`、`createPostgresNotificationPushSendResultStore`、`createPostgresNotificationPushReceiptStore`、`createPostgresNotificationPushEndpointAccessStore` | scheduled workflow 必须持有完整 Neon Store composition；缺少任一 Store 即 fail closed；W09 仍独占 endpoint registry，W05 仅保留既定委托读/清理操作 | 本批完成 |
| `workers/W05-social/src/notification-preferences-store.ts`、`src/social-closure-runtime.ts`、`src/index.ts` | W05 | Notification Preferences 的 D1 query executor、D1 Store factory、runtime D1 resolver 与路由 `env.DB` fallback | DELETE | **本批已完成：** Preferences Store port 只保留接口与错误类型；social-closure runtime 只接受注入 Store，路由缺少 Store 时 fail closed；W05 Neon composition 继续复用既有 PostgreSQL Store | `notification-preferences-store-postgres.ts`、`src/neon/runtime.ts` | 保留默认开启、用户隔离、PATCH 部分字段原子 upsert；不删除仍由其他 social closure 功能使用的 D1 env 类型 | 本批完成 |
| `workers/W05-social/src/notification-enqueue-store.ts`、`src/social-closure-runtime.ts`、`src/index.ts` | W05 | Notification Enqueue 的 D1 query executor、D1 Store factory、runtime resolver、token-sync 隐式 D1 enqueue fallback 与路由 `env.DB` 注入 | DELETE | **本批已完成：** Notification Enqueue Store port 只保留接口与错误类型；runtime 和路由只接受 Neon Store；token sync 新 mention 通知必须通过显式注入的 enqueue Store；D1 fallback 已删除 | `notification-enqueue-store-postgres.ts`、`src/neon/runtime.ts` | 保留双向 Block 抑制、通知偏好检查、唯一去重、稳定重试输入和 PostgreSQL outbox trigger；通知写入仍为 best-effort side effect | 本批完成 |
| `workers/W05-social/src/social-token-sync-store.ts`、`src/social-closure-runtime.ts`、`src/index.ts` | W05 | Social Token Sync 的 D1Database adapter、D1 Store resolver 与三处路由 `env.DB` fallback | DELETE | **本批已完成：** Social Token Sync Store port 仅保留类型/接口/错误；runtime 要求显式注入 Store，路由不再回退到 `env.DB`；保留现有 Neon PostgreSQL composition | `social-token-sync-store-postgres.ts`、`src/neon/runtime.ts` | 保留 W03 内容发布与 owner 验证、comment owner/published 验证、历史 mention 身份不可重绑、topic upsert/edge attach、mention 幂等插入和 best-effort 通知；SocialTargetsReadStore/D1 closure reader 不在本批范围 | 本批完成 |
| `workers/W05-social/src/social-closure-read-store.ts`、`src/social-targets-read-store.ts`、`src/social-closure-runtime.ts`、`src/index.ts` | W05 | Social Closure Read / Social Targets Read 的 D1 adapters、runtime resolver 与 `env.DB` 路由 fallback | DELETE | **本阶段已完成：** 删除 D1 closure/targets adapters 和双路 resolver；topic page/discovery、通知列表与已读、内容社交摘要、comment mention/topic reads 全部要求同一个 Neon PostgreSQL `SocialClosureReadStore`；缺失 Store 时 fail closed 503；测试改用内存 Store Fixture，PostgreSQL SQL 行为由专用 adapter tests 覆盖 | `social-closure-read-store-postgres.ts`（包含 `getTargets`）及 `src/neon/runtime.ts` 现有 D1-02 Hyperdrive pool | 保留 W03 内容状态权威、收件人隔离、通知游标、发现页有界分页/缓存、mention immutable user ID；不改变 W09 push endpoint 所有权或 D1-02 逻辑域编号 | 本阶段完成 |
| `workers/W05-social/src/comment-notification-context-store.ts`、`src/comment-notification-context-runtime.ts`、`src/index.ts` | W05 | Comment Reply / Comment Like 通知上下文的 D1 adapter、双路 resolver 与 `env.DB` fallback | DELETE | **本阶段已完成：** 移除 D1 adapter 和 runtime resolver；评论回复与评论点赞要求注入 PostgreSQL `CommentNotificationContextStore`；缺少 Store 时在创建回复/写入点赞前 fail closed 503 | `comment-notification-context-store-postgres.ts` 与 `src/neon/runtime.ts` 现有 D1-02 Hyperdrive pool | 保留仅读取 PUBLISHED 评论的最小投影、W03 对内容状态的权威校验、通知收件人使用评论作者、回复/点赞副作用顺序；不修改通知 outbox 的 best-effort 与幂等契约 | 本阶段完成 |
| `workers/W05-social/src/neon/runtime.ts` | W05 | D1 driver 默认值、D1 空依赖分支及 legacy fallback 选择 | DELETE_NEXT_VERSION | Neon Postgres stores 已覆盖社交读写与推送；但 runtime 仍允许 `d1` 分支并返回空依赖，不能在未清点 index.ts 所有 D1 store 入口前直接删除 | `workers/W05-social/src/entry.ts` 注入的 Postgres stores；同文件 Postgres composition | W05 所有业务路由只接受必需 Postgres stores；无 env.DB/D1 store 调用；推送端点继续使用独立 W09-owned Neon domain pool | 下一个版本 |
| `workers/W05-social/wrangler.jsonc` | W05 | 配置文件名称含 legacy D1 binding domain 编号的 Hyperdrive 配置 | NEEDS_CONFIRMATION | 当前配置显式选择 Neon，且绑定 `HYPERDRIVE_D1_02`、`HYPERDRIVE_D1_03` 实际承载 Neon 域连接；不可误删现有 Hyperdrive/Service Binding | 当前配置内现有 Neon Hyperdrive | 仅在确认 binding 改名不会破坏 Worker 配置、secret/部署脚本和资源映射后才可改名；本清理任务不创建新资源 | 待确认 |
| `workers/W08-creator/src/neon/runtime.ts` | W08 | D1 driver 选择、D1_01 env 及 createD1 runtime fallback | REPLACE_THEN_DELETE | **本批已完成：** 删除 D1 driver、D1_01 类型/注入和 store fallback；生产入口始终使用现有 Neon Hyperdrive 与 PostgreSQL creator store | `createPostgresW08CreatorStore` / `getW08PostgresPool` | D1 生产运行入口已移除；该文件保留 Neon provider 实现 | 本批完成 |
| `workers/W08-creator/src/authz/handler.ts`、`src/authz/role-layer.ts` | W08 | CASL 权限读取和 RoleAssignment context 的 D1 SQL 分支 | REPLACE_THEN_DELETE | **本批已完成：** 移除 D1 账户状态查询及 D1 role-layer resolver；鉴权读取统一调用 W02 身份服务及 W08 Neon PostgreSQL | `resolvePermissionContextPostgres`、W08 现有 Hyperdrive pool | D1 权限读取代码已移除；保留 Neon 查询、L0-L8 fail-closed 策略和 W02 Service Binding | 本批完成 |
| `workers/W08-creator/src/creator-store-d1.test-adapter.ts`、`src/index.runtime.test.ts` | W08 | Legacy D1 Store 与 W08D1Database / W08D1PreparedStatement 测试适配 | DELETE | **本批已完成：** worker runtime tests 已改用内存 `W08CreatorStore` fixture；D1 adapter 与测试专用 D1 types 已删除 | 生产：`createPostgresW08CreatorStore`；测试：`MemoryW08CreatorStore` | W08 的 12 项 Worker 运行时与生命周期测试继续覆盖 Store 接口，不再执行 SQL 字符串 D1 模拟；Neon 生产 Store 与 W02 Service Binding 保持不变 | 本批完成 |
| `workers/W07-subscription-commerce/src/index.ts` | W07 | D1_01/D1_04 Env 类型、selected runtime env 兼容注入 | NEEDS_CONFIRMATION | **本批已完成选择层首轮收口：** 两个数据库 driver 缺失时均 fail closed，不再默认回退 D1；只有显式 `W07_DATABASE_DRIVER=d1` / `W07_MEMBERSHIP_DATABASE_DRIVER=d1` 才保留旧测试/兼容路径，并已标注 `@deprecated-next-version`。但 index 与业务模块仍使用 D1-compatible SQL facade，不能据此宣称 W07 全部 Neon-native | `src/neon/membership-database-runtime.ts`、`src/neon/payment-method-read-runtime.ts`、现有 Neon Hyperdrive 与对应 Postgres stores | 逐路由移除 D1_01/D1_04 注入和 SQL facade；订阅/支付/退款/webhook 使用原生 PostgreSQL stores，保持幂等和事务边界 | 待确认 |
| `workers/W01-payload/src/payload-database-driver.ts` | W01 | Payload D1/SQLite provider selector | DELETE_NEXT_VERSION | 生产 Neon config 已选择 PostgreSQL，但 provider resolver 仍允许 D1 binding 选择；本轮先明确标记，保留 CLI/test 来源直到完全收敛 | `workers/W01-payload/src/neon-postgres-adapter.ts` | Payload CLI、schema generation 和所有受支持测试均不再需要 D1 adapter；删除 D1 selection、binding 类型和依赖 | 下一个版本 |
| `workers/W01-payload/src/payload.config.ts` | W01 | `sqliteD1Adapter` runtime branch | DELETE_NEXT_VERSION | Neon 是生产运行目标；D1 branch 仍由 resolver 暴露，不能只删 import 而不处理 Payload CLI/test 入口 | `createW01NeonPostgresAdapter` | 所有 Payload runtime/CLI 入口只使用 Neon；D1 migration source 已由 PostgreSQL schema-source tooling 独立保留 | 下一个版本 |
| `workers/W01-payload/wrangler.jsonc` | W01 | D1 binding config | NEEDS_CONFIRMATION | 当前文件内容已显式设为 Neon driver，但仍含 `d1_databases`；另有 D1-free `wrangler.neon.jsonc`。需要确认部署 workflow 和开发工具的实际配置入口 | `workers/W01-payload/wrangler.neon.jsonc` | 所有 deploy/build/dev/CI 命令统一使用 D1-free config，且旧配置不再作为迁移源 | 待确认 |
| `workers/W06-governance/src/neon/moderation-database-runtime.ts` | W06 | D1 driver branch、D1Database facade | DELETE_NEXT_VERSION | Neon pool 已存在，但 moderation consumers 仍依赖 D1Database facade；不能在未替换消费者前删除 | `getW06ModerationPostgresPool`、`createPostgresModerationQueueReadStore` | Moderation/report/audit/queue 全部改为 PostgreSQL-native repository 和 transaction API | 下一个版本 |
| `workers/W06-governance/src/neon-postgres-d1-database.ts` | W06 | PostgreSQL-to-D1 SQL/batch compatibility shim | DELETE_NEXT_VERSION | 这是实际 Neon 查询外面的一层 D1/SQLite 兼容接口，包含问号占位符、changes()、D1 batch 事务模拟；不能当作原生 Neon 实现 | PostgreSQL-native moderation repositories | 全部调用方不再使用 D1PreparedStatement/D1Result；删除 SQL translator、D1 result normalizer 和 facade | 下一个版本 |
| `workers/W06-governance/src/audit-event-persistence.ts`、`src/auth-013-queue-consumer.ts`、`src/mfa-audit-queue-consumer.ts`、`src/session-revocation-audit-queue-consumer.ts` | W06 | D1Database 参数/队列持久化 | NEEDS_CONFIRMATION | 命中 D1 类型；需逐项确认是否统一通过 D1 facade、是否已由 W09 audit authority 接管，以及 Queue 重放/幂等边界 | W09 append-only audit adapter、W06 PostgreSQL stores | 明确 audit event 的唯一写入所有者和事务边界，再移除 D1 参数与兼容 SQL | 待确认 |
| `workers/W11-growth-campaign-analytics-operations/src/entry.ts`、`src/worker.ts` | W11 | Neon 数据库注入 D1_05 接口、SQLite schema probe | DELETE_NEXT_VERSION | entry 已强制 Neon，但仍把 Neon facade 注入 D1_05；worker 仍使用 sqlite_master、D1 prepare/batch 合约 | `src/analytics-postgres-runtime.ts` 及待建立的原生 PG analytics stores | Worker health probe、ingestion、dedupe、rollup 全部使用 PostgreSQL-native SQL/API；删除 D1_05 facade 和 SQLite catalog 查询 | 下一个版本 |
| `workers/W11-growth-campaign-analytics-operations/wrangler.jsonc` | W11 | 生产配置仍声明 D1_05 binding | NEEDS_CONFIRMATION | 与 Neon-only entry 不一致：配置含 Cloudflare D1 binding，却未声明 entry 所需的 `W11_DATABASE_DRIVER=neon` 和 `HYPERDRIVE_ANALYTICS_PG`。不能直接删 binding，否则可能令当前 Worker 无法连接数据库 | W11 Neon analytics Hyperdrive entry | 确认并提交可部署的 Neon Wrangler 配置，证明 W11 production binding 已指向现有 D1-05 logical domain 的 Neon 数据库后，删除 d1_databases | 待确认 |

| `workers/W05-social/src/entry.ts` | W05 | 无；Neon 生产入口 | NEEDS_CONFIRMATION | 明确组合 Neon 社交 stores 与独立 push endpoint Neon store；不是旧 D1 fallback | 本文件本身 | 不适用 | 保留 |

| `.github/workflows/auth-001-registration-local-evidence.yml`、`workers/W01-payload/scripts/auth-001-registration-runtime-evidence-local.mjs`、`workers/W01-payload/scripts/auth-010-session-list-runtime-evidence-local.mjs` | W01/W02 | 旧证据流程将 W02 Better Auth user/session 查询及本地 schema 仍放在 D1_01；W01 Payload 投影 D1 test fixture | REPLACE_THEN_DELETE / DELETE_NEXT_VERSION | **本批已完成 W02 替换：** AUTH-001 在临时 PostgreSQL 18 应用 W02 Neon core/custom schema，W02 Worker 使用 `wrangler.neon.jsonc`；AUTH-001 / AUTH-010 的 W02 user/session/RoleAssignment/revocation-journal 查询和清理均通过本地 Neon PostgreSQL 客户端。仅 W01 Payload 本地 projection / consent / registration-envelope fixture 仍使用隔离 D1 | W02 既有 Neon Postgres runtime 和 migrations；W01 Payload 的 Neon adapter 与 Postgres migration schema | W02 D1 证据路径已本批移除；下一个版本将 W01 local D1 evidence fixture 迁移到 Payload Neon PostgreSQL runtime rehearsal 后，删除脚本中的 `wrangler d1 execute`、D1 local config rewrite 和本地 D1 persistence | W01 fixture 下一个版本；W02 替换本批完成 |

## 第三批 W02 代码处置

- W02 生产 runtime resolver 现在只接受显式 `W02_DATABASE_DRIVER=neon`；缺省与 `d1` 均失败关闭。
- `workers/W02-identity/src/index.ts` 已删除 `D1_01` Env、createD1 Store fallback、D1 L8 bootstrap 分支和 D1 scheduled Queue publishers；HTTP 与 scheduled 入口都只使用 Neon PostgreSQL Stores。
- AUTH-001 / AUTH-010 runtime evidence 已把 W02 schema、identity、session、RoleAssignment 和审计数据迁到临时 Neon PostgreSQL 18；W01 Payload 本地 D1 仅限测试投影 fixture，已单独登记下个版本删除。
- `src/auth/principal.ts` 已移除 D1 principal Store fallback；`createLuckReadAuth` 已改成只创建 Neon Better Auth instance。
- D1 Better Auth schema/test fixture 与 D1 Store/Queue publisher helpers 保留在源码供现存测试使用，全部加了 `@deprecated-next-version` 标记及 Neon 替代实现；不再由生产 W02 entrypoint 选择。
- `wrangler.jsonc`、D1 migrations 和 `neon-postgres-schema.config.ts` 暂留为迁移来源/历史审计/CLI schema-source，按 NEEDS_CONFIRMATION 登记；生产配置仍是 D1-free 的 `wrangler.neon.jsonc`。

## 第二批代码标记

以下文件已添加统一 `@deprecated-next-version` 标记：

- `workers/W01-payload/src/payload-database-driver.ts`
- `workers/W06-governance/src/neon/moderation-database-runtime.ts`
- `workers/W06-governance/src/neon-postgres-d1-database.ts`
- `workers/W11-growth-campaign-analytics-operations/src/entry.ts`
- `workers/W11-growth-campaign-analytics-operations/src/worker.ts`

## 第二批 W08 代码处置

- W08 Neon runtime、CASL handler、role-layer resolver：D1 生产调用分支已删除，Neon-only 代码保留。
- W08 creator D1 Store、statement/database 类型及 SQL-string mock 已从 worker runtime tests 删除；测试统一注入内存 `W08CreatorStore` fixture。
- W08 worker 使用可注入 Store port 的 factory；生产默认实例仍调用 Neon Store provider。`creator-store.ts` 现在只包含 Postgres store 与共享类型，不含 D1 adapter。未改变 W02 Service Binding。

## 本轮代码标记

以下实际运行时代码已添加统一 `@deprecated-next-version` 标记，原因、替代方案及删除条件均写入代码注释：

- `workers/W02-identity/src/neon/runtime.ts`
- `workers/W05-social/src/neon/runtime.ts`

## 第二批清理结果

- W08 生产 runtime 中的 D1 provider、D1 binding 类型、D1 Store fallback 已删除；W08 的 CASL 账户状态与 RoleAssignment 读取不再使用 D1 接口。
- W08 不再保留 D1 Store 测试适配器或 D1 测试数据库类型；worker runtime tests 使用内存 Store fixture。
- 本批不改动 W08 已存在的 Neon Hyperdrive、W02_AUTH Service Binding、CASL 安全判断和业务 Store 事务。

## 本轮结论

- 第三批已清理 W02 生产 Worker D1 路由、scheduled publisher 和 Better Auth 工厂回退；剩余 D1 适配仅在显式测试/schema profile 中保留，待下一个版本删除。
- W05 scheduled push delivery、Repost、Share、Profile Pin 的 D1 fallback 已删除；其他 W05 social HTTP routes 仍有 D1 Store fallback，W06、W07、W01、W11 也有未收口项，不能宣称全仓 D1 清理完成。
- 本登记表是已发现项，不是全仓最终总表；后续批次必须继续覆盖 W01、W03、W06、W10、W11 及所有 Worker 的配置、脚本、测试和迁移目录。
- 历史 D1 migration、PostgreSQL 迁移来源、只读核对记录、不可逆操作记录、回滚证据，不因包含 D1 字样而自动列为删除项。
- `HYPERDRIVE_D1_01` 至 `HYPERDRIVE_D1_05` 若连接 Neon，只是沿用的数据库域命名；除非完成全链路重命名评估，否则保留。
- 本轮没有删除生产资源、部署 Worker、切换流量或修改线上数据库。


## W05 Comment List Read

- Removed the D1 comment-list query dialect, D1 executor adapter, and automatic runtime resolver.
- Comment list routes now require the injected Neon PostgreSQL `CommentListReadStore`; missing composition returns 503 rather than falling back to `env.DB`.
- Preserved published-comment visibility, bounded recursive replies, cursor scope, relevant/recent/liked ordering, viewer block/mute filtering, mention identity, and viewer like state.
- Tests now exercise the Store port using a PostgreSQL query fixture; the production PostgreSQL adapter remains the only database adapter.

## W05 Following-feed Author Read

- Removed `FollowingAuthorIdsD1QueryExecutor` and `createD1FollowingAuthorIdsReadStore`.
- `listFollowingAuthorIds` now accepts only `FollowingAuthorIdsReadStore`; the Following-feed route requires the injected Neon PostgreSQL Store and fails closed with 503 when missing.
- Updated tests to remove the D1 fallback expectation and verify that missing composition does not touch `env.DB`.
- Preserved the 500-author bounded candidate window, bidirectional Block filtering, viewer-directed Mute filtering, deterministic ordering, and W03 content authority.
- This slice does not clean up the separate Follow/Unfollow writer, follower/following list reader, or Follow status reader; those remain separate work items.


## W02 Role Layer Store

- Removed the deprecated D1 `RoleLayerStore` adapter and its D1-only SQL fixture.
- The production runtime already composes `createPostgresRoleLayerStore` from the existing Neon PostgreSQL pool; this change removes only the unused compatibility adapter.
- The role-layer Store contract and deny-on-missing-account behavior remain unchanged. Tests retain the authority-boundary cases and assert the PostgreSQL adapter uses numbered parameters.
- Other W02 D1-backed test/schema adapters and historical migration sources remain tracked separately; this slice does not delete them.

## W05 Follower / Following List Read

- Removed the D1 executor interface and `createD1FollowListReadStore`.
- `listFollowers` and `listFollowing` now accept only the Store port; both routes require the Neon PostgreSQL reader and fail closed with 503 when it is missing.
- Replaced D1 fallback assertions and D1 runtime fixtures with Store-port fixtures.
- Preserved public-read transport policy, bidirectional Block exclusion, deterministic cursor ordering, limit-plus-one pagination, separate filtered count, and cached aggregate count.
- Follow/Unfollow writes and the separate Follow status helper are not part of this slice.


## W05 Follow / Unfollow Write

- Removed `createD1FollowStore` and the runtime D1/Store resolver; Follow and Unfollow now accept only the `FollowStore` port.
- Both mutation routes require the injected Neon PostgreSQL writer and fail closed with 503 before touching `env.DB` when it is missing.
- Preserved the PostgreSQL adapter's atomic bidirectional Block guard, existing relationship identity/timestamp, idempotent Unfollow, relationship-graph cache invalidation, and best-effort notification enqueue.
- The separate Follow status reader remains out of scope and is tracked independently.


## W05 Follow Status Read

- Removed `FollowStatusD1Database`, `createD1FollowStatusReadStore`, and the runtime D1/Store resolver. `getFollowStatus` now accepts only `FollowStatusReadStore`.
- The helper is referenced by the Neon PostgreSQL rehearsal and focused runtime tests; it is not currently injected into a public production route.
- Kept the PostgreSQL adapter and rehearsal coverage for active/missing relationships and both Block directions; runtime tests now use provider-neutral Store fixtures only.


## W05 Like Status Read

- Removed `LikeStatusD1QueryExecutor` and `createD1LikeStatusReadStore`; the Like Status runtime no longer has a D1 status-query fallback.
- Like status reads use the already-composed Neon PostgreSQL `LikeStatusReadStore`; a missing Store fails closed with 503 when a cache miss requires storage.
- Preserved W03 publication validation, W05 Block preflight, actor-scoped liked state, shared aggregate cache semantics, and PostgreSQL adapter/rehearsal coverage.
- Like mutation and like-target-context D1 adapters remain explicitly out of scope for this slice.


## W05 Like / Unlike and Like Target Context

- Removed `LikeMutationD1QueryExecutor` / `createD1LikeMutationStore` and `LikeTargetContextD1QueryExecutor` / `createD1LikeTargetContextReadStore`.
- Like, Unlike and Like Status no longer accept a D1 database argument or construct default D1 stores. The HTTP routes require the relevant injected Neon Store ports and return sanitized 503 when mutation/context composition is missing.
- The existing Neon runtime composes `createPostgresLikeMutationStore` and `createPostgresLikeTargetContextReadStore`; this slice makes those ports mandatory at the route/runtime boundary.
- Preserved W03 published-content validation, published-comment target projection, bidirectional Block preflight, final PostgreSQL guarded insert (content owner and comment author plus W03 parent owner), idempotent actor-scoped mutation, sanitized errors, and viewer/aggregate cache invalidation.
- Scope: W05 Like business slice only. No production database, schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 Favorite / Unfavorite and Favorite Status / List

- Removed `FavoriteMutationD1Executor` / `createD1FavoriteMutationStore`, `FavoriteStatusD1QueryExecutor` / `createD1FavoriteStatusReadStore`, and `FavoriteListD1QueryExecutor` / `createD1FavoriteListReadStore`.
- Favorite runtime APIs now accept only explicit Store contracts. The HTTP routes require Neon PostgreSQL mutation/status/list Stores and return sanitized 503 if required composition is missing; no `env.DB` fallback remains for this business slice.
- Existing PostgreSQL Stores remain the runtime composition: `createPostgresFavoriteMutationStore`, `createPostgresFavoriteStatusReadStore`, and `createPostgresFavoriteListReadStore`.
- Preserved W03 published-content validation, actor-scoped idempotency, favorite-status cache revalidation/invalidation, bounded keyset pagination and microsecond cursor precision, and sanitized adapter failures.
- Scope: W05 Favorite business slice only. No production database/schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 Poll lifecycle (configuration, read, vote and draft deletion)

- Removed `createD1PollConfigurationStore`, `createD1PollReadStore`, `createD1PollVoteStore`, and `createD1PollDeleteStore` implementations.
- `poll-runtime.ts` now uses only explicit `PollConfigurationStore`, `PollReadStore`, `PollVoteStore`, and `PollDeleteStore` contracts. Poll HTTP routes require their respective Neon Store dependencies and fail closed with 503 when missing; no poll route falls back to `env.DB`.
- Existing PostgreSQL implementations remain composed by `workers/W05-social/src/neon/runtime.ts`.
- Preserved W03 ownership/publication authority, Block checks, bounded option/duration validation, lazy publication-relative expiry, vote idempotency and immutable choice, closed-poll rejection, and no-delete/no-reconfigure-after-vote rules.
- Updated poll runtime tests to use provider-neutral Store fixtures and updated PostgreSQL rehearsal scripts to call Store-only runtime APIs.
- Scope: Poll lifecycle only. No production database/schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 Profile Channel replies / likes

- Removed `ProfileChannelD1QueryExecutor` and `createD1ProfileChannelReadStore`.
- Profile Channel runtime functions now accept only `ProfileChannelReadStore`; both replies and likes routes require the injected Neon PostgreSQL Store and fail closed with 503 when missing. No Profile Channel `env.DB` fallback remains.
- Existing PostgreSQL implementation `createPostgresProfileChannelReadStore` remains composed by `workers/W05-social/src/neon/runtime.ts`.
- Preserved W03 published-content batch authority, profile-level Block/Mute checks, owner Block checks, profile/viewer Block and viewer Mute filters for liked content, bounded cursor pagination and microsecond timestamp precision.
- Runtime tests now use Store fixtures; route tests verify missing-store fail-closed behavior. No production DB/schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 Reply Audience policy persistence

- Removed `ReplyAudienceD1QueryExecutor` and `createD1ReplyAudienceStore`; `setContentReplyAudience` / `getContentReplyAudience` now accept only explicit `ReplyAudienceStore`.
- Reply Audience GET/PUT routes require the injected Neon PostgreSQL Store and fail closed with 503 when absent; no Reply Audience route passes `env.DB` into the runtime.
- Existing PostgreSQL adapter remains composed by `workers/W05-social/src/neon/runtime.ts`; PostgreSQL 18 rehearsal scripts now use the Store-only API.
- Preserved W03 owner validation, owner-scoped persistence, audience validation, bounded mention deduplication, default audience and sanitized provider errors.
- At the time of this Reply Audience persistence phase, Comment Create still used a separate legacy predicate; that remaining path was closed in the subsequent W05 Comment Create / Update / Delete cleanup. No production DB/schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 Comment Create / Update / Delete writes

- Removed `createD1CommentCreateStore`, `createD1CommentMutationStore`, the D1 query executor implementations, and runtime D1/default Store resolution from Comment Create and Comment Mutation.
- Comment POST now requires the injected Neon PostgreSQL `CommentCreateStore`; PATCH and DELETE require the injected Neon PostgreSQL `CommentMutationStore`. Missing Store composition fails closed with 503 before write operations.
- Removed the legacy D1 `replyAudienceAllowedSql` predicate. Comment creation now uses the PostgreSQL predicate for validation, final INSERT authorization, and post-race audience recheck.
- Existing PostgreSQL implementations remain composed by `workers/W05-social/src/neon/runtime.ts`.
- Preserved W03 publication authority, idempotency, rate limiting, parent depth/content checks, final atomic Block and reply-audience predicates, author-only leaf-comment tombstones, deletion race replay, and ETag compare-and-swap updates.
- Updated runtime and route tests to use provider-neutral Store fixtures; PostgreSQL SQL tests and Reply Audience integration assertions cover the PostgreSQL-only predicate.
- Scope: Comment Create/Update/Delete writes only. Comment list, remaining W05 D1-compatible routes, production DB/schema, Hyperdrive bindings, Worker deployment, and traffic are unchanged.


## W05 Content Liker list read

- Removed `ContentLikerD1QueryExecutor` and `createD1ContentLikerReadStore`; `listContentLikers` now accepts only `ContentLikerReadStore`.
- The content likes list route requires the injected Neon PostgreSQL Store and fails closed with 503 when composition is absent; no `env.DB` fallback remains for this read path.
- Existing PostgreSQL adapter remains composed by `workers/W05-social/src/neon/runtime.ts`; PostgreSQL SQL tests and the disposable PostgreSQL 18 rehearsal remain.
- Preserved W03 published-content validation, owner/viewer bidirectional Block filtering, anonymous viewer semantics, bounded cursor pagination, and microsecond timestamp precision.
- Updated runtime tests to provider-neutral Store fixtures and route tests to assert fail-closed behavior.
- Scope: Content Liker list read only. No production DB/schema, Hyperdrive binding, Worker deployment, or traffic change.


## W05 orphaned D1 helper and stale test residue

- Removed the unreferenced legacy `block-policy.ts` D1 query helper and its standalone test; repository-wide references showed no production caller.
- Removed obsolete D1-only test files for Comment List Read and Comment Notification Context. Their production D1 adapters had already been removed; the PostgreSQL adapter tests remain the active storage verification.
- No production route, Store contract, migration, database schema, Hyperdrive binding, Worker deployment, or traffic behavior changed. W05 Block/Mute enforcement remains in the active PostgreSQL Store queries.


## W05 D1-02 runtime selection is Neon-only

- Removed the legacy `d1` runtime mode from W05's D1-02 social database composition. Missing `W05_DATABASE_DRIVER` now resolves to Neon; explicit `d1` or any unsupported value is rejected.
- `getW05SocialWorkerDependencies` no longer returns an empty dependency set for D1 mode. It requires the approved `HYPERDRIVE_D1_02` PostgreSQL binding and composes the existing Neon Stores.
- Notification push delivery composition follows the same Neon-only rule. The unused driver property was removed from its runtime contract.
- The production Wrangler config already selects Neon and pins the approved D1-02 and D1-03 Hyperdrive resources; this change does not deploy or alter either binding.
- W09-owned push endpoint state remains separately scoped to the D1-03-named Hyperdrive PostgreSQL connection. This change removes the W05 D1-02 runtime mode only; it does not change W09 ownership or the test/local D1-03 compatibility adapter.
- No schema, migration history, production database, Worker deployment, or traffic change.
