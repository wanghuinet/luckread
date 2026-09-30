# LuckRead IP Commercial Growth / IP Value Lifecycle Contract v1.0

**状态：CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. Purpose

本合同补齐 IP Center 的 P1 商业增长闭环：

```text
Discovery
→ Qualified Interest
→ Intent
→ Match
→ Trade
→ Usage
→ Performance
→ Renewal
→ Expansion
→ Value Reassessment
→ New Discovery
```

目标不是让 IP Center 自行成为推荐、广告、Analytics、Commerce 或 Ledger Authority，而是定义 IP 商业生命周期的增长事实、价值指标、反馈和跨域触发关系。

## 2. Authority Boundary

| Domain | Authority |
|---|---|
| IP Identity | IP / Entity Authority |
| Rights | Rights Authority |
| Trade Admission | Trade Admission Authority |
| Order / Commerce | Commerce Authority |
| License | License Authority |
| Usage / Compliance | Compliance Authority |
| Settlement / Payout | Settlement / Financial Authority |
| Analytics | Analytics / Growth Authority |
| Recommendation | Recommendation Authority |
| Advertising | Advertising Authority |
| Evidence | Evidence Registry |

IP Commercial Growth 只负责 IP 商业生命周期协调、指标定义和增长触发，不替代上述 Authority。

## 3. Canonical Commercial Growth Identity

```text
ipId
ipVersion
portfolioId?
licensorId
buyerId?
skuId?
licenseId?
tradeId?
channelId?
marketId?
segmentId?
experimentId?
correlationId
```

任何增长事实必须能够回溯到对应 IP 及其版本。

## 4. Commercial Funnel

标准漏斗：

```text
DISCOVERED
→ VIEWED
→ SAVED / WATCHED
→ QUALIFIED_INTEREST
→ INTENT_CREATED
→ MATCHED
→ QUOTED
→ ADMITTED
→ TRADED
→ LICENSED
→ USED
→ RENEWED
→ EXPANDED
```

漏斗状态是分析事实，不等同于交易、授权或财务事实。

## 5. Value Dimensions

IP Value 至少从以下维度评估：

```text
Demand
Commercial Conversion
Revenue
Renewal Rate
Expansion Rate
Usage Depth
Audience / Reach
Creator / Buyer Quality
Rights Confidence
Risk / Compliance Quality
```

任何 Value Score 必须标识算法版本、时间窗口和输入快照。

## 6. Value Score Boundary

`Value Score`：

```text
≠ Rights Validity
≠ Trade Admission
≠ Guaranteed Revenue
≠ Financial Fact
```

价值评分不得授予交易权利、修改价格权威或替代 Risk Decision。

## 7. Discovery Feedback

可形成反馈：

```text
Search Impression
→ IP View
→ Interest
→ Intent
→ Match
→ Trade
```

分析结果可以用于 Recommendation / Search 优化，但不得伪造原始交易事实。

## 8. Commercial Performance

授权后的商业表现可以收集：

```text
Usage Volume
Sales / Revenue Reference
Campaign Performance
Conversion
Renewal
Expansion
Dispute Rate
Compliance Rate
Payout Reliability
```

原始事实必须引用对应 Authority；聚合指标必须保留计算版本。

## 9. Renewal Signal

以下信号可用于 Renewal Candidate：

```text
Healthy Usage
High Conversion
Positive Buyer Outcome
Low Compliance Risk
No Blocking Dispute
Expiring License
```

`Renewal Candidate` 只表示候选，不代表 Renewal Permission 或 Active License。

## 10. Expansion Signal

Expansion Candidate 可以由以下因素触发：

```text
Scope Utilization
New Territory Demand
New Channel Demand
New Media Demand
New Product Demand
Commercial Performance
Buyer Request
```

最终 Expansion 必须重新经过 Rights / Risk / Trade / Agreement / License 等既有 Authority。

## 11. Cross-Sell / Upsell

系统可以发现：

```text
Current IP
→ Other License Families
→ Other Industries
→ Other Territories
→ Other Channels
→ Related IP
```

Cross-sell / Upsell 是商业推荐，不直接产生订单或许可证。

