# LuckRead 架构基线 / Worker 域 / D1 域 / R2 / Cache 边界合同 v1.0

**Status:** P0 / CANONICAL / 开发前必须冻结
**Canonical Source:** 本文档是 W00–W08、D1-01/02/03、R2 分类、Cache 边界的**唯一权威定义**。
**Supersedes / Reconciles:** `docs/LUCKREAD-PAYLOAD-BOUNDARY-AND-WORKER-DECOMPOSITION-CONTRACT-v1.0.md`（保留，降级为本合同的“拆分触发条件”子文档）

---

## 0. 为什么需要本文档（审计发现）

仓库 225 份文档中**不存在**以下标识符：

| 标识符 | 全库命中 | 结论 |
|---|---|---|
| `W00`–`W08` | 0 | 缺失 |
| `D1-01` / `D1-02` / `D1-03` | 0 | 缺失 |
| `AUTHZ-CACHE-INVARIANT-001` | 0 | 缺失（见 302） |
| `L0`-`L8` | 0 | 缺失（见 301） |

同时 `LUCKREAD-PAYLOAD-BOUNDARY` 第 14–16 行明确写道：

> 不是预先固定 Worker 数量 …… 当 API 已经可以形成独立运行、独立扩缩容、独立故障域或独立计算负载时，才拆为独立 Worker。

这与“W00–W08 固定”表面上冲突。**本合同解决该冲突**（见 §2.3），不做二选一。

---

## 1. 最高不变量

### `ARCH-INVARIANT-001` — Payload Core 不可修改

Payload CMS Core 是上游依赖，**不得 patch / fork / monkey-patch**。
扩展只允许通过：Collection Schema、Hook、Endpoint、Plugin、应用层代码。

### `ARCH-INVARIANT-002` — Cost-First

沿用 `docs/00-PROJECT-BLUEPRINT.md` §2.1 `COST-FIRST-ARCHITECTURE`。
任何新增 Worker / D1 读写 / 队列 / 同步路径必须先回答成本九问。

### `ARCH-INVARIANT-003` — Cache 不是授权边界

Cache（Cache API / KV / 内存 / CDN）**只能作为性能优化**。
绝对不得成为：

- Authorization Boundary
- Identity Source of Truth
- Permission Source of Truth
- Account State Source of Truth

> 完整规范见 `docs/302-AUTHORIZATION-CACHE-SECURITY-CONTRACT-v1.0.md`。

### `ARCH-INVARIANT-004` — 逻辑域标识符稳定

W00–W08 与 D1-01/02/03 是**逻辑能力域标识符**，与物理部署数量解耦。
标识符在 v1 冻结后**永不复用、永不重新编号**。

---

## 2. Worker 域（W00–W08）

### 2.1 定义

| ID | 域 | 职责 | v1 承载形态 |
|---|---|---|---|
| **W00** | Payload Core | Collection Schema、Admin、内建 REST/GraphQL、auth、draft/version、hook 运行时 | Payload Runtime（Next.js on Workers） |
| **W01** | API / BFF | 面向 APP/Web 的公共 API `*/api/v1/*`；DTO 装配、聚合、鉴权入口、限流入口 | 同 W00 进程；独立路由命名空间 |
| **W02** | Media | 上传、分片、转码编排、缩略图、R2 对象生命周期、签名 URL | 同 W00；重计算任务走 W08 |
| **W03** | Feed | 时间线、关注流、推荐流、热门流、游标与去重 | 同 W00，缓存优先；独立后可拆 |
| **W04** | Search | 索引、文档、查询、过滤、排序、高亮、权限过滤 | 同 W00；独立后可拆 |
| **W05** | Notification / Event | 事件生产/消费、通知聚合、推送扩展点、去重 | 同 W00；异步队列 |
| **W06** | Audit / Security | 审计写入、安全事件、风控决策、封禁执行 | 同 W00；**不得缓存绕过** |
| **W07** | Cache | 缓存读写、失效、热键、击穿保护、版本化 key | 同 W00；**纯性能优化层** |
| **W08** | Jobs / Control | 定时任务、批量作业、回填、重建索引、对账、补偿 | 异步 / Cron / Queue |

### 2.2 权威边界

- **W00 是所有写路径的权威入口**：跨表一致性由 W00（D1 事务）保证。
- **W03/W04/W05/W07 只能读权威数据的派生副本**。它们失败时**不得**回写权威状态。
- **W06 是审计与安全的唯一权威写入者**。其他域不得直接写审计表绕过 W06。
- **W08 执行的补偿动作必须走 W00 的 API 或领域服务**，不得直接改表。

### 2.3 冲突解决（ADR-A001）

**冲突：** `LUCKREAD-PAYLOAD-BOUNDARY` 说“不预先固定 Worker 数量”，本合同定义了 9 个域。

