# Creator Profile Responsive Reference

> Reference-only implementation. Do not import this directory into LuckRead production runtime.

## Purpose

This directory records a simplified creator-profile implementation inspired by publicly observable patterns from large creator/video platforms.

It is **not TikTok source code**, does not copy proprietary HTML/CSS/JS, and should not be treated as a reverse-engineered copy of any platform.

## What to borrow later

- Desktop app shell: persistent navigation + centered creator surface.
- Mobile shell: compact top navigation + full-width content.
- Creator Hero: avatar, identity, stats, follow/subscribe/share actions.
- Profile Channel: a clear primary content mode such as Drama, Novel, Photography, Developer Products.
- Content cards: one reusable card with type-specific presentation.
- Responsive grid: desktop multi-column, mobile single-column.
- Small client state: active channel, menu state, and bounded interaction state.
- CSS design tokens instead of page-wide magic numbers.
- Semantic HTML and keyboard-accessible controls.

## What not to borrow

- No proprietary platform source.
- No platform-specific internal APIs.
- No scraping logic.
- No direct D1/database access.
- No production authentication, entitlement, payment or moderation logic.

## LuckRead mapping

```
Creator Type
    -> Default Profile Channel
    -> Profile Module
    -> Content Type
    -> W03 authoritative content read

Capability
    -> Which profile modules can be exposed
```

This reference intentionally keeps Profile as presentation/orchestration. Content, Membership, Commerce and Entitlement remain authoritative in their owning domains.
