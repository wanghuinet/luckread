# LuckRead Enhanced Mainstream Self-Media Platform L1-L2 Capability Master Matrix v1.0

**Status:** ARCHITECTURE-ENHANCED / GAP-CLOSED / CONTRACT-READY / IMPLEMENTATION PENDING

## 0. Purpose

This document is the strengthened product-capability baseline produced by reverse-mapping the capability surfaces of mainstream self-media/social/content platforms and reconciling them with the existing LuckRead L1-L4 capability hierarchy.

It closes product-level omissions found in the previous 26-domain baseline without creating an L5 capability layer.

The rule is:

```text
L1 Domain
  -> L2 Capability
    -> existing L3/L4 inventory
      -> Data Contract
      -> API Contract
      -> Event Contract
      -> Permission/Security Contract
      -> Cost/Runtime Contract
      -> Test/Acceptance Contract
```

This is an architecture/product inventory. It does not authorize implementation by itself.

## 0.1 Reverse-audit principles

1. Mainstream capability completeness is evaluated by user/product responsibility, not by implementation technology.
2. A capability may remain physically implemented by Payload, Workers, D1, R2, cache, queue, or external providers while remaining one product domain.
3. Payload Core remains upstream-only; this document does not authorize Payload Core modification.
4. High-frequency events remain asynchronous, trust-aware, aggregatable, and replay/rebuild capable.
5. Money, rights, privacy, moderation, identity, and audit state remain authoritative and traceable.
6. Feed, recommendation, personalization, trending, and advertising are separate product responsibilities even when they share infrastructure.
7. No L5 is introduced. L4 remains the smallest planned implementation responsibility.
8. New requirements must map to an existing L1/L2 node unless architecture review explicitly approves a new L1/L2 capability.

## 0.2 Strengthened outcome

The previous 26-domain baseline is retained conceptually, but the product surface is expanded to the following **40 L1 domains** so that previously compressed responsibilities become independently governable.

### Added or strengthened domains

- Content Production
- Content Relations / Remix
- Trending / Hot Topics
- Creator Growth / Success
- Fan Relationship / Membership
- Creator & IP Marketplace
- Creator Tools Ecosystem
- Show / Series / Program
- Podcast / Audio
- Campaign / Activity
- Personal Content Space
- Entity / Unified Profile
- Personalization
- Brand Collaboration
- Advertising Platform

These are not arbitrary feature additions; they are product-level boundaries inferred from mainstream platform capability patterns and from the existing LuckRead IP-centric strategy.

---

# 1. User Identity

## L2
- Registration and account creation
- Authentication and credential management
- Profile and identity presentation
- Account lifecycle
- Account security
- Consent and privacy preferences
- Identity verification
- Account recovery
- Delegated account access

---

# 2. Device / Session / Privacy

## L2
- Device identity
- Session management
- Login security
- Passkey / external identity binding
- Privacy controls
- Data export
- Data deletion
- Regional policy enforcement
- Consent propagation
- Privacy-safe telemetry

---

# 3. Creator

## L2
- Creator identity
- Creator verification
- Creator ownership
- Creator status
- Creator relationships
- Creator public profile
- Creator identity graph
- Creator reputation
- Creator eligibility
- Creator lifecycle

---

# 4. Creator Studio

## L2
- Studio workspace
- Draft management
- Publishing
- Scheduling
- Content management
- Version management
- Moderation workspace
- Rights workspace
- Analytics workspace
- Monetization workspace
- Collaboration workspace
- Studio settings

---

# 5. Creator Growth / Success

## L2
- Creator level
- Creator growth score
- Growth goals
- Creator tasks
- Creator missions
- Creator benefits
- Creator incentives
- Creator programs
- Creator education
- Creator support
- Creator success guidance
- Creator lifecycle growth
- Creator churn prevention
- Creator reactivation

---

# 6. Creator Tools / Production Ecosystem

## L2
- Text editor
- Rich-text editor
- Image editing
- Video editing
- Audio editing
- Subtitle tools
- Dubbing / voice tools
- Effects / filters
- Stickers / overlays
- Music library
- Templates
- Asset library
- Cover tools
- Title / metadata optimization
- AI creation assistance
- Preview and simulation
- Batch creation
- Batch publishing
- Multi-platform publishing
- Cross-content reuse
- Remix creation

