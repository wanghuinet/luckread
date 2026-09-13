# LuckRead Payload 边界与 Worker 拆分合同 v1.0

**Status:** ARCHITECTURE BASELINE  
**Repository:** `wanghuinet/luckread`  
**Related:** `LUCKREAD-SELF-MEDIA-PLATFORM-ARCHITECTURE-AND-BLUEPRINT-v1.0.md`  
**Purpose:** 明确哪些能力必须保留在 Payload Runtime，哪些能力允许通过少量 Payload 扩展后独立为 Worker，避免未来为了扩展性而过度修改 Payload Core。

---

## 1. 核心原则

LuckRead 不把 Payload 当成整个业务后端，而把 Payload 定位为平台的 CMS / Admin / Identity / Access / Lifecycle 基础运行时。

Worker 的拆分原则不是“一个业务模块一个 Worker”，也不是预先固定 Worker 数量，而是：

> **以 Payload 能力边界为第一判断条件；以稳定 API 边界为第二判断条件；当 API 已经可以形成独立运行、独立扩缩容、独立故障域或独立计算负载时，才拆为独立 Worker。**

统一 API 入口仍然可以保持：

```text
api.luckread.com/v1/*
```

API 统一不等于 Worker 必须统一。

---

## 2. Payload Core 保护边界

以下能力原则上不得从 Payload Runtime 拆成远程服务，也不得通过修改 Payload Core 的方式重构其生命周期：

### 2.1 Identity / Auth

- Users
- Accounts
- Authentication
- Sessions
- Identity linkage
- 基础身份状态

原因：身份、Session、Access 与 Payload 生命周期高度耦合。将其远程化会增加状态同步、网络故障和权限一致性风险。

### 2.2 Collections / Fields

- Collections
- Fields
- Relationships
- Schema
- Collection configuration

原因：Collection Schema 是 Payload 的核心抽象，不应通过远程 Worker 代替。

### 2.3 Access Control

- Access functions
- Roles
- Permissions
- Collection-level access
- Field-level access

原因：Access 与 Collection、User、Request 生命周期直接相关。

### 2.4 Hooks / Lifecycle

- beforeValidate
- beforeChange
- afterChange
- beforeRead
- afterRead
- 其他 Payload 生命周期 Hook

原则：Payload 生命周期 Hook 保持在 Payload Runtime 内。Hook 可以发布事件，但不应被拆成必须同步 RPC 才能完成核心写入的远程服务。

### 2.5 Admin

- Payload Admin
- Admin UI
- Admin authentication
- Collection management
- Field management
- Draft / Version management

Admin 依赖 Payload Config、Collection、Access、Auth 和 API，不进行机械拆分。

### 2.6 Draft / Versions / Localization

这些属于内容管理生命周期基础能力，原则上保留在 Payload Runtime。

### 2.7 REST / GraphQL 基础运行时

Payload 原生 REST / GraphQL 可以继续作为基础实现，但客户端业务合同不得依赖 Payload 内部实现细节。

### 2.8 Database Adapter / Migration

Payload DB Adapter、Migration 和 Schema 生命周期保持在 Payload 数据边界内。

不得为了 Worker 拆分而建立：

```text
Business Worker -> HTTP -> Database Worker -> D1
```

来替代正常的数据访问路径。

---

## 3. 允许少量扩展但不修改 Core 的区域

LuckRead 可以使用 Payload 官方扩展机制完成平台业务适配：

- Collections
- Fields
- Hooks
- Access
- Plugins
- Custom Endpoints
- 独立业务模块

允许增加薄适配层，但必须满足：

1. 不改变 Payload 核心生命周期语义。
2. 不维护 Payload 私有 Fork。
3. 不修改 Payload 内部核心代码作为长期方案。
4. Payload 官方升级时可以直接升级核心版本。
5. 自有代码尽量位于应用层、插件层、Endpoint 层和 Worker 层。

---

## 4. 可以独立 Worker 的能力

以下能力不属于 Payload Core，可以根据 API、负载和故障域独立拆分。

### 4.1 Feed Worker

职责：

- Candidate generation
- Feed distribution
- Ranking
- Personalization
- User interest
- Behavior feedback
- Feed cache

Payload 只负责内容和基础用户/创作者数据；Feed Worker 负责高频分发和排序。

