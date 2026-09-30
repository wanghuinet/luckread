# LuckRead Accessibility Baseline / Acceptance Contract v1.0

**状态：P1 / CROSS-CUTTING / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

统一 P0 用户旅程的无障碍要求，使 accessibility 成为可验收的工程约束，而不是仅有设计口号。

## 2. Scope

至少覆盖：

```text
keyboard
screen reader
focus
color-independent meaning
text scaling
captions / transcripts where applicable
motion preferences
touch target
error comprehension
semantic structure
```

## 3. Keyboard

关键 P0 任务必须可通过键盘完成：

```text
navigate
open
edit
submit
cancel
recover
```

焦点顺序必须符合用户任务逻辑。

## 4. Focus

页面/模态框/异步操作发生变化时必须保留可理解焦点。

禁止 focus trap 无退出路径。

## 5. Screen Reader

交互元素必须拥有可理解的：

```text
name
role
state
value
status
error
```

动态状态变化应以合适的语义通知。

## 6. Text / Scaling

文字放大不能导致关键任务不可完成；关键信息不得只依赖视觉位置。

## 7. Color / Visual Meaning

错误、成功、限制等状态不得只用颜色表达；必须具有文本/语义等冗余表达。

## 8. Motion

支持减少动态效果；动画不得阻断关键操作或造成不可理解状态。

## 9. Media Accessibility

视频/直播/音频在支持范围内应提供：

```text
captions
transcript
accessible controls
meaningful player state
```

## 10. Forms / Errors

表单必须提供：

```text
field label
validation message
error association
recovery guidance
```

错误信息必须遵守 Unified Error Contract 的安全解释规则。

## 11. Touch

触控目标必须足够清晰、可操作，避免相邻动作误触造成不可逆副作用。

## 12. Async Accessibility

异步任务必须让辅助技术用户感知：

```text
accepted
processing
success
failure
retryable
```

## 13. Privacy / Security

无障碍辅助信息不得扩大权限，不得泄露敏感内容。

## 14. Performance

Accessibility 方案不得引入不可控脚本开销；高频页面优先使用语义 HTML 和渐进增强。

## 15. Acceptance

P0 至少验证：

1. keyboard-only completion；
2. screen-reader basic journey；
3. focus after navigation/modal/error；
4. text scaling；
5. color-independent status；
6. captions/transcript where applicable；
7. reduced motion；
8. form error association；
9. async status announcement；
10. touch target usability。

## 16. STOP Conditions

- P0 关键任务键盘无法完成；
- error/success 只靠颜色；
- modal 无可恢复焦点；
- 异步任务状态对辅助技术不可见；
- accessibility workaround 绕过 security/privacy。

## 17. READY Gate

```text
Keyboard
→ Focus
→ Screen Reader
→ Scaling
→ Visual Semantics
→ Motion
→ Media
→ Forms
→ Async Status
→ Acceptance Evidence
→ READY
```

## 18. Global Inheritance

```text
GLOBAL QUALITY INHERITANCE = REQUIRED
CLOUDFLARE-FIRST = REQUIRED
PAYLOAD BOUNDARY = REQUIRED
NO SECOND BUSINESS AUTHORITY = REQUIRED
```
