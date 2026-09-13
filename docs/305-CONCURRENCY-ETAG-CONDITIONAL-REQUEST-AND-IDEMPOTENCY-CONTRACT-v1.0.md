# LuckRead 并发 / ETag / 条件请求 / 幂等 合同 v1.0

**Status:** P0 / CANONICAL
**Related:** `docs/05-P0-STATE-MACHINE-CONTRACT-v1.0.md`、`docs/03-P0-API-ERROR-PAGINATION-CURSOR-CONTRACT-v1.0.md`

---

## 0. 审计发现

| 检查项 | 全库命中 | 结论 |
|---|---|---|
| `ETag` | **0** | ❌ 完全缺失（用户 §23/§27 明确要求） |
| `Optimistic` | 13 | ⚠️ 仅状态机文档提及，无统一合同 |
| `Idempotency` | 127 | ✅ 有要求，但无统一 Key/Payload Hash/冲突语义 |
| `Circuit Breaker` | 2 | ⚠️ 薄弱 |
| `Fail Closed` | 2 | ⚠️ 薄弱（授权部分见 `docs/302`） |

**结论：** ETag/条件请求是**完全空白**，属于会导致 API 重构的 P0 缺口。

---

## 1. 版本号 / Revision 模型

### 1.1 三层版本

| 层 | 字段 | 语义 | 变更时机 |
|---|---|---|---|
| **资源版本** | `version` | 乐观锁，单调递增 | 每次成功写 |
| **内容修订** | `revision` | 业务修订号（草稿版本） | 每次保存草稿/发布 |
| **表示版本** | `etag` | 表示层校验，用于条件请求 | 随 `version` + 表示格式变化 |

**规则：**

- `version` 是**权威并发控制**依据，必须参与 compare-and-set。
- `revision` 是**业务历史**编号，用于版本回滚，不用于并发控制。
- `etag` **不得**作为并发控制依据（表示层可因格式变化而变）。

### 1.2 ETag 格式

```text
ETag: "v{version}-r{revision}-{representation_hash}"
```

- 强校验：`W/` 前缀**禁止**用于写操作的条件匹配。
- 弱校验（`W/`）仅允许用于只读缓存协商。

---

## 2. 条件请求（Conditional Request）

### 2.1 请求头

| 头 | 用途 | 适用场景 |
|---|---|---|
| `If-Match` | 写操作前置校验（`version`） | PUT / PATCH / DELETE / 状态转换 |
| `If-None-Match` | 读操作缓存协商 | GET |
| `If-Modified-Since` | 读操作缓存协商（兜底） | GET |

### 2.2 响应行为

| 场景 | 响应 |
|---|---|
| `If-Match` 匹配 | 正常处理 |
| `If-Match` 不匹配 | **412 Precondition Failed** + `CONFLICT` 错误码 + 当前 `ETag` |
| 写操作**缺少** `If-Match` 且资源要求乐观锁 | **428 Precondition Required** |
| `If-None-Match` 匹配（未变） | **304 Not Modified** |
| 资源不存在 | 404 |

### 2.3 强制要求乐观锁的操作

以下操作**必须**要求 `If-Match`：

- 内容更新（PUT/PATCH）
- 内容状态转换（发布/撤回/归档/定时发布）
- 草稿保存（双编辑防护）
- IP / 组织成员角色变更
- 账户状态变更
- 订阅变更
- 审核判定
- 媒体元数据更新

**豁免（不要求）：** 纯追加型（评论创建、点赞、关注走幂等而非乐观锁）。

---

## 3. 并发场景与解法

| 场景 | 机制 | 冲突响应 |
|---|---|---|
| **双编辑**（两人同编一份草稿） | `If-Match` + `version` CAS | 412 + `CONFLICT`，前端提示并展示差异 |
| **双发布**（同时点发布） | 状态机 CAS + 幂等 Key | 第二次返回首次结果（同 Key）或 409（不同 Key） |
| **重复提交**（网络重试） | 幂等 Key | 返回首次结果，**不产生副作用** |
| **并发点赞** | 幂等 + 唯一约束 `(user_id, target_id)` | 幂等成功，计数不重复 |
| **并发关注** | 幂等 + 唯一约束 `(follower_id, followee_id)` | 幂等成功 |
| **并发状态转换** | 状态机 CAS + `If-Match` | 非法转换 → 409 `INVALID_STATE` |
| **并发撤权 + 请求** | 版本化失效（`docs/302`） | 撤销后请求 DENY |
| **并发定时发布 + 手动发布** | 状态机 CAS | 后者得 `INVALID_STATE` |

**规则：**

- **Last-Write-Wins 禁止**用于任何受保护的状态转换（沿用 `docs/05` §6）。
- 计数器（点赞数、阅读数）**不得**用乐观锁逐条争用，走聚合/异步（`docs/00` 成本原则）。
- 唯一约束必须由数据库保证，应用层幂等只是优化。

---

## 4. 幂等（Idempotency）

### 4.1 必须支持幂等的操作