### 4.2 Search Worker

职责：

- Content search
- Creator search
- User search
- App / Game search
- Suggestion
- Hot search
- Search indexing

Payload 内容变更可以通过事件触发索引更新。

### 4.3 AI Worker

职责：

- AI Search
- Creator AI
- AI writing
- AI summarization
- AI translation
- AI dubbing
- AI remix
- AI recommendation assistance
- AI agent

AI 计算不得进入 Payload Core。

### 4.4 Video Worker

职责：

- Video processing
- Transcoding
- Multi-bitrate generation
- Thumbnail / poster generation
- Subtitle processing
- Audio extraction
- Video moderation pipeline
- Long-video clipping

Payload 保存视频业务元数据和处理状态；R2 保存对象；Worker 承担重计算。

### 4.5 Media Processing Worker

可承担：

- Image resize
- Image optimization
- Format conversion
- Document processing
- Preview generation
- Media checksum / validation

R2 是对象存储，D1 保存元数据和状态。

### 4.6 Notification Worker

职责：

- Like notification
- Comment notification
- Follow notification
- Mention
- System notification
- Creator notification
- Revenue notification
- Notification aggregation
- Push / Email 等外部通知适配

Payload 产生业务事件，Notification Worker 异步处理。

### 4.7 Analytics Worker

职责：

- Impression
- Click
- View
- Play
- Dwell time
- Like / Share / Follow events
- Creator analytics
- Content analytics
- Conversion analytics

高频行为数据不得无条件写入 Payload CRUD 生命周期。

### 4.8 Ranking / Recommendation Worker

职责：

- Hot ranking
- Creator ranking
- Content ranking
- App ranking
- Personalized recommendation
- Candidate scoring

Feed 可以调用 Ranking / Recommendation 能力，但是否独立成单独 Worker 应由真实负载决定。

### 4.9 Commerce Worker

职责：

- Revenue
- Ledger
- Campaign
- Advertising
- Subscription
- Reward
- Settlement
- Creator revenue share
- MCN revenue share
- Affiliate

资金相关逻辑必须保持独立业务边界，不应深度绑定 Payload Admin CRUD。

### 4.10 Apps Market Worker

Apps Market 可以形成独立业务边界：

- App discovery
- App search
- App detail
- App version
- Release
- Distribution
- Review
- Rating
- Ranking
- Installation / open statistics
- App analytics

App 基础 CMS 元数据可以继续由 Payload 管理；高频分发、搜索、统计和发布流水线可逐步独立。

### 4.11 Developer Worker

职责：

- Developer organization
- App submission
- Version submission
- Release workflow
- Developer analytics
- API / SDK management
- Developer billing

与 Apps Market 可以先同 Worker，达到独立边界后再拆。

### 4.12 IM / Messaging Worker

职责：

- Conversation
- Message
- Unread state
- Presence
- Delivery state
- Message fan-out

不建议把高频实时消息写入 Payload 普通 CRUD 生命周期。

### 4.13 Game / MiniApp Runtime Worker

职责：

- Game runtime API
- MiniApp runtime API
- Runtime session
- Distribution
- Runtime telemetry

Apps Market 管理应用身份和发行信息；Runtime Worker 负责实际运行时能力。

---

## 5. Creator / MCN 的特殊拆分规则

Creator 不能简单地全部从 Payload 拆走。

### Payload 保留

- Creator Profile
- Creator identity
- Creator verification state
- Creator ownership relationship
- Organization membership
- 基础权限

### 可独立 Worker

- Creator analytics
- Creator ranking
- Creator growth
- Creator recommendation
- Creator revenue calculation
- MCN settlement
- Campaign matching
- Creator incentive engine

原则：**身份和关系留在 Payload；高频计算和商业运营能力拆出去。**

---

## 6. Media / R2 边界

Payload Media Collection 可以继续保留在 Payload Runtime：

```text
Media metadata
R2 object key
checksum
size
width / height
duration
processing status
```

实际对象：

```text
R2
```

重计算：

```text
Video Worker
Media Processing Worker
AI Worker
```

不得为了拆 Worker 而把 Media Collection 本身强制远程化。

---

## 7. Worker 拆分判定门

新增能力必须依次回答：

