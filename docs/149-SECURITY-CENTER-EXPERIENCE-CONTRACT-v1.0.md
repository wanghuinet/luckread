# LuckRead Security Center Experience Contract v1.0

**状态：PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**
**父域：08 Identity & API Foundation + 62 Risk / Trust + 72 User Center**

## 1. 定位

Security Center 是用户、Creator、组织和平台授权角色管理账号安全、设备、会话、认证、恢复、风险提示、隐私安全与安全事件的统一体验中心。

安全事实与风险决策仍由对应 Domain 持有。本中心不得创建第二 Identity 或 Risk Authority。

## 2. Benchmark / Superiority

借鉴主流社交、自媒体与互联网平台的账号安全、设备管理、登录保护、异常提醒与恢复流程，目标是让用户始终知道：发生了什么、是否需要行动、为什么需要行动、怎样安全恢复。

## 3. Information Architecture

```text
Security Center
├── Security Overview
├── Account Protection
├── Sessions / Devices
├── Login History
├── Security Alerts
├── Password / Authentication
├── MFA / Step-up Verification
├── Recovery
├── Connected Accounts / API Access
├── Privacy & Security Controls
├── Risk / Restriction Status Entry
├── Security Reports / Appeals
└── Audit / Export
```

## 4. Core Journeys

### 4.1 Suspicious login
`Detection → Alert → Verify → Protect → Revoke/Continue → Audit`

### 4.2 Account recovery
`Request → Identity Proof → Risk Evaluation → Recovery → Session Rotation → Confirmation`

### 4.3 Session control
`View Session → Inspect Scope → Revoke → Confirmation → Propagation`

## 5. Experience Requirements

- 首页必须给出整体安全状态和最重要的下一步；
- 每项安全告警必须区分事实、风险提示和建议动作；
- 高风险操作必须采用 step-up verification；
- 用户可以撤销单一设备/会话，而不是只能“全部退出”；
- 恢复流程必须保存上下文并支持安全重试；
- 不能通过错误提示泄漏账户是否存在等敏感信息；
- 安全状态在 Web / Android / iOS 间保持一致；
- 风险限制必须提供合法的帮助/申诉入口。

## 6. Authority Boundary

```text
Identity / Account → 08 / User Domain
Session → Identity / Auth
Risk Decision → 62
Moderation / Restriction → 63 where applicable
User Preference → 72
Notification Delivery → 56
Financial Security → 68 where applicable
```

## 7. API / Event Surface

典型读取：security summary、sessions、login history、security alerts、recovery status。

典型命令：revoke session、revoke all other sessions、change authentication method、start recovery、confirm recovery。

所有敏感 mutation 必须具备 requestId、correlationId、idempotency、step-up policy 与审计。

## 8. Privacy / Security

不得展示密码、token、恢复秘密、内部风险分数、检测规则或不必要的设备网络细节。安全页面本身必须防止缓存越权与共享设备信息泄漏。

## 9. Reliability

必须处理重复恢复请求、重复会话撤销、并发密码修改、通知延迟、网络中断、风险状态变化、会话失效与跨设备竞争。

安全权威状态不能依赖客户端持久化。

## 10. Acceptance / Superiority Gate

验证：异常登录识别与处理效率、会话撤销生效时间、恢复成功率、敏感操作误操作率、账户枚举防护、跨设备一致性、风险解释可理解性及恢复能力，并通过 139 Superiority Gate。

**STOP：** 客户端决定安全状态、暴露风险规则、恢复可绕过身份验证、撤销仅依赖本地客户端、敏感信息泄漏、无审计、无恢复路径、低于行业基线。
