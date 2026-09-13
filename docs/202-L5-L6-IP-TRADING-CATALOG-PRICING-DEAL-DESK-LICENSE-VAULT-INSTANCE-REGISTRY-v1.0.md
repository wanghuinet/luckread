# LuckRead L5-L6 IP Trading Core Instance Registry v1.0

**状态：INSTANCE-REGISTERED / CONTRACT-COMPLETE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. 目的

本 Registry 将 `201-WORLD-CLASS-IP-TRADING-CENTER-MASTER-CONTRACT-v1.0.md` 的核心交易产品能力进一步实例化为可执行的 L4 → L5 → L6 工程闭环。

本文件不新增第二套 IP / Rights / Commerce / Ledger 权威，仅把世界级 IP 交易中心最关键的产品模块形成稳定实例：

```text
License Catalog
Pricing & License Matrix
Buyer Intent / Discovery
Deal Desk
License Vault
Renewal / Expansion
Authorization Verification
```

## 2. Core Product Model

```text
IP
→ Rights Profile
→ License Product
→ License Package
→ Price / Commercial Terms
→ Buyer Intent
→ Match / Discovery
→ Deal
→ Agreement
→ License
→ Authorization
→ Fulfillment
→ Renewal / Expansion
```

## 3. L4 → L5 → L6 Registry

| L4 | L5 Instance | L6 Atomic Verification | Authority | Status |
|---|---|---|---|---|
| IP License Catalog | searchable license-product catalog | published product is traceable to one IP and one rights profile/version | Marketplace + Rights boundary | READY |
| License Package | structured grant/package composition | grant/usage/media/channel/territory/term/exclusivity fields are complete and deterministic | Rights | READY |
| License Matrix | scope-based license variants | distinct scope combinations cannot inherit unintended broader rights | Rights | READY |
| Public Pricing | fixed / starting / range / tier pricing | currency + minor-unit + price basis are explicit | Marketplace / Commerce boundary | READY |
| Dynamic Commercial Pricing | scope-linked pricing rules | price output references exact scope and policy/version | Marketplace | READY |
| Buyer Intent Search | intent-to-license query | intent parameters map to explicit rights/territory/term/channel/budget constraints | Search / Marketplace | READY |
| License Discovery | ranked eligible license offers | ranking never changes authoritative rights or eligibility | Search / Marketplace | READY |
| Deal Desk | complex / enterprise transaction workspace | every commercial change produces versioned structured terms | Marketplace | READY |
| Offline Negotiation | off-platform discussion reconciliation | offline result cannot bypass structured quote/agreement | Marketplace | READY |
| Negotiation Workspace | multi-party negotiation state | historical quotes and counters remain immutable | Marketplace | READY |
| Enterprise Approval | approval workflow | approval decisions are scoped, attributable and auditable | Marketplace / Policy | READY |
| License Vault | buyer rights asset repository | every stored license/authorization references one authoritative source artifact | Authorization / Rights | READY |
| Active Rights View | current-rights projection | active/expired/revoked state reflects authoritative license status | Rights-derived projection | READY |
| Renewal | renewal offer/workflow | renewal cannot extend a license without explicit new version/agreement where required | Rights / Marketplace | READY |
| Expansion | scope upgrade / additional rights | expanded rights require new approved scope and version | Rights | READY |
| Amendment | contract/license amendment | historical signed scope remains immutable and amendment is additive/versioned | Agreement / Rights | READY |
| Authorization Verification | public verification endpoint | authorization number/hash maps to current valid state without private leakage | Authorization | READY |
| Verification History | verifier/audit trail | verification events are attributable and privacy-controlled | Authorization / Evidence | READY |
| Authorization Certificate | deterministic certificate generation | same effective license/agreement version cannot create conflicting certificates | Authorization | READY |
| Commercial Analytics | deal / conversion / demand analytics | derived analytics never become price or rights authority | Analytics | READY |
| License Portfolio | licensor portfolio management | batch actions preserve per-license authorization and version boundaries | Marketplace / Rights | READY |

## 4. License Catalog Invariants

Every published license product MUST have:

```text
ipId
rightsProfileId
licenseProductId
licenseProductVersion
licensePackage
eligibilityRules
availability
pricingModel
contractModel
status
```

A product cannot be published when its rights scope is undefined, contradictory or unavailable.

Catalog search is derived; the authoritative grant remains Rights.

## 5. License Matrix

The trading center SHALL support orthogonal dimensions:

```text
Right
Usage
Media
Channel
Territory
Language
Term
Exclusivity
Derivative
Sublicense
Commercial Scale
```

A license variant is the deterministic combination of explicitly selected dimensions.

The system MUST reject ambiguous scope combinations such as:

```text
Worldwide + China-only
Exclusive + non-exclusive
Perpetual + fixed-expiry
Derivative-allowed + derivative-forbidden
```

unless an explicit hierarchy rule exists in the authoritative Rights policy.

## 6. Pricing Integrity

Price records MUST distinguish:

```text
displayPrice
quotePrice
acceptedPrice
settlementReference
```

Each price MUST include:

```text
currency
minorUnitAmount
priceBasis
effectiveFrom
effectiveTo
scopeReference
version
```

Historical order/agreement snapshots MUST NOT change when public prices change.

## 7. Scope-Aware Pricing

Pricing MAY depend on:

```text
IP
Rights
Territory
Term
Channel
Media
Exclusivity
Expected Volume
Commercial Scale
Distribution Scope
```

Example:

```text
Standard
= China + non-exclusive + social video + 12 months

Premium
= China + exclusive + product category + 24 months

Enterprise
= Global + exclusive + adaptation + negotiated commercial terms
```

The pricing system MUST explain the basis of a displayed amount and MUST NOT imply broader rights than the price scope actually covers.

## 8. Buyer Intent

Buyer Intent SHALL support structured requirements:

```text
ipType
industry
rightsNeeded
usage
media
channel
territory
language
term
exclusivity
budget
expectedScale
deadline
```

Natural-language input MAY be converted into these fields, but the final transaction SHALL rely on structured validated fields.

## 9. Discovery Trust Boundary

Discovery can optimize for:

```text
relevance
availability
commercial fit
budget fit
territory fit
term fit
popularity
trend
```

But discovery MUST NOT silently broaden rights.

```text
Recommendation = candidate selection
Rights = legal/authorization decision
```

## 10. Deal Desk

Deal Desk supports:

```text
STANDARD
COMPLEX
ENTERPRISE
STRATEGIC
```

Capabilities:

- deal participants
- internal owners
- approval matrix
- rights scope modeling
- commercial terms
- quote versions
- document versions
- offline meeting references
- legal review references
- risk review
- execution checklist
- closing readiness

Deal Desk MUST maintain structured state and audit history rather than relying on free-form notes.

## 11. Multi-Party Deal

Complex IP transactions MAY include:

```text
IP Owner
Rights Holder
Agency
MCN
Brand
Buyer
Distributor
Licensee
Sub-licensee where permitted
```

Each participant must have explicit role, authority and scope.

No participant may implicitly gain rights merely by joining a deal.

## 12. Offline-to-Online Closure

```text
Offline Negotiation
→ Terms Draft
→ Authorized Party Review
→ Final Quote Version
→ Counterparty Confirmation
→ Agreement Snapshot
→ E-Sign
```

The platform MUST record the transition from offline negotiation to online authoritative transaction state.

## 13. License Vault

Buyer License Vault MUST answer:

```text
What can I use?
Where can I use it?
Until when?
Under which agreement?
Which authorization proves it?
Has it expired or been revoked?
```

Each item SHALL expose:

```text
IP
License
Agreement
Authorization
Rights Summary
Territory
Term
Status
Restrictions
Downloadable Evidence
```

Private agreement contents remain access-controlled.

## 14. Current Rights Projection

Active-rights view MUST be derived from authoritative License / Entitlement state.

```text
ACTIVE
EXPIRING_SOON
EXPIRED
SUSPENDED
REVOKED
DISPUTED
```

Cached projections MUST carry source version / timestamp and be refreshable.

## 15. Renewal

Renewal is a new controlled transaction.

```text
Existing License
→ Renewal Offer
→ Rights Recheck
→ New Commercial Terms
→ Agreement / Amendment
→ Signed
→ New License Version / Term
```

A renewal MUST NOT silently mutate historical license periods.

## 16. Expansion / Upgrade

Examples:

```text
China → Global
12 months → 36 months
Non-exclusive → Exclusive
Social → Retail
Digital → Physical Product
Standard → Derivative Rights
```

Every expansion MUST record:

```text
previousScope
newScope
reason
priceDifference
approval
agreementReference
rightsDecision
version
```

## 17. Amendment

Amendments MUST preserve:

```text
originalAgreementVersion
amendmentVersion
changedTerms
effectiveAt
approval
signatureEvidence
```

Historical signed versions MUST remain immutable.

## 18. Authorization Verification

Verification supports:

```text
authorizationNumber
verificationReference
documentHash
status
issuedAt
effectiveAt
expiryAt
```

Public response SHALL be minimal and privacy-safe.

Suggested public states:

```text
VALID
EXPIRED
REVOKED
SUSPENDED
INVALID
```

## 19. Commercial Analytics

Analytics MAY report:

