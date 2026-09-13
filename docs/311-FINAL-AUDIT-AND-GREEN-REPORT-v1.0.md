# LuckRead 最终审计报告与 GREEN 状态 v1.0

**审计范围：** 仓库全部设计文档（225 份，76,306 行）+ 机器可读契约 + Contract CI + 代码基线
**审计日期：** 2026-09-13
**审计角色：** Product / Domain / Contract / Security Architecture + Documentation Governance

---

## 0. 执行摘要

**结论：不能开始写代码。**

审计发现的第一批问题不是「文档写得不够细」，而是：

1. **用户认定的「现有架构基线」（W00–W08、D1-01/02/03、L0–L8、AUTHZ-CACHE-INVARIANT-001）
   在 225 份文档中命中数全部为 0。** 这些标识符从未真正落库。
2. **工作区是一个孤儿分支**（`master`，0 commits），文档与代码只存在于远程 `origin/main`；
   而 `origin/contract/v1-machine-readable` 分支在引入契约时**删除了最新的 4 份 P0 文档**。
3. **OpenAPI 契约 `paths: {}` —— 零个端点。** 契约层实际为空。
4. 代码基线是**空白 Payload 模板**（只有 `Users`、`Media` 两个 collection）。

本次已补齐 10 份 P0 契约文档 + 27 个机器可读契约文件 + 21 个 OpenAPI 端点 + 可失败校验的 Contract CI。

---

## 1. 架构现状（最严重的三个问题）

### 1.1 工作区与文档分离（P0 / RED）

| 位置 | 内容 | 状态 |
|---|---|---|
| 本地工作区 | Payload 空白模板 | 分支 `master`，**0 commits**，未跟踪 |
| `origin/main` | 225 份文档 + 应用骨架 | 最新 4 次提交是 P0 契约 |
| `origin/contract/v1-machine-readable` | + `contracts/` + CI | **删除了 4 份 P0 文档** |

被 contract 分支删除、但 main 上存在的 P0 文档：

- `docs/03-P0-API-ERROR-PAGINATION-CURSOR-CONTRACT-v1.0.md`
- `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`
- `docs/05-P0-STATE-MACHINE-CONTRACT-v1.0.md`
- `docs/11-P0-PAYLOAD-EXTENSION-AND-API-COMPLETENESS-CONSTRAINT-v1.0.md`

**风险：** 如果以 contract 分支为开发基线，4 份 P0 契约会静默消失。
**本次已处置：** 已从 `origin/main` 恢复全部 225 份文档到工作区。

### 1.2 用户指定的架构标识符全库缺失（P0）

| 标识符 | 全库命中 | 处置 |
|---|---|---|
| `W00`–`W08` | **0** | 已在 `docs/300` 正式定义（9 个逻辑能力域，v1 允许共置） |
| `D1-01` / `D1-02` / `D1-03` | **0** | 已在 `docs/300` §3 定义（单 D1 库内表前缀逻辑域） |
| `L0`–`L8` | **0** | 已在 `docs/301` 定义（9 层，含冲突解决优先级） |
| `AUTHZ-CACHE-INVARIANT-001` | **0** | 已在 `docs/302` 定义（含 4 条不变量 + 12 项强制测试） |
| `主理人`（IP Principal） | **0** | 已在 `docs/304` 定义，并裁决**不创建**「IP 创始人」角色 |

### 1.3 与既有文档的架构冲突（已裁定，非推翻）

`LUCKREAD-PAYLOAD-BOUNDARY-AND-WORKER-DECOMPOSITION-CONTRACT` 明确写道
「不是预先固定 Worker 数量」，与「W00–W08 固定」表面冲突。

**裁定（ADR-A001）：** W00–W08 是**逻辑能力域标识符**，不是 v1 必须部署的 9 个独立 Worker。
v1 允许共置，拆分是**部署决策**而非架构决策。两份文档因此不冲突：
一份约束**何时拆**，一份约束**域是什么**。

---

## 2. 其他确认的缺口

