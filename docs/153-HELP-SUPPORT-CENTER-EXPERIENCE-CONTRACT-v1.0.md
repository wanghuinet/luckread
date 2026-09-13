# LuckRead Help / Support Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**父域：72 User Center + 63 Moderation / Appeals + 71 Platform Operations + 56 Notification / IM**

## 1. 定位

Help / Support Center 是用户、Creator、MCN、Merchant、Advertiser 与开发者解决问题、查询服务状态、提交工单、进行申诉和完成自助恢复的统一服务中心。

本中心负责问题发现、解释、分流、上下文聚合、服务请求与进度跟踪，不创建第二 User、Moderation、Risk、Operations、Order、Wallet 或 Messaging 权威。

## 2. Benchmark / Superiority

借鉴大型互联网平台 Help Center、Support、申诉与自助诊断体验，目标不是提供静态 FAQ，而是实现：

`发现问题 → 判断影响 → 找到答案 → 自动诊断 → 执行修复 → 必要时转人工 → 持续跟踪 → 关闭并反馈`。

用户不应被迫重复描述已经存在于平台上下文中的问题。

## 3. Information Architecture

```text
Help / Support Center
├── Help Home
├── Search / Knowledge
├── Guided Troubleshooting
├── Service Status
├── My Cases / Tickets
├── Account & Security Help
├── Creator / Content Help
├── Commerce / Orders Help
├── Earnings / Payout Help
├── Community / Messaging Help
├── Copyright / Rights Help
├── Policy / Moderation Appeals
├── Developer / API Help
├── Contact Support
├── Feedback / Suggestions
└── Accessibility / Localization
```

## 4. Core Journeys

### 4.1 Self-service
`Problem → Search / Guided Diagnosis → Relevant Answer → Action → Verify`

### 4.2 Support case
`Problem → Context Capture → Classification → Case Creation → Progress → Resolution → Confirmation`

### 4.3 Appeal
`Decision → Appeal Entry → Existing Context / Evidence → Submit → Review → Decision → Notify`

### 4.4 Incident
`Service Status → Impact Scope → Workaround / ETA where available → Recovery → Verification`

## 5. Experience Requirements

- 搜索必须优先返回与用户当前业务上下文相关的答案；
- FAQ、故障排查、工单和申诉必须明确区分；
- 创建工单时自动带入合法的业务上下文，避免用户重复填写；
- 每个工单必须显示状态、下一步、预计处理阶段及最近更新时间；
- 服务异常必须优先显示已知影响和可用替代方案；
- 申诉必须保留原决策、证据引用和案件上下文；
- 自动化诊断不得伪造确定结论，无法判断时应安全转人工；
- 支持 Web / Android / iOS 跨设备继续未完成的支持流程。

## 6. Authority Boundary

```text
User / Account → 72 / User Domain
Moderation / Appeals → 63
Risk / Trust → 62
Operations / Incident / Status → 71
Notification / IM → 56
Orders / Fulfillment → 65 / 124
Wallet / Finance → 68
Rights → 64
Developer / API → 70
```

Support Center 只聚合这些域提供的稳定状态与操作入口，不复制其权威记录。

## 7. API / Event Surface

代表性读取：knowledge search、service status、case summary、case detail、appeal status、diagnostic result、support eligibility。

代表性命令：create case、add evidence、reply case、close/reopen case、start guided diagnosis、submit appeal、request escalation。

所有状态变更应使用 requestId、correlationId、idempotencyKey、稳定错误模型和权限检查。

## 8. Context Continuity

工单与申诉应在授权范围内关联：

```text
userId
caseId
contentId / orderId / transactionId where applicable
sourceEventId where applicable
previousCaseId
```

支持人员看到的上下文必须经过 scope 授权与敏感字段脱敏。

## 9. Privacy / Security

不得泄露内部风险评分、检测规则、敏感证据、其他用户信息、支付秘密或内部安全策略。

客服人员必须按最小权限访问案件；支持系统不得成为跨域数据查询旁路。

## 10. Reliability / Recovery

必须处理：

```text
重复建单
网络中断
案例状态竞争
附件上传失败
通知延迟
下游系统超时
申诉重复提交
人工接管
服务恢复前后状态变化
```

用户刷新、切换设备或网络重连后必须能够恢复到最近可信状态。

## 11. Cost / Performance

- 知识检索采用索引、缓存和分层召回；
- 不为每次 Help 页面打开同步请求全部业务域；
- 工单附件使用对象存储/受控上传链路；
- 批量通知和状态更新采用异步任务；
- 高峰期支持请求必须与业务核心写路径隔离。

## 12. Quality / Feedback

支持中心应采集：

```text
answer helpfulness
resolution success
self-service completion
first-response latency
resolution latency
reopen rate
appeal outcome
handoff rate
```

指标用于改进支持体验，不得直接改变业务权威状态。

## 13. Acceptance / Superiority Gate

验证：问题找到答案的时间、自助解决率、工单填写步数、上下文复用率、人工转接率、首次响应时间、最终解决时间、申诉流程完整性、跨设备连续性、隐私隔离与恢复成功率，并通过 139 Global Product & Experience Superiority Gate。

**STOP：** FAQ 与真实状态脱节、重复收集已有上下文、客服越权、内部风险信息泄漏、申诉丢失原上下文、无法自助恢复、Support 成为第二业务权威、低于行业基线。
