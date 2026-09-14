# D21 Advertising Platform Contract v1.0

## 0. Contract Status

- Domain: D21 Advertising Platform
- Status: CONTRACT-FROZEN
- Source of truth: this contract
- Implementation rule: Contract → Machine-readable schema/API → CI → implementation
- D1-Fabric is explicitly outside this project boundary.

## 1. Domain Boundary

D21 owns advertising commercial transaction and delivery infrastructure:

- Advertiser
- Agency / client relationships
- Campaign / Ad Group
- Creative references and advertising creative lifecycle
- Audience definitions and versions
- Inventory / Placement / Ad Slot
- Demand Source
- Eligibility
- Auction / Pricing
- Delivery decisions
- Frequency / Pacing
- Advertising traffic validity
- Attribution
- Advertising billing ledger
- Advertising reporting views
- External demand adapters
- Advertising disputes / appeals
- Advertising reconciliation
- Advertising evidence and operational kill switches

D21 does NOT own:

- D01 identity/account state
- D02 authorization decisions
- D03 organization/membership
- D04 content lifecycle
- D05 media object storage/processing
- D13 platform-wide moderation/risk governance
- D14 analytics intelligence/source
- D15 payment/settlement/payout execution
- D20 creator/IP/MCN rights
- D22 commerce

D21 may consume these domains through explicit contracts, but MUST NOT duplicate their source-of-truth facts.

## 2. Core Invariants

1. Raw advertising event ≠ valid advertising event ≠ billable event ≠ finalized billing.
2. Unvalidated traffic MUST NOT create irreversible final advertising cost.
3. INVALID traffic MUST NOT enter final settlement.
4. Delayed fraud discovery MUST use reversal/adjustment; historical facts MUST remain immutable.
5. Advertising billing is not payment. D21 produces billable facts; D15 executes payment/settlement.
6. Advertising risk is not the platform-wide risk system. D13 owns platform risk governance; D21 owns advertising-specific traffic-quality enforcement.
7. Organic recommendation and sponsored advertising MUST remain distinguishable.
8. External demand sources MUST enter through the D21 Demand Contract / Adapter boundary.
9. External platforms MUST NOT directly mutate D21 billing, budget, reward, authorization or settlement facts.
10. Every delivery and billing decision MUST have a traceable evidence chain.
11. Campaign, creative, audience, auction, pricing and policy configurations MUST be versioned where required for historical replay.
12. Core failures MUST fail safe, not fail open.
13. Internal/local API paths MUST NOT bypass authorization except explicitly controlled, audited system operations.
14. Cross-tenant and cross-organization access MUST be denied by default.
15. Advertiser billing history MUST be append-only; corrections use adjustment/reversal records.

## 3. Platform Planes

D21 is divided into:

1. Management Plane
2. Delivery Plane
3. Demand Plane
4. Traffic Quality Plane
5. Attribution Plane
6. Billing Safety Plane
7. External Adapter Plane
8. Reporting Plane
9. Evidence / Governance Plane

## 4. Kernel Execution Units

The implementation is organized into ten bounded kernels:

- K01 Advertiser Kernel
- K02 Campaign Kernel
- K03 Creative & Audience Kernel
- K04 Inventory & Placement Kernel
- K05 Delivery & Auction Kernel
- K06 Traffic Validity Kernel
- K07 Attribution Kernel
- K08 Advertising Billing Kernel
- K09 External Demand Kernel
- K10 Reporting / Dispute / Evidence Kernel

The kernel split controls code boundaries; it does not require one Worker per kernel.

## 5. Advertiser Contract

Advertiser types:

- PERSONAL
- CREATOR
- ORGANIZATION
- ENTERPRISE
- AGENCY
- PARTNER

Advertiser states:

- CREATING
- ACTIVE
- MONITORING
- RESTRICTED
- SUSPENDED
- CLOSED

An Advertiser Account is distinct from a User account and may have scoped members.

Advertiser roles include:

