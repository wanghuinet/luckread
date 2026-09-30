# Luckread Blueprint Enhancement Allocation — Final v1.0

> Status: **ALLOCATED / CONTRACT-FIRST READY / NO IMPLEMENTATION YET**
>
> Purpose: Convert the final full-web mainstream self-media capability scan into a bounded, non-duplicative implementation allocation. This document does **not** reopen the 10-batch enhancement program and does not authorize code implementation by itself.

## 1. Decision

The final scan found no missing first-order platform domain that requires redesign of the v2.0 architecture. Remaining gaps are maturity capabilities, cross-domain closures, and explicit productization details.

Allocation rule:

1. Existing capability with sufficient contract coverage -> **ENHANCE EXISTING**; do not create a duplicate authority.
2. Capability missing a stable Feature ID -> **NEW FEATURE ID**; add to the authoritative feature inventory before implementation.
3. Capability already represented by an existing domain -> **MERGE INTO EXISTING CONTRACT**.
4. No new wallet, ledger, identity, rights, moderation, analytics, or payment authority may be introduced.
5. Implementation order remains: Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence.

## 2. Final allocation matrix

| # | Capability | Allocation | Stable Feature ID | Owner | Priority |
|---|---|---|---|---|---|
| 1 | Creator Eligibility Engine | NEW FEATURE ID | CREATOR-015 | Creator/AuthZ | P0 |
| 2 | Creator Program / Reward Engine | NEW FEATURE ID | CREATOR-016 | Creator/Growth/PAY | P1 |
| 3 | Premium Content Product | MERGE INTO EXISTING | MON-001..012 + Content/Media | Monetization/Content | P0 |
| 4 | Content Relationship Graph | NEW FEATURE ID | CONTENTREL-001 | Content/Rights | P1 |
| 5 | Community Governance | ENHANCE EXISTING | COMMUNITY-001..008 | Community/Safety/GOV | P1 |
| 6 | Feature Access / Rollout Engine | NEW FEATURE ID | ROLLOUT-001 | Config/Experiment/AuthZ | P1 |
| 7 | Creator Support / Case Management | ENHANCE EXISTING | SUPPORT-001..006 | Support/GOV | P1 |
| 8 | Creator Affiliate | MERGE INTO EXISTING | MON/PAY + ADS/Marketplace | Commerce/PAY | P1 |
| 9 | Preview / Trailer / Teaser | ENHANCE EXISTING | CONTENT-011/ARTICLE-010/MON-007..010 | Content/Monetization | P0 |
| 10 | Remix / Derivative Content | ENHANCE EXISTING | CONTENT-009/012 + RIGHTS-001..008 | Content/Rights | P1 |
| 11 | Live Practice / Rehearsal | ENHANCE EXISTING | MEDIA-011/012 | Media/Live | P1 |
| 12 | Live Co-host / Guest / Multi-host | ENHANCE EXISTING | MEDIA-011 | Media/Live/AuthZ | P1 |
| 13 | Live Monetization Interaction | MERGE INTO EXISTING | MEDIA-011 + MON/PAY | Live/Monetization | P1 |
| 14 | Product Placement / Content Tagging | MERGE INTO EXISTING | Commerce/Marketplace + CONTENT | Commerce/Content | P1 |
| 15 | Subscription Lifecycle Depth | ENHANCE EXISTING | MON-003..006 | Monetization | P0 |
| 16 | Watch / Read Progress | NEW FEATURE ID | PROGRESS-001 | Content/Media/User | P1 |
| 17 | Cross-device Continuity | ENHANCE EXISTING | PROGRESS-001 + CLIENT-001..010 | Client/Content | P1 |
| 18 | Content Distribution Control | NEW FEATURE ID | DISTRIBUTION-001 | Content/Feed/AuthZ/Rights/Safety | P0 |

## 3. New Feature IDs — contract requirements

### CREATOR-015 — Creator Eligibility Engine

Eligibility must be policy-driven and observable. Inputs may include identity/verification status, account standing, creator level, region, age/eligibility, safety state, feature policy, experiment/rollout state, and required prerequisites. The result must distinguish eligible, ineligible, pending review, restricted, and suspended states. Eligibility does not itself grant permission; final access remains under AUTHZ/entitlement policy.

### CREATOR-016 — Creator Program / Reward Engine

Canonical lifecycle:
`Program Draft -> Eligibility -> Application/Enrollment -> Qualification -> Active -> Reward Attribution -> Payout/Settlement -> Suspended/Closed`.

Reward calculations must flow into existing entitlement/PAY/ledger/settlement authorities. No direct wallet or ledger mutation from the program engine.

### CONTENTREL-001 — Content Relationship Graph

Support typed relationships including `related-to`, `derived-from`, `translated-from`, `quoted-by`, `referenced-by`, `clipped-from`, `remixed-from`, `sequel-of`, and equivalent future relationship types. Relationships must be permission-aware and must not bypass rights, visibility, safety, or entitlement checks.

### ROLLOUT-001 — Feature Access / Rollout Engine

Canonical lifecycle:
`Draft -> Ready -> Rollout -> Expanded -> Paused/Rolled Back -> Completed`.

Support region, client, account/creator eligibility, allowlist/denylist, percentage rollout, experiment linkage, version, audit, and rollback. This is configuration/rollout authority only; it must not replace AUTHZ or entitlement authority.

