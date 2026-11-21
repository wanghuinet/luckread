# LuckRead Global Product & Experience Superiority Contract v1.0

**状态：P0 / GLOBAL / NON-NEGOTIABLE / CONTRACT-BINDING**

## 1. Global Rule

LuckRead 的所有产品、架构、能力、数据、API、事件、权限、安全、UX、测试、运行时、成本、可靠性、运营和实现合同，必须以**高于主流自媒体平台的标准**作为最低目标。

LuckRead 不以“行业已有”“竞品已经这样做”“功能可用”“能够上线”作为最终质量标准。

本合同适用于当前 `main` 中所有合同，以及未来新增、修改、拆分、合并的所有合同。

目标参照范围包括但不限于：

```text
今日头条
抖音
快手
微博
小红书
B站
YouTube
TikTok
X
```

这些平台用于建立竞争基线，不代表 LuckRead 必须复制其产品、品牌、界面、专有实现或内部技术。

## 2. Precedence

本合同属于项目级质量与体验总合同。

合同优先级增加为：

```text
Global Product & Experience Superiority Contract
        ↓
Final Cross-Contract Reconciliation
        ↓
Domain Master Contract
        ↓
L1-L4 Traceability / Admission
        ↓
Data / API / Event / Permission / Security
        ↓
UX / Journey
        ↓
Implementation
```

任何较低级别合同与本合同冲突时，必须进行合同修订；不得通过代码解释降低本合同要求。

历史文档、旧版本设计、实验方案和实现代码均不得用于降低本合同要求。

## 3. Two-Dimensional Superiority Requirement

LuckRead 必须同时满足：

```text
A. Documentation / Engineering Superiority
B. Product / User Experience Superiority
```

只有工程标准高、但用户体验低，不得宣称完成；只有用户体验好、但可靠性和工程标准不足，也不得宣称完成。

## 4. Documentation / Engineering Superiority

所有进入 `main` 的正式合同至少必须达到以下完整度：

### 4.1 Capability Completeness

必须能够追踪：

```text
Requirement
→ L1
→ L2
→ L3
→ L4
→ Authority
→ Data
→ API / Control
→ Event
→ Permission / Security
→ Runtime
→ Test
→ Acceptance
```

关键能力不得只写页面或功能名称，必须覆盖完整生命周期。

### 4.2 Lifecycle Completeness

关键状态必须定义：

```text
normal
→ failure
→ retry
→ timeout
→ partial failure
→ recovery
→ rollback / compensation where applicable
→ final state
```

不能只定义成功路径。

### 4.3 Authority Completeness

每一项业务事实必须有唯一 authority。

允许多个：

```text
entry points
APIs
projections
caches
adapters
```

但不允许多个最终事实权威。

### 4.4 Security / Privacy Completeness

必须定义：

```text
Authentication
Authorization
Scope / Role
Least Privilege
Tenant Isolation
Sensitive Data Handling
Audit
Retention
Deletion
Export where applicable
```

### 4.5 Reliability Completeness

必须定义适用的：

```text
Idempotency
Concurrency Control
Retry
Backoff
DLQ
Replay
Backfill
Recovery
Reconciliation
Degraded Mode
```

### 4.6 Performance Completeness

必须定义与产品目标匹配的：

```text
Latency
Throughput
Concurrency
Hot-key behavior
Pagination
Fanout
Batching
Backpressure
```

### 4.7 Cost Completeness

Cloudflare-first 架构下，必须能够解释：

```text
Worker execution cost
D1 read cost
D1 write cost
R2 usage
Queue usage
Cache usage
External OSS cost where applicable
```

成本优化不得牺牲正确性、安全性、可靠性或用户体验。

### 4.8 Observability Completeness

关键请求和异步链必须尽可能关联：

```text
requestId
correlationId
traceId
entity/resource ID
eventId
```

### 4.9 Acceptance Evidence

“文档写明”不等于“能力完成”。

正式完成必须具有适当的：

```text
Implementation Evidence
Test Evidence
CI / CL Evidence
User Acceptance Evidence
```

## 5. Product / User Experience Superiority

LuckRead 的用户体验不能仅达到“与竞品相同”。

关键用户旅程必须以**明显优于同类主流产品**为设计目标，并在可验证指标或用户验收中体现。

核心维度至少包括：

```text
发现效率
搜索效率
内容理解
内容质量呈现
页面响应
交互流畅度
创建效率
编辑效率
发布确定性
失败可恢复性
推荐可控性
社交反馈效率
多媒体连续性
直播进入/返回连续性
跨设备连续性
隐私透明度
账号安全体验
创作者生产力
商业化透明度
售后与问题处理
```

## 6. Experience Superiority Rules

### 6.1 Fewer Steps

能够通过设计减少用户无价值操作时，不得保留额外步骤。

### 6.2 Faster Feedback

用户发起关键操作后，应尽快得到明确状态反馈；异步任务必须呈现可理解的进度、结果和恢复路径。

### 6.3 Better Failure Experience

失败不是简单返回错误码。

必须尽可能回答：

```text
发生了什么？
是否已成功？
是否可以重试？
重试会不会重复？
下一步应该做什么？
```

### 6.4 Better User Control

对于推荐、隐私、通知、关注、屏蔽、历史、账号生命周期等可控能力，应提供清晰且可逆的控制路径（法律/安全约束除外）。

### 6.5 Better Continuity

跨页面、跨设备、跨任务恢复时，不应无意义地让用户重新开始。

### 6.6 Better Transparency

