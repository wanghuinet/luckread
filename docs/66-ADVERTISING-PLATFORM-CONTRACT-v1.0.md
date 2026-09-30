# LuckRead Advertising Platform Contract v1.0

## 1. Purpose

The Advertising Platform defines the contract for advertiser, campaign, creative, targeting, delivery, measurement, billing, safety, and optimization capabilities required for a large-scale self-media platform.

Advertising is a platform capability, not a property of Content, Feed, Creator, Wallet, or Personal Content Space.

The platform MUST support native content advertising, creator/brand collaboration, promoted distribution, and future auction-based delivery without coupling advertising authority to any single content surface.

## 2. Scope

The contract covers:

- Advertiser identity and organization
- Advertiser accounts and roles
- Campaigns
- Ad groups / delivery plans
- Creatives
- Placement inventory
- Audience and targeting definitions
- Budget and pacing
- Bidding / pricing abstraction
- Ad eligibility
- Delivery decisions
- Frequency capping
- Impression / click / conversion events
- Attribution
- Fraud and invalid-traffic controls
- Moderation and policy enforcement
- Reporting
- Billing and settlement integration
- Experimentation and optimization
- Privacy and regional policy

## 3. Non-Goals

This contract does NOT define:

- Wallet or settlement ledger authority
- Creator payout authority
- Content authoritative storage
- Feed ranking authority
- Recommendation model implementation
- User identity authority
- Media processing authority
- Moderation policy authority
- Copyright authority

Those domains remain authoritative for their own records and decisions.

## 4. Ownership Model

Advertising MUST maintain its own authoritative advertising state while referencing external domain entities by stable IDs.

```text
Advertising Platform
├── Advertiser / Organization
├── Campaign
├── Ad Group
├── Creative
├── Targeting Definition
├── Budget / Pacing State
├── Delivery Policy
├── Attribution State
└── Reporting Read Models
        ↓ references
Content / Creator / User / Media / Commerce / Wallet / Risk / Moderation
```

No advertising API may silently create a second authoritative User, Content, Creator, or Wallet record.

## 5. Advertiser and Organization

The platform MUST support:

- Individual advertisers
- Brand accounts
- Organization accounts
- Agency / MCN advertiser relationships
- Multiple operator roles
- Approval status
- Billing status
- Policy status

Minimum roles SHOULD include:

```text
OWNER
ADMIN
CAMPAIGN_MANAGER
CREATIVE_MANAGER
ANALYST
BILLING_MANAGER
```

Role assignment MUST be auditable.

## 6. Campaign Lifecycle

Minimum lifecycle:

```text
DRAFT
→ REVIEWING
→ APPROVED
→ ACTIVE
→ PAUSED
→ COMPLETED
→ REJECTED
→ ARCHIVED
```

A campaign MUST NOT deliver unless all required policy, budget, creative, targeting, and account checks pass.

## 7. Ad Group / Delivery Plan

A campaign MAY contain multiple delivery plans.

Each plan SHOULD define:

- Placement
- Audience
- Schedule
- Budget
- Bid strategy
- Pacing strategy
- Frequency limits
- Optimization objective
- Creative set
- Geographic / language restrictions where applicable

Delivery plans MUST be independently pausable.

## 8. Creative Contract

Creatives MUST support at least:

- Image
- Video
- Text
- Native content reference
- Carousel / multi-asset formats where supported
- Landing destination
- Disclosure / sponsored labeling

Creative assets are owned by the Media / Content domains where appropriate. Advertising stores references and advertising-specific metadata rather than duplicating large binaries.

Every delivered advertisement MUST be clearly identifiable as sponsored content where required by policy or law.

## 9. Inventory and Placement

Advertising inventory MUST be explicitly registered.

Example placements:

```text
FEED
SEARCH
CONTENT_DETAIL
VIDEO
LIVE
PROFILE
COMMUNITY
CREATOR_SURFACE
APP_HOME
```

Placement eligibility MUST be contract-driven and versioned.

A product surface MUST NOT invent an advertising placement without registering its eligibility, privacy, measurement, and safety requirements.

## 10. Targeting

Targeting MAY include:

- Geographic region
- Language
- Device class
- Context
- Content category
- First-party audience where permitted
- Creator / content affinity where permitted
- Time window
- Frequency constraints
- Conversion history where permitted

Sensitive attributes MUST NOT be used for targeting unless explicitly permitted by applicable policy and law.

Targeting decisions MUST be explainable at the policy level without exposing protected internal model details.

