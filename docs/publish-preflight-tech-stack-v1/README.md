# LuckRead Publish Preflight 技术栈组合方案 v1

**目录**：`docs/publish-preflight-tech-stack-v1/`  
**文档**：`README.md`  
**日期**：2026-09-30  
**基线 main**：`6705107703b9e6dc4ebfac59b321afa79645c051`  
**关联功能**：Publish Preflight v1 / PR #317

---

## 1. 目标

为 LuckRead 建立一套可持续演进的内容发布前风险检测技术栈，重点覆盖：

- 全球手机号/电话候选识别
- 即时通讯账号、用户名、群组/邀请链接
- 社交平台账号与站外导流
- Unicode 混淆、零宽字符和字符拆分绕过
- 外部 URL / 短链 / 域名解析
- 图片 OCR
- 图片二维码解码
- 视频关键帧 OCR / QR
- AI 内容安全与风险增强
- 高风险内容的后台增强调查

核心原则：

> **开源库负责识别，W03 负责规则，外部服务负责增强，LuckRead Risk Fusion 负责最终判定。**

不允许任何单一第三方服务成为 LuckRead 的唯一安全权威。

---

## 2. 固定架构约束

本方案必须遵守现有 LuckRead 架构：

- Worker 固定为 12 个，不新增 Worker。
- D1 固定为 4 个，不为了 Preflight 新增数据库。
- W03 继续承担 Content / Article / Media / Translation。
- D1-02 继续是内容权威。
- Publish Preflight 本身优先保持无状态、低延迟、零 D1 读写。
- W01 负责公开 API、认证边界和 Creator Center UI。
- W03 负责 Preflight 规则和最终预检结论。
- 外部 AI、OCR、号码情报、URL 情报均通过 Provider Adapter 接入。
- 不允许用 Preflight 绕过现有 DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED 生命周期。

---

## 3. 推荐总体架构

```text
                 Creator Center / W01
                         |
                  Publish Preflight
                         |
                         v
                   W03 Risk Engine
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
   Phone Engine      Contact Engine      URL Engine
       |                 |                  |
 libphonenumber-js   Platform Registry     tldts
       |                 |                  |
       +-----------------+------------------+
                         |
                  Unicode Normalize
                         |
              unicode-confusables
                         |
                         v
                  Media Inspection
                  /             \
               OCR               QR
          Tesseract.js          ZXing
                         |
                         v
                  External Signals
              /        |         \
          AI Safety   URL Intel   Phone Intel
                         |
                         v
                    Risk Fusion
                         |
              +----------+----------+
              |          |          |
             PASS      YELLOW       RED
```

---

## 4. 第一优先级：直接采用

### 4.1 全球手机号

**技术：libphonenumber-js**

GitHub：  
https://github.com/catamphetamine/libphonenumber-js

用途：

- 国际号码解析
- 国家/地区识别
- 手机/固定电话类型候选识别
- 标准化格式
- 从正文中提取号码
- 降低 W03 自维护几十个国家正则的维护成本

LuckRead 规则：

```text
libphonenumber-js
      +
LuckRead Contact Policy
      +
Promotion / Lead-generation Context
```

注意：

- “号码格式合法”不等于“号码真实存在”。
- “号段属于某运营商”不等于“当前用户仍属于该运营商”。
- 携号转网、VoIP 等情况必须交给后续外部号码情报层。
- 发布同步链路默认只做候选识别，不做高成本实时查询。

---

### 4.2 Unicode 反混淆

**技术：unicode-confusables**

GitHub：  
https://github.com/ensdomains/unicode-confusables

用途：

- 零宽字符处理
- Unicode 同形字符
- 视觉相似字符
- 恶意拆分联系方式
- 绕过关键词匹配

典型绕过：

```text
wechat
wｅchat
wｅｃｈａｔ
w​e​c​h​a​t
wеchat
```

先做规范化，再交给 Platform Registry / Contact Detector。

---

### 4.3 域名解析

**技术：tldts**

GitHub：  
https://github.com/remusao/tldts

用途：