---

# 7. Organization / MCN

## L2
- Organization identity
- Organization verification
- Teams
- Workspaces
- Roles and permissions
- Creator representation
- Creator contracts
- Revenue-share rules
- Campaign management
- Organization analytics
- Governance
- Disputes
- Settlement integration

---

# 8. Content

## L2
- Content identity
- Content types
- Draft lifecycle
- Review lifecycle
- Publication lifecycle
- Audience controls
- Visibility controls
- Region controls
- Age/safety controls
- Content body
- Metadata
- Versioning
- Scheduling
- Expiration
- Archive/delete/restore
- Content ownership

Supported product forms include articles, posts, images, videos, audio, novels, comics, drama, live-derived content, playlists, programs, and future extensible content types.

---

# 9. Content Production

## L2
- Creation workspace
- Composition
- Autosave
- Preview
- Asset assembly
- Multi-format conversion
- Content packaging
- Collaborative editing
- Draft review
- Publishing preparation
- Content quality checks
- Reusable templates
- Cross-format repurposing

---

# 10. Content Relations / Remix Graph

## L2
- Series relation
- Episode relation
- Playlist relation
- Collection relation
- Channel relation
- Quote relation
- Excerpt relation
- Translation relation
- Remix relation
- Reaction/response relation
- Duet/collaboration relation
- Adaptation relation
- Compilation relation
- Cross-post relation
- Syndication relation
- Canonical-source relation
- Provenance
- Authorization
- Revenue sharing
- Rights revocation

---

# 11. Show / Series / Program

## L2
- Channel
- Show
- Series
- Season
- Episode
- Playlist
- Program
- Collection
- Release schedule
- Episode ordering
- Season metadata
- Show-level analytics
- Show-level monetization
- Show-level membership

---

# 12. IP Graph / IP Economy

## L2
- IP identity
- IP profile
- Ownership
- Co-ownership
- Controller relationship
- Universe
- Character
- Work
- Series
- Adaptation
- Licensing
- Commercialization
- IP discovery
- IP popularity
- IP trend
- IP community
- IP products
- IP revenue attribution
- IP disputes

---

# 13. Entity / Unified Profile

## L2
- Unified entity identity
- Creator profile
- IP profile
- Brand profile
- Community profile
- Official-account relation
- Works aggregation
- Video aggregation
- Novel/comic/drama aggregation
- Live aggregation
- Product aggregation
- License aggregation
- Fan aggregation
- Related-entity graph
- Entity search
- Entity activity

---

# 14. Media

## L2
- Image assets
- Video assets
- Audio assets
- Subtitle assets
- Document assets
- Cover assets
- Thumbnail assets
- Avatar assets
- Attachments
- Upload sessions
- Resumable upload
- Metadata
- Ownership
- Relations
- Lifecycle
- Private assets
- Public assets

---

# 15. Media Processing

## L2
- Security scanning
- Image processing
- Video transcoding
- Adaptive bitrate packaging
- Audio processing
- Subtitle processing
- Dubbing
- Thumbnail generation
- Preview generation
- Watermarking
- Content fingerprinting
- CDN delivery
- Signed delivery
- Cache invalidation
- Processing retry/recovery

---

# 16. Social Graph

## L2
- Follow
- Mutual follow
- Block
- Mute user
- Mute topic
- Mute source
- Close friends
- Custom audience
- Restricted audience
- Audience graph
- Social integrity
- Graph privacy

---

# 17. Fan Relationship / Membership

## L2
- Fan relationship
- Fan level
- Core fan identification
- Super-fan state
- Membership plans
- Membership tiers
- Membership benefits
- Subscriber-only content
- Subscriber-only live
- Subscriber-only interaction
- Badges
- Member tasks
- Member contribution
- Fan affinity
- Fan lifecycle
- Churn detection
- Reactivation
- Fan notifications

Membership must support both platform-level and creator/IP-level relationships.

---

# 18. Community

## L2
- Community identity
- Group
- Topic
- Channel
- Board
- Membership
- Join requests
- Invitations
- Owner/admin/moderator roles
- Community content
- Announcements
- Rules
- Moderation
- Slow mode
- Member restrictions
- Community discovery
- Creator/IP communities
- Community lifecycle

