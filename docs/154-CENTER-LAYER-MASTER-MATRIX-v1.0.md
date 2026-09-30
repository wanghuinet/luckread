# LuckRead Center Layer Master Matrix v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**适用范围：18 个 Center 全局体验层**

## 1. 目的

本合同冻结 LuckRead 的 18 个 Center。Center 是体验、任务、聚合、操作入口和状态解释层，不创建业务第二权威。

统一目标：吸收主流自媒体、内容社区、内容电商、创作者平台和国际平台的成熟实践，再以 LuckRead 的跨内容、跨 IP、跨商业和跨设备体验形成更高的产品基线。

## 2. 18 Center Registry

| Center | Primary Authority | 主要体验职责 |
|---|---|---|
| 用户中心 | User / Identity | 账户、资料、安全、隐私、偏好 |
| 个人内容空间 | Content / Social / Activity | 我的作品、草稿、收藏、历史、关注、评论 |
| 创作者中心 | Creator / Content / Production | 创作、作品、素材、发布、粉丝、数据、商业化 |
| MCN中心 | MCN / Organization | 团队、成员、作品、经营、协作、收益 |
| 商家中心 | Merchant / Commerce | 店铺、商品、订单、履约、经营 |
| 广告主中心 | Advertising | Campaign、创意、预算、投放、归因 |
| 开发者中心 | Open Platform | 应用、API、凭证、版本、Webhook、开发者经营 |
| IP中心 | Content / IP Graph | IP、作品、角色、系列、关系、商业化 |
| 版权/权益中心 | Rights | 权属、授权、地域、期限、争议、证据 |
| 订单中心 | Commerce / Fulfillment | 订单、支付结果、权益、履约、售后 |
| 收益/钱包中心 | Ledger / Settlement | 收益、余额、结算、提现、资金解释 |
| 社区中心 | Social / Community | 社区、成员、主题、互动、治理入口 |
| 消息中心 | Notification / IM | Inbox、会话、通知、任务消息 |
| 安全中心 | Identity / Risk | 设备、会话、认证、恢复、安全告警 |
| 审核治理中心 | Moderation / Risk / Rights | 审核、案件、证据、处罚、申诉、恢复 |
| 数据/增长中心 | Analytics / Growth | 指标、诊断、实验、增长行动 |
| 平台运营中心 | Platform Operations | 发布、健康、故障、容量、成本、审计 |
| 客服/帮助中心 | Support / Operations | 搜索、排障、工单、申诉、服务状态 |

## 3. Layer Rule

```text
Center
= Experience + Aggregation + Workflow + Action Entry + State Explanation

Domain
= Business Authority + Durable Fact + State Machine
```

Center 禁止：

- 自建第二业务事实表作为权威；
- 绕过领域 API 直接读取/修改业务表；
- 以缓存、搜索索引或统计结果覆盖权威状态；
- 把多个 Domain 的责任重新合并为不可审计的“大中心服务”。

## 4. Global Experience Contract

18 个 Center 必须共享以下体验标准：

```text
One Context
One Current State
One Next Action
Explain Why
Recover Failure
Preserve Progress
Cross-device Continuity
Permission-aware Composition
```

关键状态统一表达：

```text
发生了什么？
为什么？
影响什么？
下一步是什么？
失败后怎么恢复？
```

## 5. Benchmark Method

Center 设计必须参考至少一个国内平台和一个国际平台的成熟模式；高价值中心应做多平台交叉对标。

参考池包括：

```text
今日头条 / 抖音 / 快手 / 微博 / 小红书 / B站
YouTube / TikTok / X
```

对标仅用于能力与体验基线，不复制品牌、视觉资产、专有文案或内部实现。

## 6. Cross-Center Journeys

### 6.1 User → Creator
`User Center → Creator Entry → Creator Center → Content → Analytics → Earnings`

### 6.2 Content → IP → Rights
`Content → IP Center → Rights Center → Licensing / Dispute`

### 6.3 Commerce
`Content / Merchant → Product → Order Center → Fulfillment → Earnings`

### 6.4 Advertising
`Advertiser Center → Creative → Review → Delivery → Analytics → Billing`

### 6.5 Community
`Content → Community → Interaction → Message → Moderation → Appeal`

### 6.6 Incident / Support
`User-visible Problem → Help Center → Diagnosis → Domain Action → Verification`

## 7. Cross-Center Non-Duplication

| 能力 | 权威 | Center |
|---|---|---|
| User identity | User / Identity | 用户中心、安全中心 |
| Creator state | Creator | 创作者中心、MCN中心 |
| Content | Content domains | 个人内容空间、创作者中心、IP中心 |
| Social relation | Social | 社区中心、个人内容空间 |
| Message | Notification / IM | 消息中心 |
| Order | Commerce | 订单中心、商家中心 |
| Money | Ledger / Settlement | 收益/钱包中心、MCN/商家经营入口 |
| Rights | Rights | 版权/权益中心、IP中心 |
| Risk | Risk | 安全中心、审核治理中心 |
| Moderation | Moderation | 审核治理中心、业务申诉入口 |
| Analytics | Analytics | 数据/增长中心、各中心摘要 |
| Runtime | Platform Operations | 平台运营中心 |
| Support cases | Support capability | 客服/帮助中心 |

## 8. Performance / Cost

Center 页面不得无界同步 fan-out；必须优先消费可缓存的摘要、预聚合数据和稳定 Domain API。大型导出、复杂报告、批量治理和历史重算采用异步任务。

## 9. Security / Privacy

每个 Center 必须定义 actor、scope、resource authorization、敏感字段最小化、审计和跨租户隔离。Center 聚合不得形成权限旁路。

## 10. Superiority Gate

每个 Center 都必须证明：

1. 功能覆盖行业关键任务；
2. 关键任务路径不劣于主流基线；
3. 状态解释、异常恢复和跨设备连续性达到更高目标；
4. 权限、隐私和安全不降低；
5. 性能、成本、可观察性可量化；
6. 关键结论能够由证据复现。

最终准入必须通过 `139-GLOBAL-PRODUCT-AND-EXPERIENCE-SUPERIORITY-CONTRACT-v1.0.md`。

## 11. STOP

任一 Center 出现第二业务权威、权限旁路、隐藏失败、不可恢复关键操作、不可追溯状态、跨 Center 重复事实、敏感信息泄漏或低于行业基线，立即停止实现并回到合同审查。

## 12. Status

```text
CENTER_REGISTRY = COMPLETE
BOUNDARY = FROZEN
IMPLEMENTATION = PENDING
GLOBAL_ADMISSION = PENDING
```