| 操作 | 幂等 Key 来源 |
|---|---|
| Create（内容/评论/IP/组织） | 客户端生成 `Idempotency-Key` |
| Publish / Unpublish / Schedule | 客户端 Key 或 `(resource_id, command, version)` |
| Like / Unlike / Favorite | 自然幂等：`(user_id, target_type, target_id)` |
| Follow / Unfollow | 自然幂等：`(follower_id, followee_id)` |
| Upload（含分片） | `upload_id` + 分片序号 + checksum |
| Payment / 订阅变更 | 客户端 Key（**强制**） |
| Webhook 接收 | `event_id`（生产者侧去重） |
| Event 消费 | `event_id`（见 `docs/163` §6） |
| Job 执行 | `job_run_id` |

### 4.2 幂等记录模型

```text
IdempotencyRecord {
  idempotency_key,       // 客户端 Key 或自然 Key
  scope,                 // user_id / org_id / service
  endpoint,              // 或 command 名
  payload_hash,          // 规范化请求体的 SHA-256
  state,                 // IN_PROGRESS | COMPLETED | FAILED
  response_digest,       // COMPLETED 时保存
  created_at,
  expires_at             // 默认 24h
}
```

### 4.3 语义规则（强制）

| 情况 | 行为 |
|---|---|
| 相同 Key + 相同 Payload + `COMPLETED` | **返回首次结果**（含原状态码），不重复执行 |
| 相同 Key + 相同 Payload + `IN_PROGRESS` | **409** `IDEMPOTENCY_IN_PROGRESS` + `Retry-After` |
| 相同 Key + **不同** `payload_hash` | **422** `IDEMPOTENCY_KEY_REUSE_CONFLICT` |
| Key 过期 | 视为新请求 |
| 无 Key 且端点要求幂等 | **400** `IDEMPOTENCY_KEY_REQUIRED` |

**规则：**

- 幂等记录**必须**与业务写入在**同一事务**内落库（D1-01/D1-03 `ops_`）。
- `payload_hash` 必须对**规范化**后的 JSON（排序键、去空白）计算。
- 响应体 `digest` 保存需权衡体积：默认只保存状态码 + 关键 ID，完整响应可选。
- 幂等记录过期由 W08 清理，默认保留 24h。

### 4.4 请求头

```text
Idempotency-Key: <uuid-v4>       // 客户端生成，≤ 255 字符
```

支付/订阅类端点 **强制要求**；其他写端点推荐要求。

---

## 5. 重试 / 退避 / 熔断

### 5.1 重试策略

| 层 | 策略 |
|---|---|
| 客户端 → API | 指数退避 + 抖动；仅对 `5xx` 与 `429` 重试；**不得**重试 `4xx`（除 `429`） |
| API → D1 | **不重试**写（避免重复副作用）；读可重试 1 次 |
| API → 内部域 | 超时 ≤ 2s，重试 ≤ 2 次，带抖动 |
| Event 消费 | 见 `docs/163` §7（指数退避 + DLQ） |

### 5.2 超时

| 调用 | 超时 |
|---|---|
| 客户端 → W01 | 由网关控制 |
| W01 → W00 | 10s |
| W00 → D1 | 5s |
| W00 → 派生域（W03/W04/W05） | 2s（**失败不阻塞**） |
| 敏感操作鉴权 | 2s（超时 → Fail Closed DENY） |

### 5.3 熔断

- 派生域（W03/W04/W05/W07）**允许**熔断 → 降级为回源或空结果。
- **D1 与鉴权路径禁止熔断放行**：只能熔断后 Fail Closed 或快速失败。
- 熔断状态必须有可观测指标与自动恢复。

### 5.4 禁止降级的场景

- ❌ 授权判定（`docs/302` §5）
- ❌ 审计写入（敏感操作）
- ❌ 账户状态校验
- ❌ 支付/结算
- ❌ 内容审核放行（可降级为「转人工队列」，**不得**降级为「自动通过」）

---

## 6. 错误契约

| 错误码 | HTTP | 说明 | Retryable |
|---|---|---|---|
| `CONFLICT` | 409 | 版本冲突 / 并发冲突 | ❌（需重新获取版本） |
| `PRECONDITION_FAILED` | 412 | `If-Match` 不匹配 | ❌ |
| `PRECONDITION_REQUIRED` | 428 | 缺少 `If-Match` | ❌ |
| `INVALID_STATE` | 409 | 非法状态转换 | ❌ |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 缺少幂等 Key | ❌ |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 同一 Key 正在处理 | ✅（`Retry-After`） |
| `IDEMPOTENCY_KEY_REUSE_CONFLICT` | 422 | 同 Key 不同 Payload | ❌ |

---

## 7. 开发准入门禁

- [ ] `version` / `revision` / `etag` 三字段已建模
- [ ] `If-Match` 强制校验已在要求乐观锁的端点实现
- [ ] 412 / 428 / 409 已按契约返回
- [ ] `IdempotencyRecord` 已建模，与业务写同事务
- [ ] 自然幂等唯一约束（`like`/`follow`）已建唯一索引
- [ ] 支付端点强制幂等 Key
- [ ] 并发测试：双编辑、双发布、重复提交、并发点赞/关注
