# App 核心功能差距与工程推进优先级（main 源码 / 追踪表交叉核对）

日期：2026-11-27。静态源码/契约评审；未执行 CI、设备或生产旅程。此文不替代 release blocker register 或 acceptance matrix。

## 重要执行约束
- 以 main 最新内容重新检查，而非旧 tracker SHA 的状态快照。
- 不重审已关闭专项。Messaging R-07 已标记 INTEGRATION_ONLY，除集成回归/新证据外不循环审查。
- 不修改其他工程师开放 PR，不合并或关闭任何PR。
- 不能以X/Threads功能列表为由伪造功能入口或越过领域API、权限与安全合同。
- 当前发布阻断台账明确 R-06 发布媒体 runtime E2E BLOCKED；禁止旧 D1 E2E workflow 触碰生产。
- 当前APP验收矩阵的L0-L4等级继续适用；来源、自动化、构建、设备、真实数据验证分开记录。

## 本次交叉核对的发现

### 已有能力不应重复实现
- Feed：TanStack Query分页、query cache、hydration和Viewer-scoped query key已有代码及测试源。
- 账号生命周期：auth-store存在generation防竞态、账户存储与切换、账号会话槽位、push endpoint切换逻辑。query-provider的测试源声明账户切换时清理query/mutation cache。
- 发布：发布页已有草稿自动保存、pending media recovery、排期、投票和线程编排的测试源。
- 搜索/通知：分别有请求取消/竞态防护和深链/读状态结构；仍需旅程验收。
- 私信：源码含Realtime连接和bounded reconnect、页面有增量同步/附件等；该模块不要重新开展无差别深审，除账户集成/运行证据外遵守已封闭范围。

### 当前APP功能追踪表记录的产品差距（优先验证准确性）
| ID | 当前状态（tracker） | 缺口 | 优先级 / 推进方式 |
|---|---|---|---|
| APP-005 Quote Post | PARTIAL | 引用内容编辑器与权威引用关系未确认 | P1：核实领域API/已有PR，完整引用发布和详情旅程 |
| APP-003 Feed分类 | PARTIAL | Latest/Trending/Topic专属Feed权威API需核对 | P1：先查现有API及H5实现；不做假tab |
| APP-017 Search | PARTIAL | Top/Latest/People/Media过滤、联想与排序能力需逐项验证 | P1：API映射与界面状态完整性核对 |
| APP-011 Notifications | PARTIAL | 类型覆盖、聚合、深链、偏好语义 | P1：以服务端实际通知类别和W05/W09为依据 |
| APP-010 Video creation | PARTIAL | 剪辑、字幕、长视频制作体验 | P2：先评估已有组件/服务、成本及平台兼容 |
| APP-015 Creator Studio | MISSING | 原生经营/分析入口仅占位 | P2：复用H5与W07/W11能力，先完成API映射 |
| APP-018 Lists | MISSING | Lists应用能力 | P2：先验证后端关系与权限领域 |
| APP-019 Communities | MISSING | Communities应用能力 | P2：遵守W06治理与领域合同 |
| APP-020 Spaces/live audio | MISSING | 实时音频能力 | P3/延期：RTC/运营成本与服务合同先行 |
| APP-021 Custom feeds | NOT_AUDITED | 保存/自定义Feed | P2：确认排序、保存及权威偏好API |
| APP-023 Bookmark folders | PARTIAL | 收藏集合/文件夹 | P2：先确认领域API，避免客户端本地伪实现 |

## 工程执行顺序（合并成阶段，不拆成零散重复任务）

### Stage A — App core beta closure
1. 对已有功能做跨账号切换、登出、session过期、请求竞态和cache恢复的定向回归，不重复已通过源测试。
2. Feed、Search、Notifications、Profile、发布的关键旅程缺失自动化时补测试；只对受影响文件运行测试。
3. 发布与媒体闭环以R-06隔离测试资源要求为准；没有专用Neon/R2/W03 topology不得宣称E2E完成。
4. 逐项核对真实API授权/错误状态、幂等、读回与缓存失效，优先处理P0。

### Stage B — X/Threads parity features, with source contracts
- Quote Post、搜索过滤、通知语义、Feed分类；每个垂直切片先确认服务端权威数据，再实现完整界面。
- Custom feeds、Lists、Creator Studio、Bookmark folders按领域API成熟度排队；复用H5/API而不在App重复建业务逻辑。
- Communities/Spaces/AI等非Beta必需功能单独批准和成本/安全评审，默认延期。

### Stage C — UX and performance proof
- 逐屏检查加载、空、失败、成功、禁用、恢复、主题、动态字体、读屏和触控面积。
- 量化启动、TTNC、滚动/列表、媒体加载、发布成功率、消息延迟和崩溃；分设备/网络统计，不用主观百分比替代。
- 按验收矩阵 L1/L2/L3/L4 逐层取证；无证据不改状态。

## 阶段结论
现有App基础功能实现和测试源已经较广；beta工程风险不是简单“缺页”，而是release register所列的真实环境、媒体E2E、安全/账号边界、设备验收、发布/应用商店证据。产品Parity功能应有独立队列，不能与Beta blocker混成无限审计循环。下轮应进入Stage A的定向回归/修复阶段，遵循影响范围和最新PR状态，避免重新审计Messaging sealed scope或反复修改文档。
