# ADS-001..015 Real-Evidence Reconciliation v1

**Status:** BLOCKED_NOT_GREEN
**Implementation authorization:** false
**Mapping mode:** Evidence-bound only
**Scope:** ADS-001 advertiser/account; ADS-002 campaign/ad group; ADS-003 creative; ADS-004 placement/inventory; ADS-005 targeting/audience; ADS-006 budget/bid; ADS-007 impression/click/conversion; ADS-008 attribution; ADS-009 frequency cap; ADS-010 brand safety/ad review; ADS-011 direct advertising; ADS-012 external network integration; ADS-013 CJ/affiliate integration; ADS-014 AdSense compatibility/integration boundary; ADS-015 ad analytics/revenue/settlement.

## 1. Purpose

This batch reconciles the fifteen frozen Advertising feature IDs against repository evidence available on `main`. It does not invent API operation IDs, DTO IDs, entity IDs, field IDs, persistence mappings, Payload collections, Worker implementations, delivery/measurement evidence, or Evidence Registry records.

## 2. Frozen feature evidence

The Blueprint freezes the Advertising domain at `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md:L281-L295`. The existing B16-B20 mapping inventory marks all fifteen unresolved. This batch records evidence and closure requirements only.

## 3. Advertising contract evidence

`docs/66-ADVERTISING-PLATFORM-CONTRACT-v1.0.md` is the authoritative advertising platform contract. Admission status is `PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING`. It defines the advertising ownership model (Advertiser/Organization, Campaign, Ad Group, Creative, Targeting Definition, Budget/Pacing State, Delivery Policy, Attribution State, Reporting Read Models) and explicitly requires that no advertising API silently create a second authoritative User/Content/Creator/Wallet record.

`docs/21-D21-ADVERTISING-PLATFORM-CONTRACT-v1.0.md` defines the D21 demand-source contract (`LUCKREAD_DIRECT`, `GOOGLE`, `CJ`, `OPENRTB`, `DSP`, `SSP`, `PARTNER`) and the external-adapter contract; external demand must be normalized into the D21 demand contract before eligibility/auction.

`docs/134-ADVERTISING-API-CONTRACT-v1.0.md` lists representative `/v1/ads/*` operations (`/v1/ads/advertisers`, `/v1/ads/campaigns`, `/v1/ads/creatives`, `/v1/ads/delivery/decide`, `/v1/ads/events`, `/v1/ads/attribution/recompute`, `/v1/ads/budgets/{id}/pause`, `/v1/ads/reports`, `/v1/ads/billing-summary`) and states `IMPLEMENTATION = PENDING`.

`docs/135-ADVERTISING-EVENT-CONTRACT-v1.0.md`, `docs/136-ADVERTISING-PERMISSION-AND-SECURITY-CONTRACT-v1.0.md`, `docs/137-ADVERTISING-TEST-AND-ACCEPTANCE-CONTRACT-v1.0.md`, `docs/138-ADVERTISING-READY-ADMISSION-GATE-v1.0.md`, `docs/132-ADVERTISING-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md`, `docs/133-ADVERTISING-DATA-CONTRACT-v1.0.md`, `docs/141-ADVERTISER-CENTER-EXPERIENCE-CONTRACT-v1.0.md`, and `docs/21-D21-ADVERTISING-PERMISSION-MATRIX-v1.0.md` are real advertising-domain contracts.

`docs/67-CREATOR-IP-MARKETPLACE-AND-BRAND-COLLABORATION-CONTRACT-v1.0.md` and `docs/00-LUCKREAD-BLUEPRINT-ENHANCEMENT-BATCH-07-ADVERTISING-BRAND-CREATOR-MARKETPLACE-v1.0.md` define the brand-collaboration chain and state that external providers such as future AdSense/CJ integrations are adapters behind a stable internal contract; provider-specific schemas must not become canonical domain truth.

`docs/65-MONETIZATION-COMMERCE-SYSTEM-CONTRACT-v1.0.md` and `docs/68-WALLET-LEDGER-AND-SETTLEMENT-CONTRACT-v1.0.md` govern the financial boundary: advertising billing facts never replace the platform financial authority (Ledger/Settlement).

## 4. API inventory reconciliation

`contracts/api/api-inventory.v1.json` contains no `/v1/ads/*` operations. The representative advertising API surface in `docs/66` and `docs/134` is therefore not yet reconciled into the canonical API inventory. This is a real gap: advertising has contract prose and representative API paths but no canonical API operation IDs bound into the alignment inventory.

## 5. Feature-by-feature reconciliation

### ADS-001 — advertiser/account

**Status:** BLOCKED_NOT_GREEN

**Evidence:** advertiser/organization is the root of the advertising ownership model in `docs/66` (§5); `docs/141` defines the advertiser-center experience; `POST /v1/ads/advertisers` appears in the advertising API contract.