### PROGRESS-001 — Cross-content Progress

Support article/read progress, video/watch progress, podcast/audio progress, series/course progress, replay progress, resume position, completion state, history integration, and cross-device synchronization. Progress is derived user state and cannot grant entitlement.

### DISTRIBUTION-001 — Content Distribution Control

Separate content visibility from distribution destinations. Support public, followers, subscribers/members, paid, private, unlisted, organization scope, region restrictions, age restrictions, safety restrictions, scheduled distribution, and destination controls such as home, following, search, recommendation, profile, topic, external embed, API, notification, and partner/marketplace surfaces.

Distribution must evaluate AuthZ, Visibility, Rights, Entitlement, Region, Safety, and client policy before delivery.

## 4. Existing capability enhancements

### Premium Content Product

Do not create a second payment or subscription authority. Extend existing MON/content/media contracts to support content products such as article, video, series, audio, podcast, course, collection, community, and premium live. Support preview, teaser, pricing, discount, purchase, entitlement, refund, access revocation, analytics, and settlement through existing authorities.

### Community Governance

Extend COMMUNITY-001..008 with member approval, moderator actions, mute/ban/removal, community rules, event controls, moderation automation hooks, evidence, appeals, and governance audit. Enforcement remains under Safety/GOV.

### Creator Support / Case Management

Extend SUPPORT-001..006 with creator case categories, assignment, priority, SLA, evidence, internal notes, escalation, resolution, and appeal linkage. Support must not become a parallel moderation, payment, or rights authority.

### Preview / Trailer / Teaser

Extend content/paywall contracts with preview windows, teaser assets, sample duration/word/section limits, and entitlement-aware delivery. Protected content must never be transmitted merely hidden by the client UI.

### Remix / Derivative Content

Extend content ownership and rights contracts with explicit derivative relationships, attribution, source reference, creator credit, reuse permissions, takedown propagation policy, and analytics attribution.

### Live Practice / Co-host / Monetization

Extend the existing live contract with rehearsal/private practice, host/co-host/guest roles, moderator scopes, invitations, removal, live gifts/paid interactions/membership/product integrations, and settlement attribution through existing PAY.

### Subscription Lifecycle

Extend MON-003..006 with trial, renewal, grace period, payment failure, pause, resume, cancel-at-period-end, expiration, reactivation, upgrade/downgrade, refund/chargeback handling, and entitlement synchronization.

### Product Placement / Affiliate

Reuse existing monetization, advertising, marketplace, order, attribution, ledger, and settlement contracts. Support content-level product tags, live product pins, creator affiliate attribution, conversion, commission, and settlement without introducing a second financial authority.

### Progress / Cross-device

Use PROGRESS-001 as the canonical progress model. Clients consume the same API contract and may maintain local optimistic state only as a cache; server-authoritative progress must remain portable across Web/H5/Android/iOS/Mini Program.

## 5. Explicit non-duplication decisions

The following are **not** new domains:

- Creator Studio -> existing CREATOR/CONTENT/ANALYTICS/MON/RIGHTS/SUPPORT capabilities.
- Notification Center -> existing NOTIFY domain.
- Search/recommendation operations -> existing SEARCH/REC/CONFIG/EXP domains.
- Commerce -> existing MON/PAY/ADS/MARKETPLACE domains.
- Live monetization -> existing MEDIA/MON/PAY domains.
- Copyright/attribution -> existing RIGHTS domain.
- Creator eligibility -> new CREATOR-015 only for eligibility policy; AUTHZ remains final authorization.
- Reward programs -> new CREATOR-016 only for program lifecycle/qualification; PAY remains financial authority.
- Feature rollout -> new ROLLOUT-001 only for rollout configuration; AUTHZ/entitlement remain access authorities.

## 6. Implementation batches

### Batch A — P0 closure

1. CREATOR-015 Creator Eligibility Engine
2. DISTRIBUTION-001 Content Distribution Control
3. Premium Content Product enhancement
4. Preview/Trailer/Teaser enhancement
5. Subscription Lifecycle enhancement

### Batch B — Content and creator maturity

1. CONTENTREL-001 Content Relationship Graph
2. CREATOR-016 Creator Program / Reward Engine
3. Remix / Derivative Content
4. Community Governance
5. Creator Support / Case Management

### Batch C — Platform operations and client continuity

1. ROLLOUT-001 Feature Access / Rollout Engine
2. PROGRESS-001 Watch/Read/Cross-device Progress
3. Live Practice / Co-host / Multi-host
4. Live Monetization Interaction
5. Product Placement / Creator Affiliate

## 7. Freeze rule

This allocation closes the current full-web enhancement scan. Do not open another broad capability-audit loop merely because implementation has not started. A genuinely new capability requires Change Control and a new Feature ID.

The next work phase is implementation and evidence closure, not another full-platform brainstorm.

## 8. Acceptance gate

For every item:

`Feature ID -> Contract -> Owner -> Permission/Scope -> State -> Data Authority -> API -> Event -> Async Task -> Analytics -> Safety -> Audit -> Tests/CI -> GitHub SHA -> Evidence`

For any monetized capability additionally:

`Order -> Transaction -> Entitlement -> Revenue Split -> Ledger -> Settlement -> Audit`
