# LuckRead Localization / Region / Time / Currency Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一多语言、地域、时区、日期时间、数字和货币展示与业务语义，避免不同 Domain 对同一时间/地区/金额产生冲突解释。

## 2. Locale

每个用户/请求可具有：

```text
requestedLocale
resolvedLocale
fallbackLocale
```

解析顺序必须稳定、可审计。

## 3. Locale Fallback

```text
user preference
→ client locale
→ region default
→ platform default
```

缺失翻译不得改变业务 code、state 或 resource ID。

## 4. Region

Region 必须区分：

```text
UI locale
content availability
legal region
commercial region
service region
```

不能使用 UI 语言直接推断法律或商业区域。

## 5. Time

所有持久化事件/业务时间统一使用可比较的标准时间表示；用户展示时按用户/上下文 timezone 转换。

至少区分：

```text
occurredAt
createdAt
updatedAt
effectiveAt
expiresAt
```

## 6. Day / Period Boundary

会员、订阅、报表、广告、结算等涉及周期的 Domain 必须明确：

```text
timezone
period start
period end
DST behavior
```

禁止不同服务自行解释周期边界。

## 7. Currency

货币必须由 ISO-like stable code 表示；金额内部使用明确的最小货币单位或等价精确模型。

展示格式不得改变 authoritative financial value。

```text
Ledger amount = authoritative
Display amount = localized projection
```

## 8. Exchange Rate

如发生跨币种展示，汇率必须带：

```text
rate
source
version / timestamp
```

展示换算不得覆盖原始结算金额。

## 9. Content Availability

内容区域可用状态应独立于 locale：

```text
AVAILABLE
REGION_RESTRICTED
LEGAL_RESTRICTED
POLICY_RESTRICTED
UNAVAILABLE
```

用户必须得到安全、可理解的原因类别。

## 10. API / Event

API 返回应使用机器稳定 code，同时提供 locale-aware presentation fields where applicable。

事件时间不得使用本地化文本作为唯一时间事实。

## 11. Search / Taxonomy

Topic、Hashtag、Entity 等可以存在多语言 display names，但 canonical identity 不得因语言变化而复制。

## 12. Privacy

地域、语言、timezone 可能属于个人偏好数据，应遵循最小化、访问控制和 retention policy。

## 13. UX

关键界面必须正确处理：

```text
long text
RTL where supported
pluralization
number formatting
date/time formatting
currency formatting
region restrictions
translation missing
```

## 14. Performance / Cost

locale resolution 应在边缘/缓存层低成本完成；不得因为本地化导致无界同步服务调用。

## 15. Observability

日志与 telemetry 必须保留稳定 machine fields，不以翻译后的 message 作为聚合 key。

## 16. Acceptance

验证 locale fallback、region restriction、timezone conversion、DST、period boundary、currency display、exchange-rate version、translated topic identity、missing translation、安全原因展示。

## 17. STOP Conditions

- locale 改变 resource identity；
- UI locale 被当法律 region；
- 本地时间被当唯一业务时间；
- currency display 修改 ledger value；
- 周期边界无 timezone 定义；
- 多语言创建重复 canonical entity。

## 18. READY Gate

```text
Locale
→ Region
→ Time
→ Period Boundary
→ Currency
→ Availability
→ API/Event
→ Privacy
→ UX
→ Acceptance Evidence
→ READY
```

## 19. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