## 12. IP Portfolio Value

Portfolio 聚合至少支持：

```text
Active IP Count
Active License Count
Revenue Reference
Renewal Rate
Expansion Rate
Demand Index
Rights Confidence
Risk Exposure
Commercial Concentration
```

Portfolio Score 不得替代单 IP Rights 或 License Authority。

## 13. Licensor Growth

可形成 Licensor Growth 指标：

```text
Listed IP
Qualified IP
Commercial Ready IP
Trade Conversion
License Volume
Renewal
Expansion
Payout Reliability
Dispute Rate
```

指标用于经营分析，不改变 Licensor 的权利与资格事实。

## 14. Buyer Growth

可形成 Buyer Growth 指标：

```text
Intent Volume
Qualified Matches
Trade Volume
License Diversity
Renewal
Expansion
Payment Reliability
Compliance Quality
```

Buyer Growth Score 不得替代 Buyer Eligibility Authority。

## 15. Marketplace Liquidity

IP marketplace 可计算：

```text
Supply
Demand
Qualified Intent
Match Rate
Quote Rate
Admission Rate
Trade Conversion
Renewal Rate
Expansion Rate
```

Liquidity Metrics 必须注明统计窗口和数据完整性。

## 16. IP Value Reassessment

价值重新评估触发：

```text
Demand Shift
Commercial Performance Change
Rights Change
Risk Change
Audience Change
Market Change
Renewal / Expansion Outcome
```

Rights / Risk 变化不能仅通过 Value Score 被隐藏。

## 17. Value Decay

IP Value 可以随着时间窗口变化而下降或变化，但：

```text
Value Decay
≠ Rights Expiry
≠ License Expiry
```

权利失效仍必须由 Rights / License Authority 正式确认。

## 18. Growth Event Semantics

关键增长事件至少包含：

```text
eventId
ipId
ipVersion
eventType
sourceReference
metricWindow
occurredAt
correlationId
```

示例：

```text
IP_VIEWED
IP_SAVED
IP_INTENT_CREATED
IP_MATCHED
IP_TRADED
IP_LICENSED
IP_USAGE_REPORTED
IP_RENEWAL_CANDIDATE
IP_EXPANSION_CANDIDATE
IP_VALUE_REASSESSED
```

## 19. Attribution

商业增长指标需要明确 Attribution：

```text
source
channel
campaign
experiment
referrer
modelVersion
window
```

Attribution 不得修改 Commerce / Settlement / Ledger 原始事实。

## 20. Experimentation

允许 Growth Authority 对：

```text
Ranking
Exposure
Pricing Presentation
Discovery UI
Recommendation
Campaign
```

进行实验，但 Experiment 必须可识别，且不得绕过 Rights / Risk / Admission。

## 21. Fraud / Quality Protection

增长数据必须支持：

```text
Bot Filtering
Duplicate Event Filtering
Abuse Detection
Anomalous Conversion Detection
Data Quality Flags
```

低质量事件不得直接成为高价值商业信号。

## 22. Metrics Integrity

所有核心指标必须说明：

```text
Definition
Source
Window
Version
Completeness
Freshness
Confidence
```

不能用不同定义的同名指标跨系统直接比较。

## 23. Historical Snapshot

历史经营指标至少保留：

```text
metricVersion
calculationVersion
inputWindow
sourceRefs
computedAt
```

新算法不得静默重写历史经营结论。

## 24. Evidence Chain

商业增长证据链：

```text
Raw Commercial Event
↓
Validated Event
↓
Attribution
↓
Aggregate Metric
↓
Value Assessment
↓
Renewal / Expansion Signal
↓
Commercial Action
↓
Trade / License Outcome
```

商业信号必须能够追溯原始数据来源。

## 25. Machine Invariants

### I1
`Value Score ≠ Rights Authority`。

### I2
`Renewal Candidate ≠ Renewal Permission`。

### I3
`Expansion Candidate ≠ Active License`。

### I4
商业推荐不得直接生成 Order、Agreement 或 License。

### I5
Value Score 必须标识计算版本和输入窗口。

### I6
历史指标不能因新算法静默改变其历史版本。