**Not evidence-bound:** canonical advertiser/organization entity and role model (OWNER/ADMIN/CAMPAIGN_MANAGER/CREATIVE_MANAGER/ANALYST/BILLING_MANAGER); canonical API operation ID/DTO; authorization and audit; persistence; runtime/tests/Evidence Registry.

### ADS-002 — campaign/ad group

**Status:** BLOCKED_NOT_GREEN

**Evidence:** campaign lifecycle (DRAFT→REVIEWING→APPROVED→ACTIVE→PAUSED→COMPLETED→REJECTED→ARCHIVED) and ad-group/delivery-plan composition are defined in `docs/66` (§6, §7); `/v1/ads/campaigns` appears in the API contract.

**Not evidence-bound:** canonical campaign/ad-group entity and lifecycle state machine; independently pausable delivery plan; DTO/operation IDs; delivery eligibility gate; persistence; runtime/tests/evidence.

### ADS-003 — creative

**Status:** BLOCKED_NOT_GREEN

**Evidence:** creative format/supported types, media ownership boundary and sponsored-label requirement are defined in `docs/66` (§8); `POST /v1/ads/creatives` appears in the API contract.

**Not evidence-bound:** canonical creative entity; media/content reference authority (non-duplication of binaries); delivery eligibility; DTO/operation ID; policy validation; persistence; runtime/tests/evidence.

### ADS-004 — placement/inventory

**Status:** BLOCKED_NOT_GREEN

**Evidence:** placement/inventory must be explicitly registered and versioned (`docs/66` §9); example placements (FEED/SEARCH/CONTENT_DETAIL/VIDEO/LIVE/PROFILE/COMMUNITY/CREATOR_SURFACE/APP_HOME) are listed.

**Not evidence-bound:** canonical placement/inventory entity and eligibility contract; registration lifecycle; DTO/API; privacy/measurement/safety attachment; persistence; runtime/tests/evidence.

### ADS-005 — targeting/audience

**Status:** BLOCKED_NOT_GREEN

**Evidence:** targeting dimensions, sensitive-attribute prohibition, and explainability are defined in `docs/66` (§10); privacy/consent (§11) governs first-party audience handling.

**Not evidence-bound:** canonical targeting/audience definition entity; forbidden-attribute enforcement; explainability representation; DTO/API; permission; persistence; runtime/tests/evidence.

### ADS-006 — budget/bid

**Status:** BLOCKED_NOT_GREEN

**Evidence:** budget and pacing authority and the Wallet/Ledger reconciliation boundary are defined in `docs/66` (§12); pricing abstraction (CPM/CPC/CPA/fixed sponsorship/creator pricing/future auction) is defined in §13; `/v1/ads/budgets/{id}/pause` appears in the API contract.

**Not evidence-bound:** canonical budget/pacing state entity; authoritative accounting reconciliation; bid/pricing model; DTO/operation ID; budget-exhaustion enforcement; persistence; runtime/tests/evidence.

### ADS-007 — impression/click/conversion

**Status:** BLOCKED_NOT_GREEN

**Evidence:** measurement events (`ad.impression`, `ad.view_start`, `ad.view_complete`, `ad.click`, `ad.engagement`, `ad.conversion`, `ad.invalid`) and idempotent processing are defined in `docs/66` (§16); `/v1/ads/events` and `/v1/ads/delivery/decide` appear in the API contract.

**Not evidence-bound:** canonical measurement event schema/versioning; idempotency/dedup authority; invalid-event classification; delivery decision DTO; persistence; runtime/tests/evidence.

### ADS-008 — attribution

**Status:** BLOCKED_NOT_GREEN

**Evidence:** attribution window/model/deduplication/cross-device/regional/fraud-exclusion and reproducibility are defined in `docs/66` (§17); `/v1/ads/attribution/recompute` appears in the API contract.

**Not evidence-bound:** canonical attribution-state entity; reproducible attribution policy versioning; derived-record authority; DTO/operation ID; persistence; runtime/tests/evidence.

### ADS-009 — frequency cap

**Status:** BLOCKED_NOT_GREEN

**Evidence:** frequency-cap scopes (user/campaign/ad group/creative/placement/time window) and bounded-approximation rules are defined in `docs/66` (§15).

**Not evidence-bound:** canonical frequency-state entity; cache/counter authority; scope enforcement; policy-permitted approximation boundary; DTO/API; persistence; runtime/tests/evidence.

### ADS-010 — brand safety/ad review

**Status:** BLOCKED_NOT_GREEN

**Evidence:** moderation/policy state (PENDING/APPROVED/REJECTED/REQUIRES_CHANGES/SUSPENDED) and non-duplication of the authoritative moderation rule set are defined in `docs/66` (§19); risk/fraud integration is defined in §18; `docs/136` governs advertising permission and security.

