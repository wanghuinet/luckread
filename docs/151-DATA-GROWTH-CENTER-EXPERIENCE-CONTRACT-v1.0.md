# LuckRead Data / Growth Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**父域：69 Analytics / Experiment / Growth + 55 Feed / Recommendation + 76 Creator + 71 Platform Operations**

## 1. 定位

Data / Growth Center 是用户、Creator、MCN、Merchant、Advertiser 与平台运营角色理解业务表现、发现问题、执行增长动作和验证结果的统一数据工作台。

本中心是数据消费、分析与行动编排层，不创建第二 Analytics、Recommendation、Risk、Revenue 或业务事实权威。

## 2. Benchmark / Superiority

借鉴 YouTube Analytics、TikTok/抖音创作者数据工作台、小红书/微博/快手经营分析等成熟模式，目标不是堆叠图表，而是形成：

`数据 → 解释 → 问题 → 建议 → 行动 → 实验 → 结果`。

所有核心指标必须可定义、可追溯、可解释，禁止用无法复现的黑盒数字作为唯一决策依据。

## 3. Information Architecture

```text
Data / Growth Center
├── Overview
├── Content Analytics
├── Audience / Fans
├── Traffic / Reach
├── Engagement
├── Retention / Cohorts
├── Revenue / Commerce Metrics
├── Creator / MCN Growth
├── IP Performance
├── Funnel / Conversion
├── Experimentation
├── Trends / Benchmarks
├── Recommendations / Next Actions
├── Reports / Export
└── Definitions / Data Quality
```

## 4. Core Journeys

### 4.1 Diagnose
`Metric → Segment → Time Range → Compare → Explain → Root Cause Candidate`

### 4.2 Grow
`Opportunity → Recommendation → Action → Measurement → Result`

### 4.3 Experiment
`Hypothesis → Experiment → Assignment → Metric → Result → Decision`

### 4.4 Data issue
`Metric anomaly → Data quality check → Source trace → Correction/Notice → Recompute`

## 5. Experience Requirements

- 首页必须优先展示需要行动的异常、机会与关键指标，而不是静态报表；
- 每个指标必须显示定义、时间范围、口径与数据新鲜度；
- 支持按内容、作者、IP、来源、受众、地区及设备等合法维度分析；
- 趋势异常必须提供可能原因和可验证的下一步，而不是伪造确定结论；
- 推荐建议必须可解释、可忽略、可反馈；
- 实验必须显示样本、状态、指标与置信边界/限制条件；
- 报表生成不得阻塞实时业务操作；
- Web / Android / iOS 数据视图应保持口径一致。

## 6. Authority Boundary

```text
Analytics / Derived Metrics → 69
Feed / Recommendation Decision → 55
Creator State → 76
Content / IP → corresponding domains
Revenue / Financial Fact → 68
Advertising Fact → 66
Commerce Fact → 65 / 124
Risk / Trust → 62
Operational Runtime → 71
```

中心不得把派生指标重新写回业务事实，也不得通过 Analytics 绕过 Risk、Rights 或金融校验。

## 7. API / Event Surface

中心调用稳定 analytics、experiment、growth 与 domain-summary API，不直接扫描 D1 表或 Payload internals。

典型能力：metric summary、timeseries、cohort、funnel、content performance、audience summary、experiment status、growth recommendation、report export。

高频原始行为进入异步采集、聚合和质量处理链；中心消费经过治理后的指标。

## 8. Data Quality / Trust

每个关键指标应关联：

```text
metricId
metricVersion
definition
sourceDomains
aggregationWindow
freshness
qualityStatus
```

数据缺失、延迟、重算时必须显式标示，不得把估算值伪装成实时事实。

## 9. Privacy / Security

受限用户数据、未成年人敏感数据、私域社区数据、内部风险信号与财务受限数据必须最小权限访问。聚合结果不得成为绕过底层权限的旁路。

## 10. Reliability / Cost

- Dashboard 不得同步 fan-out 到所有业务域；
- 热门指标使用可失效的派生缓存；
- 大规模报表采用异步任务与导出；
- 指标计算支持重算与版本化；
- Analytics 故障不得阻塞发布、支付、订单、安全等核心路径；
- 高频事件优先批量聚合，控制 D1 写放大与成本。

## 11. Acceptance / Superiority Gate

验证：关键指标理解时间、异常发现时间、分析完成步数、建议采纳率、实验可解释性、数据口径一致性、数据质量透明度、报告生成成功率、权限隔离和跨设备连续性，并通过 139 Global Product & Experience Superiority Gate。

**STOP：** 图表无口径、指标不可追溯、伪实时、Analytics 改写业务事实、敏感数据越权、推荐建议不可解释、Analytics 阻塞核心交易、低于行业基线。