状态、权限、商业化、审核、限制、失败、退款、权益等关键结果必须尽可能可理解，而不是让用户只能猜测系统发生了什么。

### 6.7 Better Accessibility

关键体验必须考虑可访问性、文字可读性、键盘/辅助技术兼容性、错误可理解性及适当的触控/响应区设计。

## 7. Competitive Benchmark Gate

所有重要产品能力必须建立：

```text
Industry Baseline
→ Competitor Capability Review
→ LuckRead Target
→ Design Contract
→ Acceptance Metrics
```

比较对象必须根据能力实际情况选择，不得为了“证明领先”而选择明显弱于 LuckRead 的样本。

## 8. No Blind Feature Parity

“高于其他自媒体平台”不等于无止境堆功能。

LuckRead 的竞争优势优先比较：

```text
完整性
正确性
速度
稳定性
可理解性
可恢复性
安全
隐私
用户控制权
创作者效率
商业透明度
```

功能数量本身不是唯一评价指标。

## 9. Mandatory Superiority Gate

任何能力在进入 `READY` 前必须经过：

```text
1. Industry Baseline
2. LuckRead Target
3. Documentation Completeness Review
4. UX Superiority Review
5. Security / Privacy Review
6. Reliability Review
7. Performance Review
8. Cost Review
9. Acceptance Definition
```

结果至少必须是：

```text
ABOVE_BASELINE
或
APPROVED_EXCEPTION
或
BLOCKED
```

不得出现：

```text
BELOW_BASELINE
```

并继续进入实现。

## 10. Approved Exception

只有以下类型可以形成例外：

- 法律 / 合规要求；
- 明确的外部依赖限制；
- 当前版本明确冻结的非 P0 能力。

任何例外必须记录：

```text
reason
scope
risk
owner
mitigation
targetVersion
```

“为了赶进度”“v1 先这样”“竞品也是这样”不能单独构成例外理由。

## 11. P0 User Journey Requirement

以下核心旅程必须优先达到高于行业基线的体验：

```text
注册 / 登录
个人主页
内容发现
搜索
推荐 / Feed
文章阅读
图集浏览
短视频 / 长视频观看
直播进入与返回
评论 / 互动
关注 / 收藏
内容创建
草稿恢复
内容发布
审核结果理解
创作者运营
粉丝关系
IP / 内容关系浏览
会员 / 订阅
商品 / 订单
支付 / 退款
消息 / 通知
账号安全 / 隐私
```

新增 P0 旅程必须加入本清单或经正式合同变更记录。

## 12. Measurement

“体验高于竞品”必须尽可能转化为可测试指标，例如：

```text
task completion time
interaction count
first useful response time
publish success rate
failure recovery rate
search success rate
content discovery success rate
cross-device recovery rate
draft recovery rate
support / recovery success rate
```

指标阈值必须在对应领域合同或验收合同中冻结，不得在实现完成后临时降低。

## 13. Architectural Consequence

当“高于行业体验”与成本、性能、实现复杂度发生冲突时，不允许简单删除体验目标。

必须按以下顺序优化：

```text
Remove unnecessary work
→ Cache
→ Aggregate
→ Async
→ Batch
→ Optimize data model
→ Optimize API composition
→ Optimize rendering
→ Introduce specialized infrastructure only when justified
```

最终仍无法达到目标时，必须形成 APPROVED_EXCEPTION，而不是默默降低标准。

## 14. Machine Governance Requirements

未来统一 CL / CI 应能够检查至少以下规则：

```text
GLOBAL-SUPERIORITY-CONTRACT-PRESENT
CONTRACT-INHERITS-GLOBAL-STANDARD
INDUSTRY-BASELINE-DEFINED
LUCKREAD-TARGET-DEFINED
UX-ACCEPTANCE-METRICS-DEFINED
FAILURE-RECOVERY-DEFINED
AUTHORITY-DEFINED
SECURITY-DEFINED
COST-IMPACT-DEFINED
APPROVED-EXCEPTION-RECORDED
```

任一 P0 合同缺失必要字段时，不得进入 `READY`。

## 15. STOP Conditions

以下任一情况必须 STOP：

- 产品能力低于明确行业基线却准备上线；
- UX 仅做到“与竞品一样”且无批准例外；
- 关键用户旅程没有失败/恢复设计；
- 核心状态没有可解释反馈；
- 文档存在重大 L1-L4 或 authority 空洞；
- 安全/隐私要求未定义；
- 性能/成本目标完全缺失；
- 用“v1”作为无限期降低质量的理由；
- 没有竞争基线就宣称“领先”；
- 没有验收证据就宣称 DONE。

## 16. Inheritance Rule

本合同不是一个可选的产品文档。

```text
ALL CURRENT CONTRACTS
        +
ALL FUTURE CONTRACTS
        ↓
MUST INHERIT THIS STANDARD
```

任何新合同必须显式声明：

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
```

任何旧合同与本合同不一致的地方，应通过合同重整逐步修复；旧合同不得被用作降低新实现标准的依据。

## 17. Status

```text
GLOBAL STANDARD = ACTIVE
PRODUCT STANDARD = ABOVE INDUSTRY BASELINE
UX STANDARD = ABOVE MAINSTREAM SELF-MEDIA BASELINE
DOCUMENT STANDARD = ABOVE MAINSTREAM SELF-MEDIA ENGINEERING BASELINE
IMPLEMENTATION AUTHORITY = SUBJECT TO FINAL ADMISSION
```