- OWNER
- ADMIN
- CAMPAIGN_MANAGER
- CREATIVE_MANAGER
- ANALYST
- BILLING
- AUDITOR

Agency access MUST be explicitly scoped to authorized client advertiser accounts.

## 6. Campaign Contract

Campaign objectives:

- AWARENESS
- TRAFFIC
- ENGAGEMENT
- VIDEO_VIEW
- APP_INSTALL
- LEAD
- CONVERSION
- SALES
- CREATOR_GROWTH
- CONTENT_PROMOTION

Campaign states:

`DRAFT → SUBMITTED → REVIEWING → APPROVED → ACTIVE → PAUSED → ACTIVE → COMPLETED`

Exceptional states:

- REJECTED
- SUSPENDED
- CANCELLED
- EXPIRED

Illegal direct transitions such as `DRAFT → ACTIVE`, `REJECTED → ACTIVE`, or `CANCELLED → ACTIVE` MUST be rejected.

Campaign configuration MUST support versioned budget, schedule, objective, audience, placement and bidding policy where historical replay requires it.

## 7. Budget Contract

Budget models:

- DAILY_BUDGET
- LIFETIME_BUDGET
- CAMPAIGN_BUDGET
- AD_GROUP_BUDGET

Budget accounting MUST distinguish:

- AVAILABLE
- RESERVED
- PENDING
- VALIDATED
- BILLED
- REVERSED

Reservation states:

- RESERVED
- COMMITTED
- RELEASED
- EXPIRED

Concurrent reservation MUST be atomic. Negative effective balance MUST be impossible.

Reservation expiration MUST release unused reservations safely.

## 8. Ad Group Contract

Ad Group is a separately addressable delivery/ranking unit under Campaign.

It MUST NOT become an independent payment system or authorization system.

## 9. Creative Contract

Creative states:

`DRAFT → SUBMITTED → REVIEWING → APPROVED → ACTIVE`

Exceptional states:

- REJECTED
- SUSPENDED
- ARCHIVED

Creative MUST reference Media through D05 contracts. It MUST NOT duplicate R2 object ownership or processing facts.

A creative can have immutable versions. Published versions MUST NOT be silently rewritten.

Creative activation requires applicable moderation/policy approval.

## 10. Audience Contract

Audience is an advertising targeting definition, not a direct copy of user-private data.

Audience MUST respect:

- authorization
- consent/privacy policy
- allowed signals
- tenant scope
- policy restrictions

Audience definitions MUST be versioned when used for historical delivery or attribution replay.

Initial audience types:

- ALL_USERS
- CUSTOM_AUDIENCE
- LOOKALIKE_AUDIENCE
- CREATOR_AUDIENCE
- INTEREST_AUDIENCE
- CONTENT_AUDIENCE
- RETARGETING

## 11. Inventory / Placement Contract

Inventory represents an advertising supply category. Placement represents a concrete placement policy. Ad Slot represents a concrete display slot.

Examples:

- ARTICLE / ARTICLE_TOP / ARTICLE_TOP_01
- ARTICLE / ARTICLE_MIDDLE / ARTICLE_MIDDLE_01
- VIDEO / PRE_ROLL / VIDEO_PRE_ROLL_01
- LIVE / LIVE_ROOM / LIVE_ROOM_01
- SEARCH / SEARCH_RESULT / SEARCH_RESULT_01
- MINI_APP / MINI_APP_AD / MINI_APP_AD_01
- GAME / GAME_AD / GAME_AD_01

Inventory/Placement MUST declare compatible formats, devices, policy and status.

## 12. Ad Formats

Initial formats:

- BANNER
- NATIVE
- VIDEO
- REWARDED_VIDEO
- INTERSTITIAL
- SEARCH_AD
- SPONSORED_CONTENT
- SPONSORED_CREATOR
- LIVE_AD
- GAME_AD
- MINI_APP_AD

Format, Creative and Placement are separate concepts.

## 13. Demand Source Contract

Demand sources:

