# LUCKREAD Blueprint Enhancement — Batch 07

## Status
CLOSED / CONTRACT-FIRST READY

## Reconciliation rule
The repository already contains a frozen D21 Advertising Platform contract and related permission, event, state-machine and machine-readable contract assets. This batch does **not** create a competing advertising authority. It extends the master blueprint by mapping mainstream advertising/brand/creator-marketplace capabilities onto the existing D21 contracts and the canonical Creator, Rights, Content, Analytics, Risk, Pay and Audit authorities.

## Feature IDs
- ADVERTISING-001 Advertiser identity and organization
- ADVERTISING-002 Advertising account
- ADVERTISING-003 Billing profile and budget policy
- ADVERTISING-004 Campaign
- ADVERTISING-005 Ad group / delivery strategy
- ADVERTISING-006 Creative and creative review
- ADVERTISING-007 Inventory / placement
- ADVERTISING-008 Sponsored content
- ADVERTISING-009 Audience / targeting policy
- ADVERTISING-010 Campaign scheduling and pacing
- ADVERTISING-011 Delivery
- ADVERTISING-012 Impression / view / click measurement
- ADVERTISING-013 Conversion and attribution
- ADVERTISING-014 Traffic-quality and advertising fraud controls
- ADVERTISING-015 Advertiser analytics and reporting
- ADVERTISING-016 External advertising provider adapter
- ADVERTISING-017 Disclosure / sponsored labeling
- BRAND-001 Brand profile
- BRAND-002 Collaboration brief
- BRAND-003 Collaboration demand
- BRAND-004 Creator / IP matching
- BRAND-005 Creator proposal
- BRAND-006 Quote and negotiation
- BRAND-007 Collaboration contract
- BRAND-008 Sponsored delivery
- BRAND-009 Delivery review and acceptance
- BRAND-010 Collaboration performance
- BRAND-011 Brand / creator analytics
- BRAND-012 Brand safety policy
- MARKETPLACE-001 Creator marketplace discovery
- MARKETPLACE-002 IP marketplace discovery integration
- MARKETPLACE-003 Creator eligibility and matching
- MARKETPLACE-004 Proposal comparison
- MARKETPLACE-005 Collaboration workflow
- MARKETPLACE-006 Marketplace trust / reputation
- MARKETPLACE-007 Marketplace dispute routing

## Canonical advertising chain
`Advertiser -> Account -> Campaign -> Inventory/Targeting -> Creative -> Delivery -> Measurement -> Attribution -> Billing Fact -> PAY Transaction/Settlement -> Audit`

Advertising billing facts do not replace the platform financial authority. D21 owns advertising-specific billing/delivery semantics; PAY owns payment, ledger and settlement.

## Brand collaboration chain
`Brand -> Brief -> Creator/IP Matching -> Proposal -> Quote -> Contract -> Delivery -> Review/Acceptance -> Performance -> Settlement -> Audit`

Creator/IP identity and rights remain owned by CREATOR/RIGHTS. Brand collaboration is an orchestration/business layer, not a second creator or rights system.

## Sponsored content
Sponsored content must be distinguishable from organic recommendation. Delivery, ranking and search responses must preserve the sponsored classification and required disclosure metadata. Sponsored content cannot bypass content moderation, rights checks, safety policy or entitlement rules.

## Creator marketplace
The marketplace supports discovery, eligibility, matching, proposal, negotiation and collaboration. Matching signals may include creator category, audience, geography, content type, performance, reputation, rights eligibility and brand constraints. Ranking/matching must not silently grant permissions or IP rights.

## External advertising providers
External providers such as future AdSense/CJ integrations are adapters behind a stable internal contract. Provider IDs, billing facts, delivery reports and conversion reports are retained for reconciliation. Provider-specific schemas must not become canonical domain truth.

## Measurement and attribution
Advertising and collaboration analytics distinguish:
- delivery facts
- view/impression facts
- engagement facts
- click facts
- conversion facts
- attributed revenue
- creator/IP contribution
- fraud-adjusted metrics

Attribution windows, model version, source and adjustment status must be explicit. Organic recommendation metrics and paid advertising metrics remain separate.

## Financial boundary
Advertising does not directly mutate wallet or ledger. The financial path is:
`Advertising/Brand Billing Fact -> Transaction -> Revenue Allocation/Split -> Ledger -> Settlement -> Audit`

Creator compensation and IP compensation use the same Batch 05 financial authority.

## Governance invariants
1. Advertising authorization goes through the existing authorization authority.
2. Advertiser and brand organization scopes are explicit.
3. Sponsored and organic content are distinguishable.
4. Advertising delivery cannot bypass moderation, rights, safety or privacy constraints.
5. Creator matching cannot grant IP ownership or license rights.
6. Creative assets remain owned by Content/Media where appropriate; advertising stores references and advertising metadata.
7. Advertising fraud controls complement, but do not replace, platform-wide risk governance.
8. Billing facts are reproducible and reconcilable with provider reports.
9. Financial settlement uses the unified PAY ledger/settlement authority.
10. Every paid collaboration is auditable from brief through contract, delivery, measurement and settlement.
11. External provider failure cannot corrupt canonical advertiser/campaign state.
12. Retry and callback processing must be idempotent.

## 1.0 and existing contract reuse
Reuse the existing D21 advertising contract, permission matrix, event registry, state-machine registry and machine-readable contract. Reuse 1.0 organization, creator, rights, transaction, revenue split, settlement and audit semantics. Do not duplicate old schema/API/Payload implementations.

## Acceptance
Batch 07 is closed when all advertising, brand collaboration and creator marketplace capabilities map to these Feature IDs and reference the existing D21 and canonical domain authorities. Implementation proceeds through individual Contract -> Code -> Tests/CI -> SHA evidence.

## Next
Batch 08 — Growth / Analytics / AI.