- 提取真实 hostname
- domain / subdomain 分离
- Public Suffix 解析
- Unicode / IDNA 域名处理
- 将复杂 URL 归一化为可审计的域名对象

建议将 URL 检测统一转换成：

```text
raw URL
  ↓
normalize
  ↓
hostname
  ↓
registrable domain
  ↓
redirect / reputation
  ↓
risk
```

---

## 5. 即时通讯 / 社交账号检测

不要建立一个固定的“黑名单字符串表”，而是建立 LuckRead 自己的 **Platform Registry**。

建议结构：

```ts
type ContactPlatform = {
  id: string
  name: string
  category: 'messenger' | 'social' | 'community' | 'enterprise'
  domains: string[]
  patterns: RegExp[]
}
```

### 第一批

**全球**

- WhatsApp
- Telegram
- Facebook Messenger
- Instagram
- Snapchat
- Discord
- Signal
- Viber
- Kik

**东亚**

- WeChat
- QQ
- LINE
- KakaoTalk
- Zalo

**企业通信**

- Microsoft Teams
- Slack
- Google Chat

**中国企业通信**

- 企业微信
- 钉钉
- 飞书 / Lark

**隐私/开放生态**

- Threema
- Session
- SimpleX
- Matrix / Element
- XMPP

当前 Publish Preflight v1 已覆盖的第一批平台：

- WhatsApp
- Telegram
- Facebook Messenger
- WeChat
- LINE
- QQ
- Signal
- Viber
- KakaoTalk
- Discord

新增平台应优先进入 Platform Registry，不应把平台规则散落在业务代码中。

---

## 6. 第二优先级：图片检测

### 6.1 QR

**技术：ZXing**

GitHub：  
https://github.com/zxing-js/browser

用途：

- 二维码识别
- 联系方式二维码
- IM 邀请二维码
- URL 二维码
- 其他条码

流程：

```text
image
  ↓
QR decode
  ↓
decoded payload
  ↓
URL / phone / IM detector
  ↓
Risk Fusion
```

---

### 6.2 OCR

**技术：Tesseract.js**

GitHub：  
https://github.com/naptha/tesseract.js

用途：

- 中文 OCR
- 英文 OCR
- 图片中的手机号
- 图片中的 IM ID
- 图片中的“扫码/加好友/联系客服”等文字
- 图片广告文字

原则：

**OCR 不进入普通纯文本发布的默认同步路径。**

只有：

- 有图片
- 有疑似联系方式
- 内容属于高风险
- 图片文本安全检查需要

才调用。

这样控制 Worker CPU 和响应时间。

---

## 7. 第三优先级：外部 URL / 威胁情报

### Google Safe Browsing

GitHub：  
https://github.com/google/safebrowsing

用途：

- 恶意 URL 风险增强
- 已知危险 URL 情报

### Cloudflare URL Scanner

文档：

https://developers.cloudflare.com/radar/investigate/url-scanner/

用途：

- 可疑 URL 扫描
- 重定向链
- 页面内容
- DOM
- 截图/HAR 等安全分析能力

推荐：

```text
明显正常 URL
   ↓
不调用外部服务

可疑 URL
   ↓
Cloudflare / Safe Browsing

高风险 URL
   ↓
BLOCK / REVIEW
```

---

## 8. 第四优先级：手机号外部情报

当 W03 第一层发现手机号后，不要默认对所有文章做实时号码查询。

候选 Provider：

### Twilio Lookup

https://www.twilio.com/docs/lookup/v2-api

可用于号码格式、类型、carrier 等增强信号。

### IPQualityScore

https://www.ipqualityscore.com/documentation/phone-number-validation-api/overview

可用于号码风险、line type、carrier 等增强信号。

统一抽象：

```ts
interface PhoneIntelligenceProvider {
  lookup(phone: string): Promise<{
    valid?: boolean
    lineType?: string
    carrier?: string
    risk?: number
  }>
}
```

Provider 返回的是**信号**，不是 LuckRead 最终判决。

---

## 9. 第五优先级：AI 内容安全

