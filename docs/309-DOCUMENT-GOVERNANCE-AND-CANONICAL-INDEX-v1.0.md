# LuckRead 文档治理 / Canonical Source / 编号规范 v1.0

**Status:** P0 / 治理
**Scope:** `docs/` 全部文档 + `contracts/` 全部机器可读契约

---

## 1. 审计发现：编号冲突

对 `docs/` 全量扫描（225 份）发现 **7 组编号重复** 与 **1 组同名不同内容**：

| 编号 | 文档 A | 文档 B | 冲突性质 |
|---|---|---|---|
| `03` | `03-API-CAPABILITY-COMPLETENESS-CONTRACT` | `03-P0-API-ERROR-PAGINATION-CURSOR-CONTRACT` | 编号重复，主题不同 |
| `04` | `04-MAINSTREAM-SELF-MEDIA-CAPABILITY-MATRIX` | `04-P0-PERMISSION-RBAC-CONTRACT` | 编号重复，主题不同 |
| `05` | `05-PLATFORM-CAPABILITY-GAP-AUDIT` | `05-P0-STATE-MACHINE-CONTRACT` | 编号重复，主题不同 |
| `11` | `11-P0-PAYLOAD-EXTENSION-AND-API-COMPLETENESS-CONSTRAINT` | `11-P0-SOCIAL-INTERACTION-AND-EVENT-CONTRACT` | 编号重复，主题不同 |
| `69` | `69-ANALYTICS-EXPERIMENT-GROWTH-CONTRACT` | `69-ANALYTICS-OSS-INTEGRATION-ADDENDUM` | 编号重复（Addendum 应用 `69A`） |
| `70` | `70-OPEN-PLATFORM-DEVELOPER-APPS-MINIAPPS-GAMES-CONTRACT` | `70-OPEN-PLATFORM-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION` | 编号重复 |
| `71` | `71-PLATFORM-OPERATIONS-GOVERNANCE-RELIABILITY-CONTRACT` | `71-PLATFORM-OPERATIONS-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION` | 编号重复 |
| `215/216` | `215-...-INSTANCE-REGISTRY` | `216-...-INSTANCE-REGISTRY` | **文件名几乎完全相同**，内容不同（md5 不同） |

其他：

- **缺失 `01-`**：编号从 `00` 直接跳到 `02`。
- **2 份无编号文档**：`LUCKREAD-PAYLOAD-BOUNDARY-AND-WORKER-DECOMPOSITION-CONTRACT`、
  `LUCKREAD-SELF-MEDIA-PLATFORM-ARCHITECTURE-AND-BLUEPRINT`。

### 1.1 处置原则

**不重命名、不移动现有 225 份文档。** 理由：

1. 大量文档之间存在交叉引用，重命名会批量断链。
2. 用户 §48 明确要求「不要为了目录漂亮而大量移动文件」。
3. 历史 git 提交与评审记录按现名索引。

**改为：用本文档声明 Canonical Source + 别名解析表。**

---

## 2. 编号规范（自本批起生效）

1. 新文档使用 **未占用** 的编号（本批使用 `300+` 段）。
2. Addendum 使用 `NNNA` 后缀（如 `69A`），不占用新编号。
3. 编号**一经分配永不复用**；废弃文档标记 `DEPRECATED` 但保留编号。
4. 无编号文档必须补编号或明确列为「架构总纲，不参与编号序列」。

### 2.1 别名解析表（冲突消解）

引用时必须带**主题后缀**，不得只写编号：

| 简写 | 权威解析 |
|---|---|
| `03` | 歧义 → 必须写 `03-P0-API-ERROR-PAGINATION-CURSOR-CONTRACT`（P0）或 `03-API-CAPABILITY-COMPLETENESS-CONTRACT` |
| `04` | 歧义 → 必须写 `04-P0-PERMISSION-RBAC-CONTRACT`（P0）或 `04-MAINSTREAM-SELF-MEDIA-CAPABILITY-MATRIX` |
| `05` | 歧义 → 必须写 `05-P0-STATE-MACHINE-CONTRACT`（P0）或 `05-PLATFORM-CAPABILITY-GAP-AUDIT` |
| `11` | 歧义 → 必须写 `11-P0-PAYLOAD-EXTENSION...` 或 `11-P0-SOCIAL-INTERACTION-AND-EVENT-CONTRACT` |
| `69/70/71` | 歧义 → 必须写完整文件名 |

**建议：** 后续引用一律写**完整文件名**，编号仅作排序用途。

### 2.2 215/216 处置

- `215-...INSTANCE-REGISTRY` 与 `216-...INSTANCE-REGISTRY` 文件名重复但内容不同。
- **处置：** 标记为 **OPEN-G01**，需要作者确认哪一份是权威，另一份标记 `DEPRECATED`。
- **在确认前，两份均不得作为实现依据。**

---