```text
search demand
license views
inquiry rate
quote rate
conversion rate
average time to close
price-band demand
territory demand
industry demand
renewal rate
expansion rate
```

Analytics are derived signals and MUST NOT change rights, prices or financial balances without an explicit authoritative command.

## 20. Required API Surface

```text
GET    /v1/ip-license-catalog
GET    /v1/ip-license-products/{id}
GET    /v1/ip-license-matrix/{id}
POST   /v1/ip-license-intents
POST   /v1/ip-license-intents/search
POST   /v1/deals
POST   /v1/deals/{id}/quote
POST   /v1/deals/{id}/counter
POST   /v1/deals/{id}/confirm-terms
POST   /v1/deals/{id}/prepare-agreement
GET    /v1/license-vault
GET    /v1/license-vault/{licenseId}
POST   /v1/licenses/{id}/renew
POST   /v1/licenses/{id}/expand
POST   /v1/licenses/{id}/amend
GET    /v1/authorizations/{id}/verify
GET    /v1/authorizations/{id}/history
```

Every mutation MUST support authorization, idempotency, version checks, audit and stable errors.

## 21. Event Surface

Representative events:

```text
ip.catalog.published
ip.offer.price.updated
ip.buyer.intent.created
ip.deal.created
ip.deal.quote.created
ip.deal.quote.accepted
ip.deal.offline.terms.submitted
ip.deal.terms.confirmed
ip.deal.agreement.prepared
ip.license.renewal.requested
ip.license.expansion.requested
ip.license.amendment.created
ip.authorization.issued
ip.authorization.verified
ip.authorization.revoked
```

All events require stable identity, versioning, timestamp, correlationId and duplicate-safe handling.

## 22. World-Class Trust Requirements

The trading center SHALL provide visible trust signals without making unsupported legal guarantees:

```text
Licensor Verified
Rights Reviewed
Commercial Terms Clear
License Scope Clear
Contract Versioned
E-Sign Evidence Available
Authorization Verifiable
Revocation Status Checkable
```

For high-value transactions, provenance and rights evidence MAY be required before publication.

## 23. Cost / Performance

Public catalog and discovery MUST be cache/search optimized.

Complex matching and analytics SHOULD be asynchronous.

Contract generation and certificate generation MUST be bounded and retry-safe.

License verification SHOULD remain low-latency and revocation-aware.

The system MUST avoid synchronous fan-out to all domain systems on every catalog page view.

## 24. L6 Minimum Verification Set

```text
L6-IP-202-001 catalog-to-rights traceability
L6-IP-202-002 license package completeness
L6-IP-202-003 license matrix ambiguity rejection
L6-IP-202-004 public price integrity
L6-IP-202-005 historical price snapshot immutability
L6-IP-202-006 buyer intent normalization
L6-IP-202-007 discovery-rights boundary
L6-IP-202-008 deal version integrity
L6-IP-202-009 offline negotiation closure
L6-IP-202-010 multi-party permission isolation
L6-IP-202-011 license vault source integrity
L6-IP-202-012 active-rights projection correctness
L6-IP-202-013 renewal historical immutability
L6-IP-202-014 expansion scope correctness
L6-IP-202-015 amendment version preservation
L6-IP-202-016 public authorization verification privacy
L6-IP-202-017 verification revocation freshness
L6-IP-202-018 commercial analytics non-authority
L6-IP-202-019 duplicate-safe events
L6-IP-202-020 audit completeness
```

## 25. STOP Conditions

Implementation MUST STOP if:

- catalog lists rights not present in Rights Authority
- price implies broader scope than the License Package
- offline deal bypasses structured terms
- historical quotes or signed versions are overwritten
- discovery changes legal eligibility
- License Vault becomes a second rights authority
- renewal mutates historical license periods
- expansion lacks a new rights decision/version
- amendment destroys signed history
- verification exposes private contracts
- revoked rights remain publicly valid due to stale cache
- analytics mutate financial or rights authority

## 26. Admission

This Registry closes the L5/L6 engineering mapping for the core world-class IP Trading Center modules defined by Contract 201.

```text
L4 → L5 → L6 = REGISTERED
Implementation = NOT AUTHORIZED
CL = NOT RUN
CI = NOT RUN
```

Source contracts:

```text
201 World-Class IP Trading Center Master Contract
200 IP License Transaction / E-Signature Instance Registry
197 IP Graph / IP Economy Instance Registry
64 Copyright / Rights / Licensing
65 Monetization / Commerce
68 Wallet / Ledger / Settlement
71 Platform Operations
176 Evidence Registry
179 L5 Execution Specification
180 L6 Verification / Evidence Atomic Unit
182 Full Coverage Registry
183 Instance Generation Protocol
195 Global Instance Closure / Traceability Audit
```
