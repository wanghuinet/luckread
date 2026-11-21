# LuckRead Creator / IP Marketplace and Brand Collaboration Contract v1.0

**Status: PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Purpose

Creator / IP Marketplace is the platform business layer connecting creators, IP owners, organizations, brands, agencies, advertisers and buyers for structured collaboration and licensing opportunities.

It is not a second Creator, IP, Rights, Advertising, Commerce, Wallet, or Ledger authority.

The system MUST support:

- creator discovery
- IP discovery
- brand briefs
- opportunity matching
- collaboration proposals
- quotation / negotiation
- campaign or project delivery
- IP licensing opportunities
- creator services
- sponsorships
- brand collaboration
- deliverable acceptance
- attribution references
- dispute handling
- settlement references

## 2. Non-Goals

This contract does NOT define:

- Creator identity authority
- IP ownership authority
- Copyright / Rights authority
- Advertising campaign authority
- Final financial ledger
- Payment-provider authority
- Recommendation model implementation
- Content authoritative storage
- Moderation policy authority

External domains remain authoritative for their own facts and decisions.

## 3. Ownership Model

```text
Marketplace
├── Participant Profile / Eligibility Reference
├── Opportunity / Brief
├── Match / Shortlist
├── Proposal
├── Collaboration
├── Deliverable
├── Acceptance
├── Dispute
└── Settlement Reference
        ↓ references
Creator / Organization / IP / Rights / Advertising / Commerce / Ledger / Risk / Moderation
```

Marketplace may maintain marketplace-specific authoritative state, but must reference external entities by stable IDs.

## 4. Participant Types

The marketplace MUST support at least:

```text
CREATOR
CREATOR_ORGANIZATION
MCN
BRAND
ADVERTISER
AGENCY
IP_OWNER
SERVICE_PROVIDER
PLATFORM_OPERATOR
```

A participant may have multiple roles subject to authorization.

Participant eligibility MUST be separated from identity. Marketplace approval MUST NOT mutate the authoritative user or creator identity record.

## 5. Creator / IP Marketplace Profile

Marketplace profiles SHOULD expose only approved commercial information:

- creator reference
- organization reference
- public display name
- creator categories
- supported content types
- audience summary where authorized
- commercial capabilities
- geographic / language capabilities
- rate-card reference
- collaboration availability
- portfolio references
- IP references
- verification state
- commercial eligibility

Sensitive user information, private audience data, risk signals, security signals and internal recommendation scores MUST NOT be exposed.

## 6. Opportunity / Brand Brief

A brand or authorized buyer MAY create an opportunity.

Minimum fields:

```text
id
ownerParticipantId
title
description
objective
contentTypes
creatorCriteria
ipCriteria
territories
languages
startAt
endAt
budgetReference
rightsRequirements
deliverables
reviewPolicy
status
version
createdAt
updatedAt
```

Opportunity lifecycle:

```text
DRAFT
→ PUBLISHED
→ MATCHING
→ SHORTLISTING
→ NEGOTIATING
→ AWARDED
→ IN_DELIVERY
→ COMPLETED
→ CLOSED
```

Terminal / exceptional states:

```text
CANCELLED
EXPIRED
REJECTED
DISPUTED
SUSPENDED
```

## 7. Matching and Shortlisting

Marketplace MAY use search, recommendation, eligibility rules, audience fit, content fit, IP fit, availability and historical commercial performance.

Matching MUST respect:

- participant eligibility
- rights constraints
- privacy
- regional policy
- category restrictions
- conflict-of-interest rules
- commercial availability
- moderation status
- risk controls

Internal ranking signals MUST NOT be exposed as authoritative business facts.

A match is a recommendation/marketplace decision, not a contract.

## 8. Proposal and Negotiation

The marketplace MUST support structured proposals rather than relying only on free-form chat.

Proposal SHOULD define:

- participants
- opportunity reference
- scope
- deliverables
- price reference
- rights scope
- territory
- duration
- exclusivity
- publication requirements
- approval requirements
- deadlines
- cancellation terms
- revision limits
- disclosure requirements

Proposal lifecycle:

```text
DRAFT
→ SENT
→ COUNTERED
→ ACCEPTED
→ REJECTED
→ EXPIRED
→ WITHDRAWN
```

Every accepted proposal MUST produce an immutable version/reference suitable for later audit.

## 9. Collaboration Contract Boundary

An accepted proposal creates a collaboration record, not a financial ledger entry.

```text
Accepted Proposal
→ Collaboration
→ Deliverables
→ Review / Acceptance
→ Attribution Evidence
→ Commerce / Revenue Recognition
→ Ledger / Settlement
```

Collaboration MUST have a stable ID and version.