## 3. Canonical Source 指定

| 主题 | Canonical Source | 其他文档 |
|---|---|---|
| 项目总成本原则 | `00-PROJECT-BLUEPRINT.md` | — |
| Worker 域 / D1 域 / R2 / Cache 边界 | **`300`（本文档批次）** | `LUCKREAD-PAYLOAD-BOUNDARY...`（降级为拆分触发条件） |
| L0–L8 权限层级 | **`301`** | `04-P0-PERMISSION-RBAC-CONTRACT`（机制，互补） |
| 授权缓存安全 | **`302`** | `167-CACHE-INVALIDATION...`（性能语义） |
| 身份/角色/权益分离 + 账户生命周期 | **`303`** | `08`（注册 UX）、`72`（用户体验层） |
| 组织 / 企业 / IP 主理人 | **`304`** | `44-51`（MCN Center）、`76-83`（Creator） |
| 并发 / ETag / 幂等 | **`305`** | `05-P0-STATE-MACHINE-CONTRACT`（状态机机制） |
| 删除语义 / 软硬删除 | **`306`** | `160`（Retention/Erasure 策略） |
| 安全威胁模型 | **`307`** | `169`（密钥/事件）、`62`（风控）、`170`（限流） |
| ID 命名空间 | `174` | — |
| 事件语义 | `163` | — |
| 跨域一致性 | `164` | — |
| 缓存失效/热键/击穿 | `167` | `302`（安全语义） |
| 状态机机制（通用） | `05-P0-STATE-MACHINE-CONTRACT` | 各域状态机见 `contracts/state-machines/` |

### 3.1 冲突裁定规则

1. **新批（300+）文档优先于旧文档**，当二者对同一主题给出不同定义时（本文档已显式记录差异）。
2. **机器可读契约（`contracts/`）与文档冲突时，以文档为准，并立即修 `contracts/`**（文档是意图，契约是编码）。
3. 无法裁定 → 记入 §5 OPEN，**不得**静默选择。

---

## 4. 逻辑分类映射（对应 §48 的 18 类）

**不移动文件**，仅建立映射索引：

| 类别 | 对应现有文档 |
|---|---|
| 01-Architecture | `00`、`300`、`LUCKREAD-SELF-MEDIA-PLATFORM-ARCHITECTURE...`、`LUCKREAD-PAYLOAD-BOUNDARY...` |
| 02-Domain | `02`、`10`、`76-83`、`84-99` |
| 03-Identity-Authorization | `08`、`72`、`301`、`302`、`303`、`04-P0-PERMISSION-RBAC`、`169` |
| 04-Content | `10`、`53`、`57`、`58`、`59`、`60`、`61`、`84-99` |
| 05-Creator-IP | `43`、`44-51`、`76-83`、`100-107`、`197-236` |
| 06-Social | `11-P0-SOCIAL...`、`54`、`188`、`198` |
| 07-Media | `57`、`187`、`199` |
| 08-Feed | `12-P0-FEED...`、`55`、`189` |
| 09-Search | `53`、`194` |
| 10-Notification-Event | `56`、`163`、`165` |
| 11-API | `03`（两份）、`11-P0-PAYLOAD-EXTENSION...`、`contracts/openapi/` |
| 12-Security-Audit | `62`、`63`、`149`、`169`、`302`、`307` |
| 13-Commercial | `65`、`66`、`67`、`68`、`108-138` |
| 14-Lifecycle | `160`、`303`、`306` |
| 15-Operations | `71`、`150-153`、`161`、`162`、`164`、`170`、`171` |
| 16-Contract | `contracts/` 全部、`74`、`75`、`177` |
| 17-ADR | 各 `300+` 文档 §ADR；建议后续汇总为 `docs/ADR/` |
| 18-Contract-CI | `scripts/contract-ci.mjs`、`.github/workflows/contract-ci.yml` |

---

## 5. OPEN / PENDING

| ID | 问题 | 状态 |
|---|---|---|
| **OPEN-G01** | `215` 与 `216` 同名不同内容，需裁定权威版本 | **OPEN — 需作者确认** |
| **OPEN-G02** | 7 组编号重复是否通过重命名彻底解决（当前用别名表规避） | **PENDING** |
| **OPEN-G03** | 是否建立独立 `docs/ADR/` 目录汇总 ADR | **PENDING** |
| **OPEN-G04** | 2 份无编号架构文档是否纳入编号序列 | **PENDING** |

---

## 6. 文档准入门禁

新文档必须满足：

- [ ] 编号未被占用
- [ ] 首行声明 `Status` 与 `Canonical Source` 或 `Related`
- [ ] 与既有 Canonical Source 无冲突，冲突须记 ADR
- [ ] 涉及状态/枚举/权限的内容已在 `contracts/` 落地机器可读形式
- [ ] 不含「待定」「TBD」而未登记 OPEN