**Not evidence-bound:** canonical brand-safety/ad-review state machine; moderation rule-set reference; appeal workflow; DTO/API; permission; persistence; runtime/security E2E; Evidence Registry.

### ADS-011 — direct advertising

**Status:** BLOCKED_NOT_GREEN

**Evidence:** creator/content advertising and brand collaboration are defined in `docs/66` (§20) and `docs/67`; `LUCKREAD_DIRECT` is a first-class demand source in `docs/21-D21` (§13); the brand-collaboration chain is specified in `docs/00-LUCKREAD-BLUEPRINT-ENHANCEMENT-BATCH-07`.

**Not evidence-bound:** canonical direct/creator-advertising orchestration entity; sponsor disclosure and rights validation; demand normalization; DTO/API; persistence; runtime/tests/evidence.

### ADS-012 — external network integration

**Status:** BLOCKED_NOT_GREEN

**Evidence:** external demand normalization (`OPENRTB`, `DSP`, `SSP`, `PARTNER`) and the external-adapter contract (authenticate/connect/disconnect/health) are defined in `docs/21-D21` (§13, §14).

**Not evidence-bound:** canonical external-adapter entity; provider-agnostic capability boundary; failover/health authority; DTO/API; secret isolation; persistence; runtime/tests/evidence.

### ADS-013 — CJ/affiliate integration

**Status:** BLOCKED_NOT_GREEN

**Evidence:** `CJ` is a listed demand source in `docs/21-D21` (§13); `docs/00-LUCKREAD-BLUEPRINT-ENHANCEMENT-BATCH-07` states external CJ integrations are adapters behind a stable internal contract.

**Not evidence-bound:** canonical CJ/affiliate adapter contract; conversion-report reconciliation; provider-specific schema isolation; DTO/API; persistence; runtime/tests/evidence.

### ADS-014 — AdSense compatibility/integration boundary

**Status:** BLOCKED_NOT_GREEN

**Evidence:** `GOOGLE` is a listed demand source in `docs/21-D21` (§13); `docs/00-LUCKREAD-BLUEPRINT-ENHANCEMENT-BATCH-07` states future AdSense integrations are adapters behind a stable internal contract and provider-specific schemas must not become canonical domain truth.

**Not evidence-bound:** canonical AdSense adapter boundary; eligibility/consent/regional handling; reconciliation contract; DTO/API; persistence; runtime/tests/evidence.

### ADS-015 — ad analytics/revenue/settlement

**Status:** BLOCKED_NOT_GREEN

**Evidence:** reporting (§21) and accounting/consistency boundary (§25) are defined in `docs/66`; `GET /v1/ads/reports` and `GET /v1/ads/billing-summary` appear in the API contract; billing/settlement authority remains with `docs/65` and `docs/68`.

**Not evidence-bound:** canonical advertising-reporting read model; billing-candidate→ledger reconciliation; settlement authority; no direct event→ledger mutation; persistence; runtime/tests/evidence.

## 6. Cross-feature invariants

1. No advertising API may silently create a second authoritative User/Content/Creator/Wallet record.
2. No impression/click/conversion event may directly mutate a financial ledger without validation, deduplication, fraud checks, and reconciliation.
3. External provider (AdSense/CJ/OPENRTB/DSP/SSP) schemas must not become canonical domain truth; demand is normalized into the internal contract.
4. Cache is disposable and can never become authoritative accounting state.
5. Every delivered ad must be identifiable as sponsored where required by policy or law.
6. Sensitive attributes must not be used for targeting unless explicitly permitted.
7. A campaign must not deliver unless policy, budget, creative, targeting, and account checks all pass.
8. Measurement ingestion must be idempotent; invalid/disqualified events must remain distinguishable from valid events.
9. Reporting read models are not accounting authority.

## 7. Required closure chain

Each ADS feature requires:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

At minimum, closure requires canonical API operation IDs/DTO IDs, authoritative advertising entity and field authority, delivery/measurement/attribution idempotency and dedup semantics, permission and multi-tenant isolation, safety/moderation integration, finance-boundary reconciliation, executable implementation, positive/negative/concurrency/security tests, and Evidence Registry provenance with validating commit SHA.

## 8. Admission decision

All ADS-001..015 remain `BLOCKED_NOT_GREEN`. No implementation authorization is granted by this batch.

Advertising has substantial and consistent contract evidence (`docs/66`, `docs/21-D21`, `docs/132..138`, `docs/141`, `docs/67`), but its representative `/v1/ads/*` API surface is not yet reconciled into `api-inventory.v1.json`, no canonical entity/field authority exists, and no delivery/measurement/persistence/runtime evidence exists on `main`. The correct next step is to reconcile the advertising API surface into the canonical API inventory and establish advertising entity/field authority before any persistence or runtime claims.