---

# 19. Interaction

## L2
- Comments
- Replies
- Nested replies
- Reactions
- Likes
- Favorites
- Collections
- Shares
- Mentions
- Tags
- Reports
- Interaction visibility
- Interaction moderation
- Interaction history

---

# 20. Event / High-Frequency Interaction

## L2
- Event admission
- Event schema/versioning
- Exposure
- View
- Click/open
- Dwell
- Watch
- Completion
- Like
- Share
- Follow
- Not-interested
- Hide
- Report
- Deduplication
- Replay protection
- Trust scoring
- Aggregation
- Batch persistence
- Reconciliation

---

# 21. Feed / Distribution

## L2
- For-you feed
- Following feed
- Latest feed
- Topic feed
- Creator feed
- IP feed
- Video feed
- Live feed
- Related feed
- Search-result feed
- Community feed
- Membership feed
- Personalized distribution
- Feed pagination
- Feed refresh
- Feed recovery
- Feed explanations

---

# 22. Recommendation

## L2
- Candidate recall
- Candidate filtering
- Ranking signals
- Ranking models
- Trust weighting
- Safety-aware ranking
- Diversity
- Frequency capping
- Freshness
- Exploration
- Exploitation
- Cold start
- Creator fairness
- Content fairness
- IP diversity
- Feedback learning
- Recommendation explanations
- Model lifecycle
- Offline evaluation
- Online evaluation

---

# 23. Personalization

## L2
- Interest profile
- Interest strength
- Interest decay
- Topic preference
- Creator preference
- IP preference
- Content-type preference
- Consumption pattern
- Active-time preference
- Device preference
- Region preference
- Negative preference
- Not-interested state
- Personalization controls
- Personalization opt-out
- Cold-start profile
- Preference rebuild

Personalization is the user-state layer; recommendation is the decision/ranking layer.

---

# 24. Trending / Hot Topics

## L2
- Hot events
- Hot search
- Hot lists
- Category rankings
- Creator rankings
- Content rankings
- Video rankings
- IP rankings
- Community rankings
- Real-time trends
- Trend acceleration
- Trend history
- Trend prediction
- Anti-brush ranking
- Ranking operations
- Ranking explanations
- Ranking eligibility
- Regional rankings
- Personalized trending

Trending must remain distinct from recommendation so platform-wide popularity can be audited independently.

---

# 25. Search / Discovery

## L2
- Full-text search
- Creator search
- Content search
- IP search
- Community search
- Product search
- User search
- Suggestion
- Autocomplete
- Query correction
- Semantic search
- Search ranking
- Search filters
- Search history
- Search privacy
- Search safety
- Search analytics
- Search experiments

---

# 26. Live / Realtime / IM

## L2
- Live session
- Live scheduling
- Live practice
- Live audio
- Live video
- Co-hosting
- Audience admission
- Live chat
- Live reactions
- Live moderation
- Live replay
- Highlights
- Live discovery
- Live membership
- Live gifts/tips where enabled
- Direct messages
- Group messaging
- Realtime presence
- Typing/read state
- Message moderation
- Message retention

---

# 27. Notification

## L2
- In-app notifications
- Push notifications
- Email notifications
- SMS/provider notifications
- Creator notifications
- Fan notifications
- Membership notifications
- Moderation notifications
- Rights notifications
- Commerce notifications
- Security notifications
- Notification preferences
- Notification batching
- Notification deduplication
- Notification fanout
- Notification delivery status

---

# 28. Safety / Risk / Trust

## L2
- Account risk
- Device risk
- Login risk
- Behavior risk
- Content risk
- Interaction risk
- Event trust
- Spam detection
- Bot detection
- Abuse detection
- Fraud detection
- Reputation
- Trust tiers
- Enforcement policy
- Risk actions
- Risk evidence
- Risk appeal linkage
- Risk model lifecycle

---

# 29. Content Moderation / Appeals

## L2
- Policy taxonomy
- Automated moderation
- Human review
- Review queues
- Priority routing
- Content decision
- Account decision
- Comment decision
- Live decision
- Community decision
- Enforcement
- Warning
- Restriction
- Removal
- Restoration
- Appeal
- Appeal evidence
- Appeal decision
- Moderator audit
- Policy versioning