| 检查项 | 全库命中 | 判定 | 处置 |
|---|---|---|---|
| `ETag` | **0** | ❌ P0 | `docs/305` + `contracts/schemas/common/etag.json` |
| `Soft Delete` / `Hard Delete` | **0 / 0** | ❌ P0 | `docs/306`（5 级删除层级 + 逐实体矩阵） |
| `IDOR` / `XSS` / `SSRF` / `Brute Force` | **0** | ❌ P0 | `docs/307`（21 项威胁 + 防御 + 测试） |
| `Department` | **0** | ❌ P1 | `docs/304` §2.1 |
| `Trial` / `Temporary Permission` | **0** | ⚠️ P1 | 已纳入 `303` 求值顺序与 `301` DENY/临时权限 |
| `Circuit Breaker` / `Fail Closed` | 2 / 2 | ⚠️ | `docs/305` §5 |
| `Trace ID` | 2 | ⚠️ | `contracts/schemas/common/request-id.json`（已有） |
| OpenAPI 端点数 | **0** | ❌ P0 | 已补 **21 个端点** |
| 文档编号重复 | **7 组** | ⚠️ | `docs/309` 别名解析表（不重命名，避免断链） |
| `215`/`216` 同名不同内容 | md5 不同 | ⚠️ | **OPEN-G01**，裁定前不得作为实现依据 |

---

## 3. 十项状态灯

| # | 维度 | 状态 | 依据 |
|---|---|---|---|
| 1 | **Architecture Status** | 🟡 **YELLOW** | W00–W08 / D1 / R2 / Cache 边界已落地（`300`）；但分支分离与孤儿工作区未解决 |
| 2 | **Product Completeness** | 🟢 **GREEN** | 225 份文档覆盖内容/社交/商业化/审核/运营，广度足够 |
| 3 | **Domain Completeness** | 🟡 **YELLOW** | 组织/企业/IP 主理人已补齐（`304`）；Subscription、Job 机器可读状态机仍缺 |
| 4 | **Authorization** | 🟡 **YELLOW** | L0–L8 + 授权缓存安全 + 七类分离已定义并机器可读；**未实现、未测试** |
| 5 | **API** | 🔴 **RED** | 21 个端点已契约，但 Block/Mute、Report/Appeal、Revision 等核心 APP 能力**仍无 API** |
| 6 | **State Machine** | 🟡 **YELLOW** | Account(26 转换) + Content(20 转换) 已机器可读；Comment/Media/Subscription/Job 缺 |
| 7 | **Security** | 🟡 **YELLOW** | 威胁模型 21 项已定义；ETag/幂等/删除已定义；**零实现、零测试** |
| 8 | **Data Lifecycle** | 🟢 **GREEN** | `160` 保留/擦除 + `306` 删除语义 + `303` 账户生命周期，覆盖完整 |
| 9 | **Machine-readable Contract** | 🟡 **YELLOW** | 27 个契约文件 + 21 端点（此前为 7 文件 + 0 端点）；Subscription/Job 等仍缺 |
| 10 | **Contract CI** | 🟢 **GREEN** | 可执行、可失败、**已通过负向测试验证**（见 §5） |

### 三层 GREEN 分别报告（按 §50，禁止合并）

| 层 | 状态 | 说明 |
|---|---|---|
| **DOCUMENT GREEN** | 🟡 **YELLOW** | 本批 10 份 P0 已定义；仍有 RC-01~RC-10 与事件/审计细化未闭合 |
| **CONTRACT GREEN** | 🟡 **YELLOW** | 27 文件 + 21 端点；覆盖率不足（缺 Block/Mute/Report/Revision/Subscription 等） |
| **CI GREEN** | 🟢 **GREEN** | 本地执行通过；**尚未在 GitHub Actions 上实际运行**（分支已配置但未推送） |

---

## 4. P0 / P1 / P2 Remaining

### P0 Remaining（开发准入阻断）

