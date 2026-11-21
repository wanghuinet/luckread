# LuckRead Analytics Decision (1.1)

Status: Accepted direction; implementation proceeds in small, reviewable steps.

## Decision

Use **Umami as the reference and first-party web-traffic analytics layer** for LuckRead 1.1. Do not embed or fork the entire Umami application into the LuckRead runtime. LuckRead remains the source of truth for product and business events.

## Why Umami

- Focused on page views, referrers, devices, events, and lightweight web analytics.
- Open-source and self-hostable; its upstream repository is MIT-licensed.
- A smaller operational scope than a full product analytics suite.
- Leaves LuckRead's existing Worker/D1 topology and domain business boundaries intact.

Upstream: https://github.com/umami-software/umami

## Scope boundaries

### Umami layer

Use for aggregate web traffic analytics:
- page views and unique visitors;
- referrer/source, device/browser, and page performance trends;
- explicitly defined custom events such as content detail views and outbound/share actions, where appropriate.

### Native LuckRead analytics

Keep business truth in LuckRead:
- article/dynamic/video reads and video playback milestones;
- likes, comments, follows, subscriptions, entitlements, and revenue;
- creator dashboards and business conversion metrics.

Do not treat client-side analytics events as authoritative for billing, permissions, moderation, or creator earnings. Those must derive from server-validated business records.

## Architecture constraints

- Preserve the existing 12 Worker / 4 D1 topology.
- Do not add a Worker, D1 database, Queue, or new service binding for analytics.
- Do not change Payload core, Better Auth, or the existing account system.
- Do not let browser analytics send one D1 write per page interaction.
- Do not place secrets in browser code.
- Analytics failure must never block registration, login, reading, publishing, or social actions.
- Avoid collecting email addresses, auth tokens, raw user identifiers, or other sensitive values in analytics payloads.
- Respect the site's applicable consent and privacy requirements before enabling non-essential tracking.

## Delivery sequence

1. **Decision and contract (this document).**
2. Inventory existing web entry points, CSP/security headers, consent/privacy UI, and deployment environment; identify the smallest safe integration point.
3. Add the Umami client integration behind environment configuration, disabled when the required configuration is absent. Keep local development and tests deterministic.
4. Define a short allowlist of page/event names; do not send arbitrary content bodies or personal data.
5. Add focused tests for configuration-off behavior, event allowlisting, and analytics never blocking user flows.
6. Verify preview/production configuration and dashboard receipt before calling the integration complete.

## Acceptance criteria

- Existing account, content, and social behavior is unchanged when analytics is disabled or unavailable.
- No analytics secret is exposed to the browser.
- No new Worker, D1, Queue, or service binding is introduced.
- Only approved page/event names and non-sensitive properties are sent.
- Build, typecheck, and relevant tests pass.
- Production collection is not declared complete until a real event is observed in the configured Umami dashboard.

## Explicitly deferred

PostHog-style funnels/cohorts, session replay, experimentation, and advanced retention analysis are not part of the initial 1.1 analytics step. Re-evaluate only after baseline traffic and native business metrics are reliable.