AI 审核服务建议通过统一 Adapter 接入：

```text
W03
 |
 +-- Cloudflare Workers AI / Guard Model
 |
 +-- OpenAI Moderation
 |
 +-- Azure AI Content Safety
 |
 +-- AWS Bedrock Guardrails
 |
 +-- 其他合规 Provider
```

推荐原则：

- 单一 Provider 不作为唯一决策源。
- AI 只提供风险信号。
- 不用 AI 单独判断“这个人是不是 AI 写的”。
- AI-generated probability 只能作为质量风险信号。
- 最终决策由 LuckRead Policy + Risk Fusion 完成。

---

## 10. 社交账号高级调查

**技术：Sherlock**

GitHub：  
https://github.com/sherlock-project/sherlock

它可以帮助跨多个社交网站调查用户名存在性。

但它**禁止进入普通发布同步链路**。

正确用途：

```text
普通文章
  ↓
本地快速检测
  ↓
PASS / YELLOW / RED

高风险账号
  ↓
后台增强调查
  ↓
Sherlock 类 OSINT
  ↓
Risk Evidence
```

原因：

- 网络请求多
- 速度不可控
- 服务站点可能限制探测
- 隐私和合规要求更高
- 不适合作为每篇文章的实时依赖

---

## 11. 统一检测 Pipeline

### 文本

```text
Raw Content
   ↓
Unicode Normalize
   ↓
Phone Extraction
   ↓
IM / Social Extraction
   ↓
URL Extraction
   ↓
Promotion Intent
   ↓
AI Safety (optional)
   ↓
Risk Fusion
```

### 图片

```text
Image
   ↓
QR Decode
   ↓
OCR
   ↓
Phone / IM / URL Extraction
   ↓
Image Safety AI
   ↓
Risk Fusion
```

### 视频

```text
Video
   ↓
Key Frames
   ↓
OCR / QR
   ↓
ASR
   ↓
Phone / IM / URL Extraction
   ↓
AI Safety
   ↓
Risk Fusion
```

---

## 12. 风险融合规则

不要简单采用：

```text
AI PASS = publish
```

应该：

```text
Local Rule
+
Phone Signal
+
IM Signal
+
URL Signal
+
OCR / QR
+
AI Safety
+
Content Quality
+
Creator Contribution
+
Account Risk
        ↓
LuckRead Risk Fusion
```

最终：

### PASS

未发现阻断风险。

### YELLOW

存在可修改质量/可信度/导流提示，但没有明确阻断项。

### RED

明确违反 LuckRead 发布政策、安全策略或高置信度导流/恶意内容风险。

---

## 13. 降低误报的规则

### 不应该直接 BLOCK

- 单独出现“微信”“Telegram”“LINE”等平台名称。
- 文章引用新闻来源中的公开联系方式。
- 文章讨论电话号码格式。
- 软件评测中出现通信软件名称。
- 教程文章中解释二维码原理。
- 代码/日志中出现数字。

### 可以提高风险等级

```text
手机号
+
加我 / 联系我

IM ID
+
购买 / 咨询 / 私聊

外链
+
优惠 / 下单 / 加群

二维码
+
扫码 / 加好友 / 购买
```

### 明确的组合风险

```text
Phone + Lead Generation
IM ID + Lead Generation
QR + Contact
URL + Lead Generation
多个 Contact Channel 同时出现
```

---

## 14. 绕过攻击处理

必须统一做：

- NFKC Unicode normalization
- 零宽字符删除
- 同形字符映射
- 全角/半角归一化
- 空格拆分恢复
- 标点拆分恢复
- 中英文混写归一
- URL 编码解码
- HTML entity 解码
- 联系方式语义上下文分析

典型：

```text
1 3 8 1 2 3 4 5 6 7 8
+ 8 6 1 3 8 1 2 3 4 5 6 7 8
w x i d _ x x x
T e l e g r a m : @user
wa . me / ...
```

都应进入规范化 Pipeline。

---

## 15. 第一阶段落地组合

为了控制复杂度，第一阶段只做：