## 11. Privacy and Consent

Advertising MUST enforce:

- Applicable privacy consent
- Regional restrictions
- Data minimization
- Purpose limitation
- User opt-out controls where required
- Data retention limits
- Deletion propagation
- Restricted audience handling

Advertising MUST NOT treat raw behavioral events as unrestricted targeting data.

```text
Raw Event
→ Privacy / Eligibility
→ Risk / Trust
→ Valid Signal
→ Allowed Advertising Use
```

## 12. Budget and Pacing

Campaigns MUST support:

- Total budget
- Daily budget
- Start/end time
- Spending limits
- Pacing state
- Budget exhaustion
- Pause / resume

Budget state MUST be authoritative and must not rely on cache-only values.

High-frequency delivery decisions MAY use cached or precomputed budget controls, but authoritative accounting MUST reconcile against the Wallet / Ledger domain.

## 13. Bidding and Pricing Abstraction

The initial implementation MAY support fixed-price or rule-based delivery.

The contract MUST leave room for:

- CPM
- CPC
- CPA
- Fixed sponsorship
- Creator collaboration pricing
- Future auction mechanisms

The advertising API MUST abstract the pricing strategy so delivery clients do not depend on a specific auction implementation.

## 14. Delivery Decision Contract

A delivery request SHOULD provide:

```text
requestId
userContext
placement
contentContext
deviceContext
region
sessionContext
```

The decision response SHOULD provide:

```text
decisionId
creativeId
campaignId
adGroupId
sponsoredLabel
trackingToken
expiry
policyVersion
```

The delivery layer MUST NOT expose sensitive targeting rules or internal risk signals to clients.

## 15. Frequency Capping

The system MUST support frequency controls by applicable scope:

- User
- Campaign
- Ad group
- Creative
- Placement
- Time window

Frequency state SHOULD use cache / counters for low-latency enforcement and MUST tolerate bounded approximation where policy explicitly permits it.

## 16. Measurement Events

Representative events:

```text
ad.impression
ad.view_start
ad.view_complete
ad.click
ad.engagement
ad.conversion
ad.invalid
ad.attributed
ad.disqualified
```

Events MUST contain stable event IDs and MUST be idempotently processed.

Raw events MUST NOT directly become billing or payout records.

## 17. Attribution

Attribution MUST define:

- Attribution window
- Eligible events
- Attribution model
- Deduplication rules
- Cross-device limitations
- Regional restrictions
- Fraud exclusions

Attribution outputs are derived records and MUST be reproducible from authoritative event evidence plus versioned attribution policy.

## 18. Fraud and Invalid Traffic

Advertising MUST integrate with Risk / Trust controls.

Signals MAY include:

- Automated traffic
- Click anomalies
- Impression anomalies
- Device abuse
- Account abuse
- Incentive abuse
- Conversion anomalies

Invalid activity MUST be excluded from billing and optimization according to versioned policy.

Risk decisions MUST NOT be inferred solely from aggregate advertising metrics.

## 19. Moderation and Policy

Every campaign and creative MUST pass required policy checks before delivery.

Policy states SHOULD include:

```text
PENDING
APPROVED
REJECTED
REQUIRES_CHANGES
SUSPENDED
```

The advertising platform MAY orchestrate policy state but MUST NOT duplicate the authoritative moderation rule set.

Appeal workflows MUST provide traceable references to the applicable policy decision.

## 20. Creator and Content Advertising

Advertising MAY promote creator content or collaborate with creators.

Requirements:

- Stable creator reference
- Stable content reference
- Sponsored disclosure
- Permission validation
- Campaign scope validation
- Rights validation
- Attribution separation

Creator monetization remains owned by the Monetization / Wallet domains.

## 21. Reporting

Reports SHOULD support:

- Spend
- Impressions
- Reach
- Clicks
- CTR
- Video views
- Conversions
- CPA / CPC / CPM
- Frequency
- Invalid traffic
- Attribution results

Reports are read models and MUST NOT become accounting authority.

Large reports MUST use asynchronous generation where synchronous queries would exceed latency budgets.

## 22. API Contract

Representative APIs:

```text
POST   /v1/ads/advertisers
GET    /v1/ads/advertisers/{id}
POST   /v1/ads/campaigns
GET    /v1/ads/campaigns
GET    /v1/ads/campaigns/{id}
POST   /v1/ads/campaigns/{id}/pause
POST   /v1/ads/campaigns/{id}/resume
POST   /v1/ads/creatives
POST   /v1/ads/delivery/decide
POST   /v1/ads/events
GET    /v1/ads/reports
GET    /v1/ads/billing-summary
```