---

# 30. Copyright / Rights

## L2
- Rights-holder identity
- Ownership evidence
- Copyright registration reference
- Content fingerprint
- Match detection
- Claim
- Counterclaim
- Takedown
- Restoration
- Licensing
- License scope
- Territory
- Time window
- Derivative rights
- Remix authorization
- Revenue share
- Rights revocation
- Rights dispute
- Rights audit

---

# 31. Creator & IP Marketplace

## L2
- Creator discovery
- IP discovery
- Brand demand
- Creator quote
- Collaboration invitation
- Project creation
- Campaign procurement
- Content procurement
- IP licensing demand
- Brand cooperation
- Creator/MCN matching
- Contract workflow
- Delivery
- Acceptance
- Evaluation
- Dispute
- Settlement linkage

---

# 32. Brand Collaboration

## L2
- Brand identity
- Brand account
- Collaboration demand
- Creator recruitment
- Creator matching
- Brief
- Quote
- Proposal
- Campaign
- Content task
- Review
- Delivery
- Performance
- Contract
- Rights scope
- Settlement
- Dispute
- Brand analytics

---

# 33. Campaign / Activity

## L2
- Activity identity
- Challenge
- Topic campaign
- Creator campaign
- Brand campaign
- Live event
- Competition
- Task
- Eligibility
- Registration
- Reward
- Points
- Leaderboard
- Activity content
- Activity moderation
- Activity analytics
- Activity settlement
- Activity lifecycle

---

# 34. Monetization / Commerce / Creator Economy

## L2
- Advertising revenue share
- Creator subscriptions
- Memberships
- Tips/rewards
- Virtual goods
- Paid content
- Paid events
- Shopping
- Product tagging
- Creator stores
- Affiliate commerce
- Brand campaigns
- IP licensing
- Digital goods
- Creator services
- Revenue attribution
- Refunds
- Chargebacks
- Tax metadata

---

# 35. Advertising Platform

## L2
- Advertiser identity
- Ad account
- Campaign
- Ad group
- Creative
- Placement
- Targeting
- Audience
- Budget
- Bid
- Auction
- Impression
- Click
- Conversion
- Attribution
- Frequency control
- Brand safety
- Fraud prevention
- Billing
- Settlement
- Advertiser analytics
- Experimentation

Advertising must remain a separate product domain from creator monetization because advertiser-side state, auction logic, attribution, billing, and fraud have different correctness requirements.

---

# 36. Wallet / Ledger / Settlement

## L2
- Wallet
- Balance
- Pending balance
- Available balance
- Ledger entry
- Double-entry accounting boundary
- Revenue attribution
- Revenue share
- Creator settlement
- MCN settlement
- Brand settlement
- IP settlement
- Refund
- Chargeback
- Adjustment
- Tax record
- Payout request
- Payout status
- Reconciliation
- Dispute
- Audit

---

# 37. Personal Content Space

## L2
- Favorites
- Favorite collections
- Playlists
- Reading history
- Watch history
- Listen history
- Search history
- Watch later
- Liked content
- Saved posts
- Downloads
- Offline state
- Personal drafts
- Personal creations
- Personal IP
- Privacy controls
- History deletion
- Cross-device synchronization

---

# 38. Podcast / Audio

## L2
- Podcast identity
- Audio channel
- Episode
- Audio series
- Season
- RSS feed
- Podcast distribution
- Audio subscription
- Podcast discovery
- Audio search
- Audio recommendations
- Audio chapters
- Transcripts
- Audio analytics
- Audio monetization
- Audio rights

---

# 39. Analytics / Experiment / Growth

## L2
- Event analytics
- Content analytics
- Creator analytics
- IP analytics
- Community analytics
- Fan analytics
- Commerce analytics
- Advertising analytics
- Funnel analytics
- Cohort analytics
- Retention
- Conversion
- Experiment definition
- A/B testing
- Feature flags
- Metric definitions
- Attribution
- Experiment guardrails
- Experiment audit

---

# 40. Platform / Open Ecosystem / Operations