- LUCKREAD_DIRECT
- GOOGLE
- CJ
- OPENRTB
- DSP
- SSP
- PARTNER

Demand Source is not necessarily an Advertiser. External ecosystems may represent third-party advertisers.

External demand MUST be normalized into the D21 Demand Contract before eligibility/auction.

## 14. External Adapter Contract

External adapters expose capability-based integration rather than provider-specific core logic.

Minimum adapter operations:

- authenticate
- connect
- disconnect
- health
- capabilities
- syncAccount
- syncCampaign
- syncCreative
- syncInventory
- sendEvent
- fetchReport
- reconcile

A provider may support only a subset. Unsupported capabilities MUST be explicit rather than silently emulated.

External adapter failures MUST be isolated with timeout, retry and circuit-breaker behavior.

## 15. Delivery Contract

Management APIs and Delivery APIs are separate surfaces.

Delivery request MUST carry only required context, for example:

- inventory_id
- placement_id
- client_type
- client_version
- authorized context
- request_id / trace context

Delivery pipeline:

`Request → Inventory → Candidate Generation → Eligibility → Policy → Risk → Budget → Frequency → Auction → Pricing → Winner → Delivery`

A delivery decision MUST have a unique `decision_id`.

## 16. Eligibility Contract

A candidate may enter auction only when applicable conditions are satisfied:

- Campaign ACTIVE
- Ad Group ACTIVE
- Creative APPROVED/ACTIVE
- Placement compatible
- Audience eligible
- Budget available/reservable
- Frequency allowed
- Policy allowed
- Traffic eligible
- Required consent/privacy conditions satisfied

Failure produces a deterministic reason code where possible.

## 17. Auction Contract

Initial auction is deterministic/rule-based. Complex ML ranking is future capability and MUST NOT be implemented ahead of its contract.

Candidate fields may include:

- demand_source
- advertiser_id
- campaign_id
- ad_group_id
- creative_id
- placement_id
- bid
- bid_type
- estimated_value
- eligibility
- risk_score
- policy_version

Auction must have:

- auction_version
- deterministic tie-break rules
- reproducible decision metadata

Future providers may be exposed through `AuctionProvider`, `RankingProvider` and `PricingProvider` contracts.

## 18. Pricing Contract

Pricing is separate from bidding.

Initial pricing models:

- CPM
- CPC
- CPV
- CPA
- CPI
- CPE

`bid` MUST NOT be assumed equal to final charge.

## 19. Frequency / Pacing Contract

Frequency caps may be applied at:

- user
- device
- session
- campaign
- creative

Initial pacing mode may be EVEN. Future SMART pacing MUST use a versioned strategy contract.

## 20. Sponsored / Organic Boundary

Sponsored advertising MUST remain distinguishable from organic content/recommendation.

Delivery response MUST expose an explicit sponsorship/disclosure indicator where required, for example:

```json
{
  "disclosure": {
    "is_sponsored": true,
    "label": "广告"
  }
}
```

D12 owns organic recommendation. D21 owns sponsored auction/delivery. Feed assembly may consume both but MUST NOT erase the distinction.

## 21. Traffic Event Contract

Minimum advertising facts:

- impression
- click
- conversion

Each event requires a unique event identity and idempotency semantics.

Required linkage fields include, where applicable:

- event_id
- event_type
- advertiser_id
- campaign_id
- creative_id
- placement_id
- request_id
- decision_id
- occurred_at
- idempotency_key

## 22. Traffic Validity Contract

Traffic validity states:

- PENDING
- VALID
- SUSPICIOUS
- INVALID
- REVERSED

`PENDING != VALID` and `VALID != BILLABLE`.

D13 provides platform-level risk governance. D21 applies advertising-specific traffic-quality and billability rules.

Signals may include:

- velocity
- device pattern
- IP/network pattern
- session pattern
- click interval
- impression-to-click ratio
- click-to-conversion pattern
- account age
- client integrity
- historical risk
- cluster behavior