Changes after acceptance MUST be versioned and authorized.

## 10. Deliverables

Deliverables MAY include:

- Article / post
- Image set
- Short video
- Long video
- Live appearance
- Podcast / audio
- Product placement
- Review
- Brand mention
- IP integration
- Event participation
- Creative service
- Licensing usage

Each deliverable SHOULD define:

```text
id
collaborationId
contentReference
assetReference
ownerReference
dueAt
status
reviewState
acceptanceState
version
```

Marketplace MUST reference Content / Media rather than duplicating authoritative content or binaries.

## 11. Rights Boundary

Any commercial use of content, creator identity, likeness, IP, media, derivative work or distribution rights MUST have an explicit rights reference where required.

```text
Collaboration
→ Rights Requirement
→ Rights Check
→ Authorized Scope
→ Delivery
```

Rights MAY include:

- publication
- reposting
- editing
- derivative use
- advertising usage
- paid media usage
- geographic territory
- duration
- exclusivity
- platform/channel scope

Marketplace MUST NOT invent ownership or license rights.

## 12. Brand Collaboration

Brand collaboration MAY connect directly to the Advertising and Commerce domains.

Examples:

```text
Brand Brief
→ Creator / IP Match
→ Proposal
→ Collaboration
→ Campaign Reference
→ Content Delivery
→ Attribution
→ Settlement
```

Advertising remains authoritative for advertising campaigns and delivery. Marketplace owns the commercial relationship and collaboration workflow.

## 13. Pricing

Marketplace MUST support a pricing abstraction without hard-coding a single business model.

Supported models MAY include:

- fixed fee
- CPM-based sponsorship reference
- CPC-based sponsorship reference
- CPA / conversion-based reference
- project fee
- creator service fee
- licensing fee
- revenue share reference
- hybrid pricing

All financial amounts MUST use explicit currency and minor-unit representation. Floating-point money is forbidden.

Marketplace pricing is commercial intent; authoritative accounting belongs to Commerce / Ledger.

## 14. Creator Rate Cards

Creators or authorized organizations MAY publish rate-card references.

Rate cards MUST support versioning and effective dates.

A rate card is not an obligation until referenced by an accepted commercial agreement.

Private negotiated pricing MUST NOT be exposed to unauthorized users.

## 15. Acceptance and Delivery

Deliverables MUST support:

```text
PENDING
→ SUBMITTED
→ UNDER_REVIEW
→ CHANGES_REQUESTED
→ ACCEPTED
```

Failure states:

```text
REJECTED
FAILED
CANCELLED
```

Acceptance MUST record:

- actor
- timestamp
- deliverable version
- decision
- reason/reference
- correlation ID

Acceptance is evidence for commercial completion; it does not itself create a ledger entry.

## 16. Disputes

Marketplace MUST provide a structured dispute boundary.

A dispute MAY reference:

- scope disagreement
- deliverable quality
- missed deadline
- rights conflict
- cancellation
- payment status
- attribution disagreement
- policy decision

Dispute lifecycle:

```text
OPEN
→ INVESTIGATING
→ RESOLUTION_PROPOSED
→ RESOLVED
```

Exceptional states:

```text
ESCALATED
CLOSED_WITHOUT_AGREEMENT
```

Marketplace stores case state and evidence references; legal, rights, financial and moderation decisions remain owned by their domains.

## 17. Risk and Safety

Before high-value or high-risk collaboration, Marketplace SHOULD request:

- participant eligibility
- account status
- risk decision
- moderation status
- rights status
- policy eligibility

Risk signals MUST NOT be copied into public marketplace profiles.

Suspension or eligibility changes MUST propagate to active opportunities and collaborations according to policy.

## 18. Privacy

Marketplace MUST enforce:

- participant visibility controls
- audience-data minimization
- private negotiation confidentiality
- contract confidentiality
- regional restrictions
- deletion policy
- data retention
- consent requirements

Buyer/brand users MUST NOT receive private creator or audience data merely because a creator is discoverable in Marketplace.

## 19. Organization / MCN Support

Marketplace MUST support organization-managed creators without replacing creator ownership.

```text
Organization
→ Authorized Creator Affiliation
→ Marketplace Representation
→ Opportunity
→ Collaboration
→ Revenue Attribution
→ Settlement Reference
```

MCN permissions must be scoped and auditable.

A creator leaving an organization MUST NOT silently destroy historical marketplace evidence.

## 20. API Contract

Representative APIs:

```text
POST   /v1/marketplace/opportunities
GET    /v1/marketplace/opportunities
GET    /v1/marketplace/opportunities/{id}
POST   /v1/marketplace/opportunities/{id}/publish
POST   /v1/marketplace/opportunities/{id}/shortlist
POST   /v1/marketplace/proposals
GET    /v1/marketplace/proposals/{id}
POST   /v1/marketplace/proposals/{id}/counter
POST   /v1/marketplace/proposals/{id}/accept
POST   /v1/marketplace/collaborations
GET    /v1/marketplace/collaborations/{id}
POST   /v1/marketplace/deliverables
POST   /v1/marketplace/deliverables/{id}/submit
POST   /v1/marketplace/deliverables/{id}/accept
POST   /v1/marketplace/disputes
GET    /v1/marketplace/creator-profiles
GET    /v1/marketplace/ip-profiles
```

All mutations MUST enforce authorization, idempotency, version checks, policy validation and audit requirements.

## 21. Event Contract

Representative events:

```text
marketplace.opportunity.created
marketplace.opportunity.published
marketplace.opportunity.shortlisted
marketplace.proposal.created
marketplace.proposal.countered
marketplace.proposal.accepted
marketplace.proposal.rejected
marketplace.collaboration.created
marketplace.deliverable.submitted
marketplace.deliverable.accepted
marketplace.deliverable.rejected
marketplace.dispute.opened
marketplace.dispute.resolved
marketplace.participant.suspended
```

Events MUST contain stable event ID, entity ID, event version, actor reference where applicable, timestamp and correlation ID.

Consumers MUST tolerate duplicate delivery.

## 22. Consistency and Idempotency

The following operations MUST be idempotent:

- proposal submission
- proposal acceptance
- collaboration creation
- deliverable submission
- deliverable acceptance
- dispute creation
- participant status mutation

Uniqueness keys MUST prevent duplicate authoritative collaborations for the same accepted proposal version.

Marketplace MUST NOT require distributed transactions across Rights, Commerce, Advertising and Ledger.

## 23. Cache / Search / Queue

Cache MAY hold:

- public marketplace profiles
- opportunity summaries
- eligibility snapshots
- rate-card summaries
- matching candidates
- availability summaries

Search indexes MUST be rebuildable.

Queue SHOULD handle:

- matching
- notifications
- analytics aggregation
- rights status propagation
- eligibility refresh
- deliverable processing
- reporting

Cache and search are derived and disposable.

## 24. Audit and Provenance

Sensitive actions MUST produce audit records:

- proposal acceptance
- scope change
- rights change reference
- participant suspension
- deliverable acceptance
- dispute resolution
- commercial amount change
- settlement reference change

Commercial evidence MUST be traceable from opportunity → proposal → collaboration → deliverable → attribution → settlement reference.

## 25. Performance

P0 requirements:

- Marketplace discovery MUST be cache/search optimized.
- Matching MUST be asynchronous when computation is expensive.
- Public profile rendering MUST NOT synchronously call every external domain.
- Large opportunity lists MUST use cursor pagination.
- Negotiation and acceptance mutations MUST remain on bounded authoritative paths.
- Analytics MUST NOT block collaboration execution.

## 26. Data Lifecycle

```text
Draft
→ Published
→ Active
→ Awarded / In Delivery
→ Completed
→ Closed
→ Retention
→ Archive / Purge
```

Financial, rights and legal evidence follows the stricter retention policy of the authoritative domain.

Historical collaboration evidence MUST remain auditable after participant relationship changes.

## 27. Acceptance Criteria

Implementation readiness requires:

- Participant model
- Marketplace profile boundary
- Opportunity lifecycle
- Matching boundary
- Proposal versioning
- Collaboration lifecycle
- Deliverable lifecycle
- Rights check boundary
- Pricing abstraction
- Brand collaboration
- MCN representation
- Risk eligibility
- Privacy controls
- Dispute workflow
- Audit/provenance
- API contract
- Event idempotency
- Cursor pagination
- Search/cache rebuildability
- Commerce/Ledger boundary
- Data lifecycle

## 28. STOP Conditions

Implementation MUST STOP if:

- Marketplace becomes authoritative Creator or IP storage
- Marketplace grants rights without Rights authority
- Accepted collaboration has no immutable version/reference
- Money is stored as floating point
- Marketplace directly mutates final financial balances
- Proposal acceptance can create duplicates
- Private creator/audience data leaks through discovery
- Search or cache becomes authoritative
- Disputes have no auditable evidence path
- MCN can mutate creator identity without authorization
- Commercial history becomes unrecoverable after participant changes
- Marketplace requires an unapproved distributed transaction across domains

## 29. Admission Status

Status: **PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

This contract freezes the Creator / IP Marketplace and Brand Collaboration boundary before implementation. It intentionally composes with Content/IP, Rights, Advertising, Monetization/Commerce, MCN and future Wallet/Ledger contracts without duplicating their authority.