| ID | 项 | 状态 |
|---|---|---|
| P0-01 | 合并 `origin/main` 与 `origin/contract/...`，恢复被删的 4 份 P0 文档 | **待执行** |
| P0-02 | 本地孤儿 `master` 分支与远程对齐 | **待执行** |
| P0-03 | RC-01 Block / Mute API | **待补** |
| P0-04 | RC-02 Report / Appeal API | **待补** |
| P0-05 | RC-03 Revision API（草稿版本/回滚） | **待补** |
| P0-06 | 实现 `AUTHZ-CACHE-INVARIANT-001..004` + 12 项测试 | **待实现** |
| P0-07 | 实现 L0–L8 与 DENY 优先级鉴权中间件 | **待实现** |
| P0-08 | 实现 `If-Match` 乐观锁（412/428/409） | **待实现** |
| P0-09 | 实现幂等记录与业务写同事务 | **待实现** |
| P0-10 | 搜索/Feed 索引延迟契约落地（作者 read-your-writes） | **待实现** |

### P1 Remaining

- RC-04 Share API、RC-05 Subscription API、RC-06 Entitlement API
- RC-07 组织成员 API、RC-08 IP 内容 API、RC-09 Feed 排序/去重契约
- Subscription 与 Job 的机器可读状态机
- 事件矩阵 5 项：org.member.*、ip.transferred/dissolved、entitlement.*、media.processing.*、moderation.*
- Comment / Media 状态机机器可读化
- 订阅变更审计字段细化

### P2 Remaining（Extension Point 已预留，不需立即实现）

- Recommendation：Candidate / Feature / Score / Rank / Filter / Policy / Experiment / Model Version
- Push 推送通道扩展点
- 多区域与数据驻留（OPEN-A02 / A03）
- Feature Flag 与实验平台（不得绕过 Authorization，见 `175`）

---

## 5. Contract CI 验证证据

```
$ node scripts/contract-ci.mjs
Contract CI GREEN — common=11 enums=11 state-machines=2 authz=3 openapi=21
  common schema references resolved: 5
  invariants: L0-L8 present, ADR-I001 enforced, AUTHZ-CACHE-INVARIANT-001..004 fail-closed
```

**负向测试（证明门禁真的会失败）：**

| 注入的违规 | 结果 |
|---|---|
| 在 L4 注入禁用角色 `ip_founder` | ✅ RED — `forbidden role 'ip_founder' present (ADR-I001)` |
| 把 `AUTHZ-CACHE-INVARIANT-001` 改为 `fail-open` | ✅ RED — `must declare failMode 'fail-closed'` |
| 敏感操作缓存改为 `read-through` | ✅ RED — `sensitive operations must use cache mode 'none'` |
| 恢复后重跑 | ✅ GREEN |

---

## 6. 本次新增 / 变更文件

### 新增 P0 契约文档（`docs/`）

| 文件 | 内容 |
|---|---|
| `300-ARCHITECTURE-BASELINE-WORKER-D1-R2-CACHE-MAP-v1.0.md` | W00–W08、D1-01/02/03、R2 分类、Cache 边界、3 条 ADR |
| `301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md` | L0–L8 九层完整定义 + 冲突解决优先级 + 角色映射 |
| `302-AUTHORIZATION-CACHE-SECURITY-CONTRACT-v1.0.md` | AUTHZ-CACHE-INVARIANT-001..004 + 12 项强制测试 |
| `303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md` | 七类概念分离 + 12 态账户状态机 + 副作用矩阵 |
| `304-ORGANIZATION-ENTERPRISE-AND-IP-PRINCIPAL-CONTRACT-v1.0.md` | 个人/企业区分、组织 6 实体、IP 主理人、ADR-I001 |
| `305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md` | ETag、If-Match、幂等 Key 语义、重试/熔断 |
| `306-DELETION-SEMANTICS-AND-ERASURE-MATRIX-CONTRACT-v1.0.md` | 5 级删除层级 + 逐实体删除矩阵 + ADR-D001/D002 |
| `307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md` | 21 项威胁与防御 + 数据暴露红线 |
| `308-COMPLETENESS-MATRIX-AND-REVERSE-COVERAGE-AUDIT-v1.0.md` | 27 实体 × 9 维矩阵 + 反向覆盖缺口 RC-01~RC-10 |
| `309-DOCUMENT-GOVERNANCE-AND-CANONICAL-INDEX-v1.0.md` | 编号冲突、Canonical Source、18 类映射、OPEN-G01~G04 |

### 新增机器可读契约（`contracts/`，27 个）