Human-like coordinated fraud MUST be considered; IP-only filtering is insufficient.

## 23. Billing Safety Contract

Billing state flow:

`PENDING → VALID → BILLABLE → FINALIZED`

Alternative/exception states:

- INVALID
- SUSPICIOUS
- REVERSED
- ADJUSTED

Fraud-engine outage MUST leave events pending/safe rather than auto-marking them billable.

## 24. Billing Ledger Contract

Advertising billing is append-only.

Ledger entry types may include:

- CHARGE
- RESERVATION
- RELEASE
- REFUND
- ADJUSTMENT
- REVERSAL

Historical entries MUST NOT be overwritten to hide corrections.

Every finalized billing entry MUST reference the evidence needed to reconstruct why it was billable.

## 25. D15 Payment Boundary

D21 produces advertising billing facts and billable amounts.

D15 owns:

- payment method
- payment authorization
- payment provider
- refund execution
- settlement
- payout

D21 MUST NOT directly mutate D15 payment balances.

## 26. Attribution Contract

Conversion attribution pipeline:

`Impression → Click → Landing → Install/Action → Qualified Conversion → Attribution`

Initial model:

- LAST_CLICK

Future versioned models may include:

- FIRST_CLICK
- VIEW_THROUGH
- MULTI_TOUCH
- CUSTOM

Every attribution decision MUST record model version, attribution window and policy version.

## 27. Reporting Contract

D21 exposes advertising views including:

- campaign performance
- creative performance
- placement performance
- traffic quality
- spend protection
- attribution
- billing

D21 reporting is a domain view. D14 remains the analytics/event-intelligence source.

Advertiser exports MUST honor authorization, tenant scope, privacy and data scope.

Supported export shapes may include CSV, JSON and API responses.

## 28. Advertiser Dashboard Contract

The dashboard MUST distinguish at least:

- impressions
- total clicks
- pending traffic
- valid traffic
- suspicious traffic
- invalid traffic
- reversed traffic
- conversions
- reserved budget
- pending amount
- finalized spend
- filtered amount
- adjusted/reversed amount

The UI MUST NOT imply mathematical 100% fraud prevention. The protection promise is that unvalidated traffic does not directly become irreversible final cost.

## 29. Delivery Diagnostics

Advertisers SHOULD be able to inspect structured reasons for low/no delivery, such as:

- campaign inactive
- creative not approved
- budget unavailable
- audience mismatch
- placement mismatch
- frequency capped
- policy blocked
- risk blocked
- auction competitiveness
- demand source unavailable

Diagnostics MUST NOT expose sensitive anti-fraud signals that would materially enable evasion.

## 30. Dispute / Appeal Contract

Dispute categories:

- BILLING
- TRAFFIC
- ATTRIBUTION
- MODERATION
- DELIVERY
- ACCOUNT

Dispute flow:

`OPEN → UNDER_REVIEW → EVIDENCE_REQUIRED → RESOLVED / REJECTED / ESCALATED`

Original facts remain immutable. Resolution may create refund/credit/adjustment records through the appropriate domain.

Advertising moderation appeals are separate from billing disputes even when they reference the same campaign.

## 31. Reconciliation Contract

D21 must reconcile:

`Raw Events ↔ Validity Ledger ↔ Billing Ledger ↔ Advertiser Ledger ↔ D15 Settlement`

External reconciliation additionally compares:

`External Report ↔ Internal Event / Billing Facts`

Result states:

- MATCHED
- MINOR_VARIANCE
- MATERIAL_VARIANCE
- DISPUTED

Silent correction is prohibited. Material mismatches create auditable alerts.

## 32. Advertiser Ledger Contract

Advertiser account financial views must distinguish:

- credits
- reservations
- releases
- finalized charges
- refunds
- adjustments

A mutable `balance` field MUST NOT be the sole source of truth.

## 33. Privacy / Consent Contract

Advertising targeting and measurement MUST pass:

`User Data → Consent/Policy → Allowed Signals → Audience/Measurement`

The system must support explicit consent state handling where applicable, including consent granted/revoked and restricted processing modes.

D21 MUST NOT expose or export data outside the advertiser's authorized scope.

## 34. Permission Contract

D21 permissions include, at minimum:

- advertising.read/create/update/delete
- campaign.read/create/update/publish/pause/cancel
- creative.read/create/update/submit/appeal
- audience.read/create/update
- billing.read/export
- report.read/export
- dispute.create/read/appeal

Authorization follows D02:

`Identity → Account State → Organization → Role → Permission → Entitlement → Scope → Policy → Decision`

Local/internal APIs MUST NOT bypass this chain except controlled system operations that are explicitly audited and tested.

## 35. Event Contract

Minimum events:

- advertising.account.created
- advertising.account.updated
- advertising.campaign.created
- advertising.campaign.updated
- advertising.campaign.submitted
- advertising.campaign.approved
- advertising.campaign.rejected
- advertising.campaign.activated
- advertising.campaign.paused
- advertising.campaign.completed
- advertising.creative.created
- advertising.creative.approved
- advertising.creative.rejected
- advertising.impression.recorded
- advertising.click.recorded
- advertising.conversion.recorded
- advertising.risk.evaluated
- advertising.traffic.validated
- advertising.traffic.invalidated
- advertising.traffic.reversed
- advertising.billing.created
- advertising.billing.finalized
- advertising.billing.adjusted
- advertising.dispute.created
- advertising.dispute.resolved
- advertising.reconciliation.detected

Events MUST be versioned and idempotently consumable.

Event envelope MUST include, where applicable:

- event_id
- event_type
- event_version
- occurred_at
- tenant_id
- organization_id
- actor_id
- subject_id
- request_id
- trace_id
- idempotency_key
- producer
- payload

## 36. Error Contract

Minimum error codes:

- ADVERTISER_NOT_FOUND
- ADVERTISER_FORBIDDEN
- CAMPAIGN_NOT_FOUND
- CAMPAIGN_INVALID_STATE
- CREATIVE_NOT_FOUND
- CREATIVE_NOT_APPROVED
- AUDIENCE_NOT_FOUND
- AUDIENCE_NOT_ELIGIBLE
- PLACEMENT_NOT_FOUND
- PLACEMENT_NOT_ELIGIBLE
- BUDGET_EXCEEDED
- BUDGET_RESERVATION_FAILED
- FREQUENCY_LIMIT_REACHED
- POLICY_BLOCKED
- RISK_BLOCKED
- INVALID_TRAFFIC
- AUCTION_UNAVAILABLE
- DEMAND_SOURCE_UNAVAILABLE
- BILLING_NOT_FINAL
- ATTRIBUTION_INVALID
- DUPLICATE_EVENT
- IDEMPOTENCY_CONFLICT
- EXTERNAL_SYNC_FAILED
- RECONCILIATION_REQUIRED

All APIs use the common error envelope and retryability semantics defined by the platform API contract.

## 37. Operations / Kill Switch / Degradation

Operational kill switches must support scoped shutdown of:

- campaign
- ad group
- creative
- placement
- advertiser
- demand source
- external adapter

External demand failures must not automatically take down Luckread Direct.

Required resilience controls:

- timeout
- retry with bounded attempts
- circuit breaker
- backpressure
- safe degradation
- dead-letter/replay strategy where asynchronous processing is used

## 38. Security / Execution Probes

Mandatory negative tests include:

1. cross-tenant advertiser access denied
2. cross-organization campaign access denied
3. agency access outside client scope denied
4. unauthorized budget modification denied
5. budget reservation race cannot overspend
6. duplicate click cannot double bill
7. duplicate conversion cannot double attribute/bill
8. PENDING traffic cannot finalize billing
9. INVALID traffic cannot enter final settlement
10. delayed fraud reversal creates adjustment rather than mutating history
11. local API cannot bypass authorization
12. suspended advertiser cannot deliver ads
13. rejected creative cannot deliver
14. frequency cap cannot be bypassed by retries
15. external adapter cannot directly mutate core billing
16. organic content cannot be silently labeled as sponsored or vice versa
17. malformed/tampered delivery context is rejected
18. expired configuration versions cannot silently rewrite historical evidence