```text
libphonenumber-js
+
unicode-confusables
+
tldts
+
LuckRead Platform Registry
+
现有 W03 Preflight Rules
```

继续保留当前 v1 已有的：

- 中国/国际手机号候选检测
- 10 类主流 IM 检测
- 网址检测
- 广告/导流组合判断
- QR 文本/媒体引用提示
- Unicode/隐藏字符安全检测

这阶段不增加新的 Worker、D1 或外部实时调用。

---

## 16. 第二阶段落地组合

```text
ZXing
+
Tesseract.js
+
Image Safety Provider
```

目标：

- 图片二维码
- 图片手机号
- 图片 IM ID
- 图片广告
- 图片联系方式

---

## 17. 第三阶段落地组合

```text
Cloudflare AI / AI Gateway
+
OpenAI Moderation
+
Azure AI Content Safety
+
AWS Bedrock Guardrails
```

目标：

- 内容安全
- AI 风险信号
- 多 Provider fallback
- 内容质量增强判断

---

## 18. 第四阶段高级风控

```text
Phone Intelligence
+
URL Intelligence
+
Cloudflare URL Scanner
+
Safe Browsing
+
Sherlock 类 OSINT
```

只用于：

- 高风险文章
- 高风险账号
- 用户举报
- 突发异常流量
- 反复违规作者
- 外链风险
- 后台复核

---

## 19. 成本控制

普通文章：

```text
Local Rules
      ↓
完成
```

只有发现风险才：

```text
Local Rules
      ↓
External Provider
```

图片：

```text
先判断是否需要 OCR/QR
      ↓
需要才处理
```

视频：

```text
先抽关键帧
      ↓
不要对每一帧做完整 AI 分析
```

总体原则：

> **Fast Path 默认本地，Slow Path 只给风险内容。**

---

## 20. 开源许可证和供应链要求

所有引入的 GitHub 项目必须在正式进入生产依赖前检查：

- LICENSE
- 当前维护状态
- 最近 release / commit
- transitive dependencies
- npm package provenance
- 是否依赖 Node-only API
- 是否适配 Cloudflare Workers / WebAssembly
- 是否存在 GPL/AGPL 等与 LuckRead 分发方式冲突的许可证要求
- 是否存在已知安全漏洞

禁止因为 GitHub 上“有代码”就直接复制进入生产。

---

## 21. Cloudflare Worker 适配原则

W03 是 Cloudflare Worker，因此：

优先：

- 纯 JS/TS
- Web API
- WebAssembly
- 轻量 npm
- 可 tree-shake
- 无本地文件系统要求

慎用：

- 大型 Node.js CLI
- 需要进程/子进程的工具
- 本地数据库
- 大量网络探测
- 重 CPU OCR
- 仅 Node.js 环境可运行的库

Sherlock 等工具应放在后台增强调查体系，而不是 W03 发布同步请求。

---

## 22. 最终技术组合

### Core Fast Path

```text
libphonenumber-js
unicode-confusables
tldts
Platform Registry
LuckRead Rules
```

### Media Path

```text
ZXing
Tesseract.js
Image AI
```

### Intelligence Path

```text
Cloudflare URL Scanner
Google Safe Browsing
Twilio Lookup
IPQualityScore
```

### AI Safety Path

```text
Cloudflare Workers AI
OpenAI Moderation
Azure AI Content Safety
AWS Bedrock Guardrails
```

### Advanced Investigation Path

```text
Sherlock / OSINT tools
```

---

## 23. LuckRead 最终原则

```text
            OPEN SOURCE
                 |
          负责识别和标准化
                 |
                 v
            W03 POLICY
                 |
           负责规则判断
                 |
                 v
        EXTERNAL PROVIDERS
                 |
            提供增强信号
                 |
                 v
          RISK FUSION
                 |
          LuckRead 最终决定
                 |
       +---------+---------+
       |         |         |
      PASS     YELLOW      RED
```

不要让任何一个开源库、AI 模型、号码 API、URL 服务直接成为发布权威。

**最终权威仍然是 LuckRead W03 + Content Contract + 现有内容生命周期。**