All mutations MUST enforce authorization, idempotency where applicable, policy validation, and audit requirements.

## 23. Event Contract

Representative domain events:

```text
advertiser.created
advertiser.status_changed
campaign.created
campaign.approved
campaign.rejected
campaign.activated
campaign.paused
campaign.completed
creative.created
creative.approved
creative.rejected
ad.impression
ad.click
ad.conversion
ad.invalid
ad.attribution.completed
ad.policy.suspended
```

Consumers MUST be idempotent and MUST tolerate duplicate delivery.

## 24. Cache and Queue Contract

Cache MAY hold:

- Campaign eligibility
- Creative eligibility
- Frequency counters
- Delivery policy snapshots
- Budget guardrails
- Hot reporting aggregates

Queue SHOULD handle:

- Measurement ingestion
- Attribution processing
- Reporting aggregation
- Fraud analysis
- Budget reconciliation
- Policy propagation

Cache is disposable. Queue delivery is at-least-once unless a stronger guarantee is explicitly contracted.

## 25. Consistency and Accounting

Advertising MUST distinguish:

```text
Delivery Evidence
→ Measurement
→ Attribution
→ Billing Candidate
→ Authoritative Ledger / Settlement
```

No impression, click, or conversion event may directly mutate a financial ledger without validation, deduplication, fraud checks, and reconciliation.

## 26. Security

Requirements:

- Tenant isolation
- Role-based authorization
- Resource ownership checks
- Signed delivery/tracking tokens where required
- Replay protection for sensitive mutations
- Audit logs
- Rate limits
- Abuse controls
- Secret isolation

Advertiser IDs and campaign IDs MUST NOT be treated as authorization credentials.

## 27. Performance

P0 requirements:

- Delivery decision path MUST remain bounded and latency-sensitive.
- Large reporting queries MUST NOT block delivery.
- Measurement ingestion MUST be asynchronous where possible.
- High-frequency counters MUST avoid synchronous authoritative writes on every event.
- Campaign eligibility SHOULD be cacheable and versioned.
- Delivery failure MUST degrade safely without exposing private targeting data.

## 28. Observability

The platform SHOULD measure:

- Delivery latency
- Decision success rate
- Fill rate
- Impression ingestion lag
- Click ingestion lag
- Attribution lag
- Invalid traffic rate
- Budget reconciliation drift
- Policy rejection rate
- Creative failure rate
- Reporting generation latency
- Cache hit rate
- Queue lag

Observability data MUST be access-controlled and privacy-safe.

## 29. Data Lifecycle

Advertising records follow explicit retention policies:

```text
Created
→ Active
→ Completed / Suspended
→ Reporting Retention
→ Archive
→ Purge
```

Financially relevant evidence MUST follow the Wallet / Ledger / Settlement retention contract.

Deletion requests MUST propagate according to legal, privacy, fraud, and accounting retention requirements.

## 30. Acceptance Criteria

The contract is implementation-ready only when all are defined:

- Advertiser / organization model
- Roles and permissions
- Campaign lifecycle
- Ad group / delivery plan
- Creative lifecycle
- Placement registry
- Targeting policy
- Privacy and consent
- Budget and pacing
- Pricing abstraction
- Delivery decision
- Frequency capping
- Measurement events
- Attribution
- Fraud / invalid traffic
- Moderation / policy
- Creator/content promotion
- Reporting
- Billing integration boundary
- Event idempotency
- Auditability
- Data lifecycle
- Regional compliance

## 31. STOP Conditions

Implementation MUST STOP if:

- Advertising creates a second authoritative User / Creator / Content / Wallet record
- Raw behavioral events directly control billing or payout
- Cache becomes authoritative accounting state
- Sensitive attributes are used for targeting without an approved policy
- A campaign can deliver without required moderation / policy approval
- Delivery cannot identify a stable campaign / creative decision
- Measurement events cannot be deduplicated
- Invalid traffic cannot be excluded according to policy
- Advertising APIs bypass tenant authorization
- Reporting blocks latency-sensitive delivery
- Financially relevant data has undefined retention or reconciliation semantics

## 32. Admission Status

Status: **PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

This document defines the Advertising Platform boundary, ownership model, campaign and delivery lifecycle, targeting, privacy, measurement, risk, moderation, reporting, accounting boundary, performance, observability, and acceptance requirements.

Implementation remains blocked until project-level contract admission authorizes code changes.