Execution Probe MUST exercise actual routes and deployed test runtime, not only mocks.

## 39. SLO / Cost / Consistency

Runtime thresholds MUST be measured and evidenced rather than invented before production observations exist.

Required measurements:

- delivery latency P50/P95/P99
- auction latency
- risk/validity latency
- billing processing latency
- external adapter latency
- duplicate event rate
- invalid/reversal rate
- budget reservation conflicts
- reconciliation mismatch rate
- queue lag
- cache hit/miss where used
- D1/R2/Worker query and storage cost

Consistency requirements:

- budget reservation and billing are concurrency-safe
- billing history is append-only
- validity decisions are traceable to event IDs
- attribution is versioned/replayable
- external reports are reconcilable
- finalized billing has complete evidence

## 40. Evidence / CI Gate

D21 is GREEN only when all required evidence exists:

- machine-readable domain/schema registry
- OpenAPI validates
- API error/pagination/cursor contracts validate
- permission matrix validates
- state-machine tests pass
- event schema tests pass
- tenant isolation tests pass
- authorization negative tests pass
- concurrency/budget reservation tests pass
- idempotency tests pass
- traffic validity tests pass
- delayed reversal tests pass
- billing finality tests pass
- attribution tests pass
- external adapter failure tests pass
- reconciliation tests pass
- security probes pass
- execution probe passes against the actual runtime
- Evidence Registry records commit SHA, workflow run, test results and contract version

`UNKNOWN`, `MISSING`, `NOT_RUN` or `FAILED` evidence MUST remain `BLOCKED`/`INCOMPLETE` and MUST NOT be treated as GREEN.

## 41. Implementation Order Freeze

The required implementation sequence is:

`Contract Registry → Common Schema → Error Contract → OpenAPI Skeleton → Permission Matrix → K01 Advertiser → K02 Campaign → K03 Creative/Audience → K04 Inventory/Placement → K05 Delivery/Auction → K06 Traffic Validity → K07 Attribution → K08 Advertising Billing → K09 External Demand → K10 Reporting/Dispute/Evidence`

The first end-to-end shadow path is:

`Advertiser → Campaign → Creative → Placement → Ad Request → Eligibility → Rule Auction → Impression → Click → PENDING → VALID → BILLABLE → FINALIZED`

Real billing must not be enabled until shadow validation and evidence gates pass.

## 42. Shadow / Limited Live / Live Gate

D21 lifecycle:

`DESIGN → CONTRACT_FROZEN → SCHEMA_READY → IMPLEMENTING → SHADOW → VALIDATING → LIMITED_LIVE → LIVE`

Shadow mode may execute real delivery, auction, traffic validation and simulated billing without creating real advertiser charges.

Limited live may restrict campaigns, budget, placements and demand sources.

Promotion to LIVE requires evidence for security, billing consistency, reconciliation, execution and operational readiness.

## 43. Explicitly Deferred

The following are contract extension points, not first-release implementation requirements:

- ML auction/ranking
- advanced fraud models
- dynamic budget optimization
- advanced lookalike modeling
- multi-touch attribution beyond the initial contract
- large-scale DSP/SSP ecosystem expansion
- automatic intelligent pacing

They MUST NOT be implemented early merely because the interfaces are reserved.

## 44. Contract Freeze Rule

After this contract is frozen, implementation MUST NOT silently introduce a new D21 source of truth, permission path, billing path, risk path, event schema, state transition or external integration boundary.

Any change requires:

`Contract Change → Version Update → Schema/API/Event Impact Review → CI Update → Implementation → Evidence`

This contract is the controlling D21 design boundary for subsequent development.