## L2
- Platform operations
- Governance
- Configuration
- Policy management
- Feature flags
- Incident management
- Reliability
- Observability
- Audit
- Data governance
- Data quality
- Cost governance
- API platform
- Developer accounts
- API keys
- OAuth/apps
- Webhooks
- SDKs
- Developer console
- Mini-app platform
- App marketplace
- Game platform
- Game publishing
- Game accounts
- Game entitlements
- Creator tool marketplace
- AI capability platform
- Localization
- Internationalization
- Regional deployment

---

# 41. Cross-Domain Product Invariants

The following are mandatory across all 40 L1 domains:

1. Identity invariant
2. Ownership invariant
3. Authorization invariant
4. Lifecycle invariant
5. Idempotency invariant
6. Event invariant
7. Derived-state invariant
8. Trust invariant
9. Rights invariant
10. Money invariant
11. Audit invariant
12. Privacy invariant
13. Cost invariant
14. Isolation invariant
15. Portability invariant
16. Recovery invariant
17. Observability invariant
18. Acceptance invariant
19. Provenance invariant
20. Policy-version invariant
21. Regional-policy invariant
22. Data-retention invariant
23. Anti-abuse invariant
24. Experiment-consistency invariant

---

# 42. Mainstream Reverse-Audit Closure Matrix

| Product capability | Mainstream evidence pattern | LuckRead strengthened boundary | Status |
|---|---|---|---|
| Long-form + short-form content | Articles, posts, video, long-form surfaces | Content + Production + Show/Series | CLOSED |
| Live audio/video | Spaces, live streams, chat, replay | Live / Realtime / IM | CLOSED |
| Creator subscriptions | Paid subscriptions, exclusive content, subscriber-only interaction | Fan Relationship + Monetization | CLOSED |
| Multi-level memberships | Tiered membership and member-only media | Fan Relationship / Membership | CLOSED |
| Shopping | Product tags, creator stores, live/video commerce | Monetization / Commerce | CLOSED |
| Creator growth | Creator programs, education, feature adoption | Creator Growth / Success | CLOSED |
| Communities | Topic communities, roles, moderation | Community | CLOSED |
| Articles / multimedia long-form | Rich long-form with media, links and audience controls | Content + Production | CLOSED |
| Creator tools | Studio, editing, analytics, publishing tools | Creator Studio + Creator Tools | CLOSED |
| Recommendation | Personalized discovery and ranking | Recommendation + Personalization | CLOSED |
| Trending | Platform-wide hot topics/rankings | Trending / Hot Topics | CLOSED |
| Search/discovery | Search, suggestions, semantic discovery | Search / Discovery | CLOSED |
| Copyright | Claims, appeals, rights controls | Copyright / Rights | CLOSED |
| Advertising | Campaign, targeting, placement, attribution, billing | Advertising Platform | CLOSED |
| Creator-brand collaboration | Campaigns, creator matching, procurement | Marketplace + Brand Collaboration | CLOSED |
| Fan economy | Membership, badges, exclusive access | Fan Relationship + Creator Economy | CLOSED |
| Remix / derivative works | Quote/remix/adaptation/response patterns | Content Relations / Remix | CLOSED |
| Podcast/audio | Podcast/channel/episode distribution | Podcast / Audio | CLOSED |
| Personal library | History, saved content, playlists, offline | Personal Content Space | CLOSED |
| Unified IP/entity surface | Creator/IP/content/community/product aggregation | Entity / Unified Profile + IP Graph | CLOSED |

---

# 43. KEEP / SPLIT / MERGE / ADD Decision

## KEEP

Keep the existing major domains for:
- Identity
- Creator
- Organization/MCN
- Content
- Content Graph
- IP Graph
- Media
- Social Graph
- Community
- Interaction
- Feed
- Recommendation
- Risk/Trust
- Safety/Moderation/Appeal
- Copyright/Rights
- Live/Realtime/IM
- Search/Discovery
- Notification
- Monetization/Commerce
- Ledger/Settlement
- Analytics/Experiment/Growth
- APP/Localization
- Platform Operations/Governance
- Open Platform/Apps/Games

## SPLIT

