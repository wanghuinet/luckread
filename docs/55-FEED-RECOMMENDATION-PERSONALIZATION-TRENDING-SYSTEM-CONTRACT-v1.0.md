# LuckRead Feed / Recommendation / Personalization / Trending System Contract v1.0

**状态：PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. 定位

本系统统一定义分发，但明确拆分四类责任：

- Feed：决定用户可看到哪些分发流
- Recommendation：对候选内容进行个性化排序
- Personalization：维护用户可控的兴趣与体验偏好
- Trending：产生公共热点候选与趋势榜单

四者不能互相替代。

## 2. 总链路

```text
Sources
→ Eligibility
→ Privacy / Safety / Rights
→ Candidate Recall
→ Trust / Signal Validation
→ Ranking / Personalization
→ Diversity / Frequency Cap
→ Final Feed
```

Trending：

```text
Raw Events
→ Trust / Anti-abuse
→ Valid Signals
→ Aggregation
→ Trend Candidate
→ Safety / Moderation
→ Ranking
→ Public Surface
```

## 3. 信号可信度

任何曝光、点击、播放、停留、点赞、分享等原始行为都不能直接成为可信推荐信号。

```text
Raw Event
→ Admission
→ Risk / Trust
→ Valid Signal
→ Aggregation
→ Recommendation / Growth / Analytics
```

## 4. Personalization

用户可控制：follow、topic preference、creator/IP preference、not interested、mute、block、history、recommendation reset、notification preference、privacy choices。

个性化状态必须可解释、可撤销、可重建。

## 5. 数据权威

Feed、ranking、trend、feature、candidate list 都是派生数据。Content、Creator、IP、Social、Risk、Rights 等事实来自对应 Domain。

## 6. API

`/v1/feed`、`/v1/recommendations`、`/v1/preferences`、`/v1/trending`。

统一 requestId、cursor、schemaVersion、stable error、privacy/safety filter、rate limit。

Feed mutation 与 preference mutation 必须幂等。

## 7. Event

至少覆盖 exposure、click/open、dwell、completion、like、comment、favorite、share、follow、not_interested、hide、report，以及 content/creator/IP lifecycle changes。

消费者必须支持 at-least-once、deduplication、replay、rebuild。

## 8. Safety / Rights

Feed 与 Recommendation 只能消费经过 eligibility、privacy、moderation、rights、risk policy 的候选。

被删除、隐藏、封禁、版权限制的内容必须具有快速下线路径。

## 9. Cold Start

必须支持 visitor、new user、new creator、new content、new IP 的冷启动策略，不得依赖历史行为才能产生可用首页。

## 10. Diversity / Control

必须防止单一作者/IP/主题无限占据 Feed，并提供频控、去重和用户可控反馈。

## 11. Performance / Cost

- 候选生成与排序异步化
- 热门公共结果可缓存
- feature/read model 可重建
- 高频曝光不得逐条同步写入主权威业务状态
- ranking 预算必须定义 p50/p95/p99
- 大规模 fan-out 必须采用受控异步任务

## 12. Observability

必须观测：feed latency、candidate count、ranking latency、cache hit、empty rate、duplicate rate、policy filtering、stale result、signal freshness、trend freshness、rebuild mismatch。

## 13. Acceptance

P0 必须验证：首页、关注流、热点、相关内容、冷启动、个性化控制、not interested、block/mute、删除内容快速消失、风控信号隔离、重复事件、排序重建、趋势防刷、跨设备偏好同步。

## 14. STOP

- Raw Event 直接进入 ranking
- Recommendation 绕过 Safety/Rights
- Ranking state 被当作权威事实
- Feed 无 rebuild
- Trending 可被低成本刷榜
- Block/mute 无效
- 删除内容持续推荐
- 无冷启动
- 无频控/多样性

## 15. READY

必须完成 L1-L4、Data/API/Event、Permission/Security、Risk/Trust、Privacy/Rights、Test、Performance/Cost、Observability、CI、User Acceptance 全链路。

当前：**IMPLEMENTATION PENDING**。