### I7
低质量 / 欺诈事件不得直接成为有效增长信号。

### I8
Rights / Risk 状态变化必须能够传播到 Value Reassessment。

### I9
Commercial Growth 不得伪造 Commerce / Settlement / Ledger Fact。

### I10
Attribution 不得改写原始交易事实。

### I11
Cross-sell / Upsell 信号不自动产生经济事实。

### I12
所有核心 Growth Metrics 必须可追溯 Source Reference。

### I13
Value Decay 不得等同 Rights / License Expiry。

### I14
Experiment 不得绕过正式 Authority。

### I15
增长闭环最终必须回流至可验证的 Trade / License Outcome。

## 26. L5 Execution Units

```text
L5-IP-223-DISCOVERY-SIGNAL
L5-IP-223-QUALIFIED-INTEREST
L5-IP-223-INTENT-SIGNAL
L5-IP-223-MATCH-SIGNAL
L5-IP-223-TRADE-OUTCOME
L5-IP-223-USAGE-PERFORMANCE
L5-IP-223-VALUE-SCORE
L5-IP-223-RENEWAL-SIGNAL
L5-IP-223-EXPANSION-SIGNAL
L5-IP-223-CROSS-SELL-SIGNAL
L5-IP-223-UPSELL-SIGNAL
L5-IP-223-PORTFOLIO-VALUE
L5-IP-223-LICENSOR-GROWTH
L5-IP-223-BUYER-GROWTH
L5-IP-223-MARKETPLACE-LIQUIDITY
L5-IP-223-VALUE-REASSESSMENT
L5-IP-223-VALUE-DECAY
L5-IP-223-ATTRIBUTION
L5-IP-223-EXPERIMENT
L5-IP-223-DATA-QUALITY
L5-IP-223-METRIC-INTEGRITY
L5-IP-223-EVIDENCE
L5-IP-223-AUDIT
```

## 27. L6 Acceptance Atoms

### L6-IP-223-001
Every commercial growth signal references a stable ipId and version.

### L6-IP-223-002
Funnel states do not imply transaction or license authority.

### L6-IP-223-003
Value score includes calculation version and measurement window.

### L6-IP-223-004
Renewal candidates do not activate renewal.

### L6-IP-223-005
Expansion candidates require formal downstream validation before execution.

### L6-IP-223-006
Commercial performance metrics reference source facts.

### L6-IP-223-007
Portfolio metrics can be reconstructed from versioned inputs.

### L6-IP-223-008
Attribution metadata is preserved independently from financial truth.

### L6-IP-223-009
Low-quality events can be excluded or quality-flagged.

### L6-IP-223-010
Rights changes trigger required value reassessment.

### L6-IP-223-011
Risk changes can affect commercial signals without rewriting history.

### L6-IP-223-012
Historical metric versions remain reconstructable.

### L6-IP-223-013
Experiments are independently identifiable.

### L6-IP-223-014
Growth recommendations cannot directly create license facts.

### L6-IP-223-015
Cross-sell and upsell signals remain non-authoritative.

### L6-IP-223-016
Marketplace liquidity metrics declare the measurement window.

### L6-IP-223-017
Value decay is distinct from rights/license expiry.

### L6-IP-223-018
Commercial growth events carry correlation identity.

### L6-IP-223-019
Growth metrics include freshness and confidence metadata.

### L6-IP-223-020
Commercial growth can trace a signal back to eventual trade/license outcome where applicable.

## 28. Non-Goals

本合同不负责：

```text
Recommendation Engine Implementation
Advertising Delivery
Rights Determination
Order Processing
Payment Network
Ledger Implementation
```

## 29. Implementation Gate

在以下条件全部满足前，不允许实现代码：

```text
L4 Contract = COMPLETE
L5 Units = REGISTERED
L6 Units = REGISTERED
Authority Boundary = COMPLETE
Evidence Mapping = COMPLETE
Cross-Contract Traceability = COMPLETE
Machine Invariants = COMPLETE
```

当前：

```text
IMPLEMENTATION = PENDING
CL = NOT RUN
CI = NOT RUN
```