Split previously compressed responsibilities into independently governable product domains:
- Creator -> Creator Growth / Success
- Creator Studio -> Creator Tools / Production Ecosystem
- Content Graph -> Content Relations / Remix Graph
- IP Graph -> Entity / Unified Profile + IP Economy
- Feed/Recommendation -> Personalization + Trending / Hot Topics
- Monetization -> Advertising Platform + Creator/IP Marketplace + Brand Collaboration
- Media -> Podcast / Audio
- Content -> Show / Series / Program
- Interaction/Personalization -> Personal Content Space
- Organization/MCN -> Campaign / Activity where campaign behavior is independently operated

## MERGE

Do not create redundant domains for:
- generic counters
- generic favorites
- generic ranking implementation
- generic storage adapters
- generic queue implementation
- generic cache implementation
- generic AI model providers

These remain implementation/infrastructure concerns beneath product domains.

## ADD

The strengthened baseline formally adds:
- Creator Growth / Success
- Creator Tools / Production Ecosystem
- Content Production
- Content Relations / Remix Graph
- Show / Series / Program
- Entity / Unified Profile
- Fan Relationship / Membership
- Personalization
- Trending / Hot Topics
- Creator & IP Marketplace
- Brand Collaboration
- Campaign / Activity
- Advertising Platform
- Personal Content Space
- Podcast / Audio

---

# 44. Priority Classification

## P0 — platform completeness

- User Identity
- Device / Session / Privacy
- Creator
- Creator Studio
- Creator Growth / Success
- Creator Tools / Production Ecosystem
- Organization / MCN
- Content
- Content Production
- Content Relations / Remix Graph
- Show / Series / Program
- IP Graph / IP Economy
- Entity / Unified Profile
- Media
- Media Processing
- Social Graph
- Fan Relationship / Membership
- Community
- Interaction
- Event / High-Frequency Interaction
- Feed / Distribution
- Recommendation
- Personalization
- Trending / Hot Topics
- Search / Discovery
- Live / Realtime / IM
- Notification
- Safety / Risk / Trust
- Content Moderation / Appeals
- Copyright / Rights
- Monetization / Commerce / Creator Economy
- Wallet / Ledger / Settlement
- Personal Content Space
- Analytics / Experiment / Growth
- Platform / Open Ecosystem / Operations

## P1 — ecosystem expansion

- Creator & IP Marketplace
- Brand Collaboration
- Campaign / Activity
- Advertising Platform
- Podcast / Audio
- advanced creator services
- advanced developer ecosystem
- advanced game ecosystem
- advanced AI creator capabilities

## P2 — advanced ecosystem

- third-party creator tool marketplace
- advanced ad exchange capabilities
- enterprise brand platform
- advanced creator education marketplace
- advanced professional services marketplace
- advanced cross-platform distribution network

Priority does not mean implementation authorization. Every capability still passes the five PASS gates.

---

# 45. Contract Readiness Gate

Before implementation begins, every L2 capability must satisfy:

- mapped to L3/L4
- explicit authoritative state
- explicit derived state
- explicit owner
- explicit API boundary where externally visible
- explicit event boundary where asynchronous
- explicit authorization
- explicit privacy rule
- explicit rights rule where applicable
- explicit money/ledger rule where applicable
- explicit risk/moderation rule where applicable
- explicit cost model
- explicit latency target
- explicit idempotency rule
- explicit recovery behavior
- explicit observability
- explicit test/acceptance criteria

## Admission chain

```text
L1/L2 completeness
→ L3/L4 traceability
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security Contract
→ Cost/Runtime Contract
→ Test/Acceptance Contract
→ Architecture PASS
→ Contract PASS
→ Code PASS
→ CI PASS
→ User Acceptance PASS
```

---

# 46. Horizontal Expansion Stop Rule

This document is the strengthened L1/L2 baseline.

**Do not continue adding L1/L2/L3/L4 horizontally merely because another platform exposes another feature name.**

Future requirements must:

1. map to an existing L1/L2 capability;
2. extend an existing L3/L4 responsibility; or
3. pass explicit architecture review for a genuinely new product responsibility.

No L5 layer is authorized.

---

# 47. Mainstream Capability Evidence

The reverse audit is grounded in public product documentation from mainstream platforms. Examples include X documentation covering posts, Communities, Spaces, live video, DMs, subscriptions, long-form Articles and creator monetization; YouTube documentation covering creator features, live, memberships, Shopping, podcasts and monetization.

This evidence is used to validate product responsibility boundaries, not to copy proprietary implementation details.