- `schemas/common/`：`etag`、`idempotency-key`、`actor`、`audit-event`（+原有 7 → 共 11）
- `enums/`（11）：`account-state`、`content-state`、`comment-state`、`ip-state`、`ip-member-role`、
  `organization-state`、`organization-member-state`、`media-state`、`moderation-case-state`、`visibility`、`error-code`
- `state-machines/`（2）：`account`（26 转换）、`content`（20 转换 + 副作用）
- `authz/`（3）：`layers`（L0–L8）、`authz-cache-invariant`、`permissions`
- `openapi/v1/openapi.yaml`：**0 → 21 个端点**

### 变更

- `scripts/contract-ci.mjs`：从单域校验升级为 5 域全量 + 跨契约一致性 + 不变量强制
- `.github/workflows/contract-ci.yml`：5 域矩阵 + 全量 + OpenAPI lint
- 从 `origin/main` 恢复 225 份文档到工作区

---

## 7. 返工风险（未来最可能导致重构的问题）

| 风险 | 若现在不解决 | 处置 |
|---|---|---|
| **权限层缺失** | 后期加 L0–L8 需重构所有 API 鉴权 | ✅ 已定义 `301` + `contracts/authz/` |
| **缓存当授权源** | 权限泄漏，属安全事故级 | ✅ 已定义 `302` + CI 强制 |
| **ID 与枚举不稳定** | 枚举扩展破坏客户端 | ✅ 已建 `contracts/enums/` |
| **删除语义不统一** | 数据不一致 + 合规风险 | ✅ 已定义 `306` |
| **无 ETag/乐观锁** | 双编辑覆盖、API Breaking Change | ✅ 已定义 `305` |
| **Organization Scope 缺失** | 加多组织需重构所有查询 | ✅ 已定义 `304` |
| **IP 角色错误建模** | 「创始人」双主角色冲突，无法转让 | ✅ ADR-I001 裁决 |
| **OpenAPI 为空** | Code First 后补文档 | ✅ 已建 21 端点契约 |
| **分支分裂** | P0 文档静默丢失 | ⚠️ **待合并** |
| **API 缺 Block/Mute/Report/Revision** | APP 核心功能无法输出 | ⚠️ **待补**（RC-01~03） |

---

## 8. Unresolved Decisions / OPEN

| ID | 问题 | 状态 |
|---|---|---|
| OPEN-A01 | v1 是否共置全部 9 域，还是首批拆分 W03/W04 | PENDING — 需负载数据 |
| OPEN-A02 | 是否需要多区域 D1 | PENDING |
| OPEN-A03 | R2 是否需按区域分桶（数据驻留） | PENDING — 需法务 |
| OPEN-S01 | 是否需要 WAF / Bot Management | PENDING |
| OPEN-S02 | 实名认证存储与加密方案 | PENDING — 需法务 |
| OPEN-S03 | MFA 强制范围（仅 L5+ 还是全部创作者） | PENDING |
| OPEN-G01 | `215`/`216` 同名不同内容，需裁定权威版本 | **OPEN — 需作者确认** |
| OPEN-G02 | 7 组编号重复是否重命名（当前用别名表规避） | PENDING |
| OPEN-G03 | 是否建立独立 `docs/ADR/` | PENDING |
| OPEN-G04 | 2 份无编号架构文档是否纳入编号序列 | PENDING |

---

## 9. 建议的下一步（按顺序）

1. **合并分支**：把 `origin/contract/v1-machine-readable` 的 `contracts/`+CI 合入 `origin/main`，
   并恢复被删的 4 份 P0 文档；本地孤儿 `master` 对齐远程。
2. **补 RC-01~RC-03**：Block/Mute、Report/Appeal、Revision 三个 API 契约（P0 阻断项）。
3. **补 Subscription / Job 状态机**到 `contracts/state-machines/`。
4. **实现鉴权内核**：L0–L8 + DENY 优先级 + `AUTHZ-CACHE-INVARIANT-001..004` + 12 项测试。
5. **实现并发与幂等**：`If-Match`、412/428/409、幂等记录同事务。
6. **推送并确认 GitHub Actions 上 Contract CI 实际转绿**（当前仅本地验证）。