**决策：** W00–W08 定义为**逻辑能力域（Logical Capability Domain）**，不是 v1 必须部署的 9 个独立 Worker。

- v1 允许多个域**共置（co-located）**在同一 Worker / 同一进程。
- 拆分是**部署决策**，不是**架构决策**。拆分时域标识符不变。
- 因此两份文档不冲突：一份约束**何时拆**，一份约束**域是什么**。

**理由：** 标识符稳定可以让代码组织、日志、trace、限流维度、审计归因从第一天就对齐；而共置让 v1 保持 Cost-First。

**Trade-off：** 共置带来故障域耦合。缓解：所有跨域调用必须走**内部接口 + 超时 + 降级**，不得共享可变内存状态。

**Consequences：** 未来拆分 W03/W04 时，只需替换内部接口实现，不需要改 API / DTO / 事件 / 审计归因。

### 2.4 拆分触发条件（引用，不重定义）

拆分必须满足 `LUCKREAD-PAYLOAD-BOUNDARY` §4 的独立运行/扩缩容/故障域/计算负载条件之一，且通过成本评审。
**禁止** `Business Worker -> HTTP -> Database Worker -> D1` 链式调用（该文档 §3 明令禁止）。

---

## 3. D1 域（D1-01 / D1-02 / D1-03）

### 3.1 物理事实（硬约束）

Cloudflare D1 **单库**。不存在跨库 JOIN、跨库事务。
因此 D1-01/02/03 是**单个 D1 数据库内的逻辑表域**，通过：

1. 表名前缀（`idn_` / `cnt_` / `ops_`）
2. 访问层（Repository / Service）隔离
3. 迁移文件分组

实现域隔离。**不得**假设可以拆成 3 个物理库。

### 3.2 域定义

| ID | 域 | 前缀 | 内容 | 写入者 | 一致性要求 |
|---|---|---|---|---|---|
| **D1-01** | Identity / Account | `idn_` | User、Identity、Credential、Session、Role、RoleAssignment、Entitlement、Subscription、Organization、OrgMembership、Invitation、Creator、CreatorProfile、Verification、IP、IPMember | W00（权威）、W08（回填） | 强一致、事务 |
| **D1-02** | Content / Domain | `cnt_` | Content(Article/Gallery/Video/Audio/Live/Short)、Revision、Media、MediaProcessing、Comment、Tag、Topic、Category、Collection、License、Attribution、IPContentLink | W00（权威）、W08（回填/重建） | 强一致（权威状态）；派生计数最终一致 |
| **D1-03** | Operational / System | `ops_` | AuditEvent、SecurityEvent、Notification、Outbox、Inbox、IdempotencyRecord、Job、JobRun、RateLimitCounter、ModerationCase、Report、Appeal、FeatureFlag、ConfigPolicy、MigrationLog | W06 / W05 / W08 | 追加为主；幂等 |

### 3.3 跨域规则

- **禁止跨域事务**：跨 D1-01/02/03 的一致性走 Saga / Outbox，见 `docs/164-CROSS-DOMAIN-CONSISTENCY-SAGA-COMPENSATION-CONTRACT-v1.0.md`。
- **Domain 归属争议的裁定原则**：按**权威写入者**归属，不按读取者归属。
  - 例：Notification 被所有域读取，但由 W05 权威写入 → 归 D1-03。
- **表迁移**只能在本域内新增；跨域移动表视为 BREAKING，必须走 ADR。

### 3.4 与 174 的关系

`docs/174-CANONICAL-ID-ENTITY-REFERENCE-UNIQUENESS-CONTRACT-v1.0.md` 是 ID 命名空间的 Canonical Source。
本合同只定义**域归属**，不重定义 ID 格式。

---

## 4. R2 对象分类

R2 用于大型对象。分类必须显式声明生命周期与访问策略。

| 类别 | Key 前缀 | 示例 | 加密 | 访问 | 生命周期 |
|---|---|---|---|---|---|
| 原始媒体 | `media/original/` | 上传原图/原视频 | 静态加密 | **私有**，仅签名 URL | 随 Media 删除 |
| 处理产物 | `media/derived/` | 转码、缩略图、多码率 | 静态加密 | 私有/CDN | 可重建，可早于原始删除 |
| 封面/预览 | `media/cover/` | 内容封面、预览图 | 静态加密 | 公开可读 | 随 Content 状态变化失效 |
| 正文 JSON | `content/body/` | 长文 Lexical JSON | 静态加密 | 私有，经 W00 鉴权 | 随 Content 删除 |
| 媒体 JSON | `content/media/` | 图集/视频元数据 | 静态加密 | 私有 | 随 Content 删除 |
| 大型附件 | `content/attachment/` | 附件、字幕、字幕文件 | 静态加密 | 私有/签名 | 随 Content 删除 |
| 导出/备份 | `export/` `backup/` | 用户数据导出、库备份 | 静态加密 | **严格私有** | Retention 策略（见 160） |