### Gate A — 是否属于 Payload Core 生命周期？

如果是：

> 保留在 Payload Runtime。

### Gate B — 是否可以通过 Payload 官方扩展机制实现？

如果是：

> 优先使用 Collection / Field / Hook / Access / Plugin / Custom Endpoint 等薄扩展。

### Gate C — 是否形成独立 API？

如果否：

> 不拆。

如果是：继续判断。

### Gate D — 是否具有独立运行价值？

至少满足一项：

- 独立高吞吐
- 独立扩缩容
- 独立故障域
- 独立部署周期
- 独立安全边界
- 独立计算资源需求
- 明显影响 Payload Worker 包体 / 启动时间
- 独立技术栈或运行时需求

满足后才允许拆 Worker。

---

## 8. 禁止的拆分方式

### 8.1 不按目录机械拆 Worker

```text
collections/ -> Worker A
hooks/       -> Worker B
admin/       -> Worker C
```

禁止。

### 8.2 不为了“微服务化”而拆

```text
User Worker
Article Worker
Comment Worker
Like Worker
Follow Worker
```

如果这些能力都深度依赖 Payload Schema / Access / Hooks，则不应该机械拆分。

### 8.3 不建立 Database Worker

业务 Worker 不应通过一个 Database Worker 间接访问 D1，除非未来存在明确的数据安全或跨系统访问需求。

### 8.4 不 Fork Payload Core

不得通过长期维护 Payload Fork 实现业务扩展。

---

## 9. 推荐的运行时形态

初期可以：

```text
api.luckread.com
       │
       ▼
Payload / Main Worker
       │
       ├── Identity
       ├── Creator
       ├── MCN
       ├── Content
       ├── Media metadata
       ├── Interaction
       └── Admin
```

当独立 API 成熟后：

```text
                         api.luckread.com
                                │
                         API Router / Gateway
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 Payload Main              Feed Worker             Search Worker
        │                       │                       │
        ▼                       ▼                       ▼
       D1                 Cache / State          Search Index
        │
        └───────────────────┬───────────────────────────┐
                            │                           │
                            ▼                           ▼
                       AI Worker                 Video Worker
                            │                           │
                            ▼                           ▼
                           R2                          R2
```

Worker 数量不预设。每个新增 Worker 都必须通过本合同的拆分判定门。

---

## 10. Payload 升级兼容原则

LuckRead 的目标不是“改造 Payload”，而是“在 Payload 之上构建平台”。

因此：

```text
Payload Official Core
        ↓
Official upgrade
        ↓
Compatibility validation
        ↓
LuckRead extensions
        ↓
Independent Workers
```

Payload 官方升级时：

1. 优先升级官方版本。
2. 运行 Collection / Hook / Access / Plugin / Endpoint 回归测试。
3. 验证 D1 Adapter 和 R2 Storage。
4. 验证 Admin。
5. 验证独立 Worker API 合同。
6. 不因为业务 Worker 而阻止 Payload Core 升级。

---

## 11. 最终边界

### 必须留在 Payload Runtime

```text
Auth
Users
Sessions
Collections
Fields
Schema
Access
Hooks
Admin
Drafts
Versions
Localization
Payload REST / GraphQL runtime
DB Adapter
Migrations
```

### 可以少量 Payload 扩展后独立

```text
Creator Analytics
MCN Analytics
Creator Growth
Notification
Content indexing
App management workflows
Developer workflows
```

### 天然适合独立 Worker

```text
Feed
Search
AI
Video Processing
Media Processing
Recommendation
Ranking
Analytics
Commerce
Apps Market runtime
Game runtime
MiniApp runtime
IM / Messaging
```

---

## 12. 架构结论

LuckRead 的目标架构不是：

> “把 Payload 拆成很多 Worker。”

而是：

> **“保留 Payload 最有价值、最强耦合的 CMS 基础能力；用少量官方扩展机制连接业务；凡是已经形成独立 API 和独立运行边界的能力，再自然演化成 Worker。”**

因此 Worker 拆分是**能力驱动、API 驱动、负载驱动**，而不是数量驱动。

这条合同与平台总体蓝图共同作为后续实现依据。新功能在进入代码开发前，必须先判断其 Payload 边界与 Worker 边界。