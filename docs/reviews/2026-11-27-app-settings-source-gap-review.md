# LuckRead App 设置页面源码差距评审（初步）

- 日期：2026-11-27
- 基线：main 分支本次读取源码（source-only）
- 重点：App Settings & Privacy
- 参考：X / Threads 的成熟设置与控制体验
- 状态：SOURCE REVIEW ONLY；未运行构建/真机交互；不得称为设备验收

## 1. 当前设置页面实际结构（源码确认）

文件：`app/app/(drawer)/settings.tsx`

现有设置页可确认包括：
- 账户：个人主页跳转。
- 隐私与安全：屏蔽和静音管理跳转。
- 通知：通知偏好/设备推送权限入口。
- 显示：外观 Light/Dark/System Bottom Sheet。
- 数据使用：Feed 视频自动播放本机偏好、图片内存/磁盘缓存清理。
- 关于：政策链接、应用版本/构建信息入口（About 路由）。
- 登录状态提示与登录/注册跳转。

当前实现已有若干体验处理：设置行 accessibility role/label/hint；Switch 状态/禁用标记；视频 autoplay 读取/保存及错误提示；图片缓存清理确认/防重复/失败提示；主题偏好保存反馈；安全区 padding 与滚动内容。

## 2. 初步覆盖度（仅针对 Settings 页面信息架构/源码可见入口）

**此百分比是源码页面覆盖估算，不代表功能完成率、X/Threads总体复刻率、API/真实账号/真机验收率。**

- Settings 结构覆盖估算：约 55%（现有页面能提供个人主页、Block/Mute、Notifications、Appearance、媒体/缓存、About；较成熟设置中心仍缺多个关键分类与入口）。
- 设置真实交互/后台闭环验收：NOT VERIFIED。
- 设置视觉对标验收：NOT VERIFIED。
- 设置无障碍验收：NOT VERIFIED（源码有部分标签，但尚未验证完整屏幕阅读器、动态字体、对比度及控制反馈）。
- 账户安全/Session/Privacy controls：NOT VERIFIED / 当前设置页未提供对应完整入口。

该估算应随着实际运行证据和相关功能合同更新，不能作为全 App 百分比。

## 3. 缺失或未出现在当前 Settings 页的入口

| 分类 | 当前源码入口状态 | 优先级/建议 |
|---|---|---|
| 账户信息/身份管理 | 目前仅链接个人主页；登录/注册状态卡片，不是完整账户中心 | P1：核实已有 User Center 路由后建立可发现的链接 |
| 活跃会话/设备管理 | Settings 页未提供入口 | P1：先做安全 admission / capability verification，禁止占位伪开关 |
| 登录安全/恢复/验证方式 | Settings 页未提供入口 | P1：验证现有身份域能力，按安全合同开放 |
| 隐私可见性/发现权限 | 未见设置入口 | P1/P2：核实授权API；未接入前不虚构控制 |
| 互动权限（回复/提及/标签等） | 未见设置入口 | P2：核实现有权限域与接口后确定范围 |
| 私信权限/请求/已读控制 | 未见设置入口 | P1/P2：若消息已发布，设置需可发现且与真实消息控制闭环 |
| Block/Mute | 已有入口 | 验收：实际列表、翻页、解除、过滤和账号隔离 |
| Notification | 已有入口 | 验收：类别设置与系统推送权限分离；读写与重新读取 |
| Content controls / hidden words | 未见入口 | 当前契约可能属于 2.0；不得扩展越权 |
| Accessibility / language | 未见独立入口 | P2：先核实已支持偏好；覆盖字号、reduce motion、语言及屏幕阅读器 |
| Data export / deactivate / delete | 未见设置入口 | P1（生命周期能力上线时）：完整后端流程、身份验证、确认与恢复策略 |
| Help / support | 未见入口 | 按当前合同属于部分 2.0 deferred；明确Beta范围 |
| Cache/media controls | 有图片缓存清理与视频自动播放 | 验收：真实效果、失败提示、重复操作、缓存范围准确 |
| About / policies | 有入口 | 验收：链接可用、版本/build准确、返回与加载状态 |

## 4. 设置 UI 细节待实测

- 设置主页分组密度、行高、间距、边界、视觉层级是否接近 X/Threads（采用产品自身品牌，不复制品牌资产）。
- 每行是否有足够触控面积、正确 active/pressed/disabled 状态。
- Theme bottom sheet：弹出/关闭、系统返回、拖动、屏幕阅读器、保存失败、重新打开时状态。
- 视频自动播放：初次加载、读值失败、保存失败、快速切换、页面离开/重进、应用重启。
- 清理缓存：内存/磁盘分别成功与失败、重复点击、后台中断、清理后媒体重新加载。
- 登录状态：未登录入口、身份切换、过期session、账号退出、深链返回、旧账号偏好泄露。
- 返回按钮、Stack 返回、系统手势返回及路由被直接访问。
- 主题覆盖：设置页、底Sheet、其他页面、通知/消息/Feed、错误/空状态。
- 动态字体、VoiceOver/TalkBack、对比度、Reduce Motion、键盘与安全区。
- 逐项核对说明文案是否准确界定设备级与账号级作用域。

## 5. X / Threads 设置体验目标（LuckRead差距方向）

1. 设置中心可发现：从个人菜单清晰到达，不要把多个设置入口分散到 Drawer、个人页和不同子菜单。
2. 分类信息架构：Account；Security & account access；Privacy & safety；Notifications；Display/accessibility；Media/data；Help/about；Account lifecycle（仅支持时显示）。
3. 一行一个控制目的，标题简明，描述准确，显示当前状态，子页有明确返回。
4. 设置必须说明范围：当前设备 / 当前账号 / 全局账号 / 对话 / 单帖子。
5. 不显示没有权威读取/写入路径的开关或伪页面。
6. 写操作有保存中、成功、失败、恢复和重新读取；重要安全操作需确认/重新认证。
7. 设置页的所有状态适配 Light/Dark、屏幕阅读器、动态字体、键盘和安全区。

## 6. 本次源码发现的事实与限制

- 设置屏幕当前文件为 `app/app/(drawer)/settings.tsx`。
- 当前 Settings home 显示六类主要内容：账户/个人主页、屏蔽和静音、通知、外观、数据使用、关于。
- 外观选择有 Light/Dark/System；视频自动播放偏好读写与图片缓存清理有错误状态处理。
- 当前 APP Settings & Privacy Center contract `docs/73-APP-SETTINGS-PRIVACY-CENTER-CONTRACT-v1.0.md` 明确写为 baseline in progress；Block/Mute 与 Appearance 等仍需 real-account runtime closeout；session security awaiting admission；完整 Help/Support 等部分范围延期。
- APP acceptance matrix 要求当前 SHA 的自动化/构建/真机/API数据证据；源码存在并不代表验证通过。

## 7. 建议的后续整体审计顺序（不拆成小零碎任务）

以一次大阶段完成整轮评审的方式执行：
1. Settings：对照入口、UI、行为与权限逐项实测；登记完整差距及阻断项。
2. App核心页面：Shell/Feed/Composer/Post/Search/Notifications/Messages/Profile/Media。
3. H5：对应旅程、响应式、加载速度与功能闭环。
4. 第三端：确认真实端范围并完成对标。
5. 三端一致性：身份、数据、缓存、深链、状态与返回行为。
6. 证据和百分比：按检查项完成度和权重汇总，不以未经验证源码推断。

## 8. 本文边界

本文仅做设置页面源码差距评审及进一步验收定义；不修改产品代码，不新增未经合同批准的隐私/安全开关，不声明实机验收，不擅自改变Beta范围。