**规则：**

- **禁止**通过 R2 公开桶直接暴露私有对象。私有对象必须经签名 URL 或 W00/W01 代理校验。
- 所有 R2 对象必须在 D1 有对应**元数据记录**（Media / ObjectRecord），**孤儿对象**由 W08 定期回收。
- R2 删除**不等于**合规删除：备份与派生副本的清除见 `docs/160`。

---

## 5. Cache 边界（W07）

### 5.1 允许的缓存内容

- 公开内容渲染结果
- 搜索结果片段（**必须带权限过滤前置**）
- Feed 页（**必须按 viewer 维度分区**）
- 计数器派生投影
- 配置 / Feature Flag（带版本号）

### 5.2 禁止的缓存内容

- 授权决策结果（作为终局依据）
- 账户状态（作为终局依据）
- 会话 / Token 有效性
- 未过滤权限的搜索或 Feed 结果
- 任何绕过 W06 的审计判定

### 5.3 强制不变量

> **`AUTHZ-CACHE-INVARIANT-001`：Cache HIT ≠ Authorization Proof。**
> 任何 Cache HIT 都必须重新经过权威鉴权判定后才能放行。
> 完整定义、Key 结构、失效与 Fail-Closed 语义见 `docs/302`。

---

## 6. 请求链路基线

```text
Client
  ↓ HTTPS
W01 API/BFF  ──(鉴权入口)──► W06 审计/安全
  ↓                            ↓
W00 Payload Core ──(权威写)──► D1-01/02
  ↓                            ↓
  └──► W05 Outbox ──► 事件 ──► W03 Feed / W04 Search / W05 Notification
                                  ↓
                               W07 Cache（只缓存已授权结果）
```

**关键规则：**

1. 鉴权在 **W01 入口 + W00 领域层**双重执行。W03/W04/W07 的缓存**不构成**第二道授权。
2. 派生域（W03/W04/W05）的失败**不得**阻塞权威写（W00）成功。
3. W06 审计写入失败时，敏感操作**必须 Fail Closed**（拒绝操作），见 `docs/169` §11 Break-Glass 例外。

---

## 7. 开发准入门禁

以下任一未完成，**不得**开始写业务代码：

- [ ] W00–W08 域归属已写入代码目录结构与日志/trace 标签
- [ ] D1-01/02/03 表前缀约定已落地，且迁移文件分组
- [ ] R2 key 前缀与访问策略已实现
- [ ] `AUTHZ-CACHE-INVARIANT-001` 已实现并有测试（见 302）
- [ ] 本文档与 `LUCKREAD-PAYLOAD-BOUNDARY` 的冲突已按 ADR-A001 记录

---

## 8. ADR

### ADR-A001 — Worker 域标识符固定为 W00–W08，但 v1 允许共置

- **Decision:** 采用 9 个逻辑能力域标识符；物理部署允许共置。
- **Context:** 需要稳定的日志/限流/审计归因维度，同时满足 Cost-First 与既有“不预先固定 Worker 数量”约定。
- **Alternatives:** (a) 完全不定义域；(b) v1 立即拆 9 个 Worker。
- **Reason:** (a) 会导致未来拆分时归因维度重构；(b) 违反成本约束且无产品理由。
- **Trade-offs:** 共置 = 故障域耦合，需靠接口边界 + 超时 + 降级缓解。
- **Consequences:** 拆分成为纯部署动作，API/DTO/事件/审计不变。

### ADR-A002 — D1-01/02/03 为单库内逻辑域，不拆物理库

- **Decision:** 单 D1 库 + 表前缀 + 访问层隔离。
- **Context:** D1 不支持跨库 JOIN/事务。
- **Reason:** 域标识符提供治理价值（迁移分组、访问层边界、归属裁定），物理拆分在 D1 上不可行。
- **Trade-offs:** 隔离是约定而非强制，需 Contract CI 校验前缀。
- **Consequences:** Contract CI 必须检查表名前缀与域归属一致性。

### ADR-A003 — Cache 永不作为授权边界

- **Decision:** 见 `ARCH-INVARIANT-003` 与 `docs/302`。
- **Reason:** 缓存失效延迟与 Key 冲突会造成权限泄漏，属于不可接受的安全风险。
- **Consequences:** 每次命中缓存仍需权威鉴权，牺牲部分性能换取正确性。

---

## 9. OPEN / PENDING

| ID | 问题 | 状态 |
|---|---|---|
| OPEN-A01 | v1 是否共置全部 9 域，还是首批拆分 W03/W04 | **PENDING** — 需负载数据 |
| OPEN-A02 | 是否需要多区域 D1（D1 目前无内建多区域） | **PENDING** — 取决于上线区域 |
| OPEN-A03 | R2 是否需要按区域分桶（数据驻留合规） | **PENDING** — 需法务确认 |
