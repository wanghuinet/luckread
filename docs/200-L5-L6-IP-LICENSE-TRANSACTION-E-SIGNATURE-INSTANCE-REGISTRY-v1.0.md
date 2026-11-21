# LuckRead L5-L6 IP License Transaction / E-Signature Instance Registry v1.0

**状态：INSTANCE-REGISTERED / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 1. 目的

本 Registry 将 `67A-IP-LICENSE-MARKETPLACE-AND-E-SIGNATURE-ADDENDUM-v1.0.md` 的 IP 授权交易能力实例化为 L4 → L5 → L6 工程闭环。

本文件不新增产品能力；它只建立可执行的工程实例、验证原子单元、权威边界与证据引用。

## 2. Authority Boundary

```text
IP Domain
= IP identity / ownership / graph authority

Rights
= rights / entitlement / license-scope authority

Marketplace
= offer / quote / negotiation / transaction workflow authority

Commerce
= order / payment / refund authority

Agreement / E-Sign Adapter
= signed-agreement execution evidence

Authorization
= issued authorization certificate derived from authoritative License + Agreement state

Ledger
= financial accounting / settlement authority
```

任何 Center / Marketplace 页面不得创建第二权威。

## 3. L4 → L5 → L6 Registry

| L4 | L5 Instance | L6 Atomic Verification | Owner | Authority | Status |
|---|---|---|---|---|---|
| IP License Offer | Offer publication / versioning execution | Published offer exposes immutable rights, price and eligibility snapshot | IP Marketplace | Marketplace | READY |
| Public Price / Price Model | Price snapshot execution | Fixed/start/range/negotiable/quote-required modes preserve explicit currency + minor units | IP Marketplace | Marketplace + Commerce boundary | READY |
| Inquiry / Quote | Negotiation state execution | Multi-round quote produces versioned immutable terms | Marketplace | Marketplace | READY |
| Offline Negotiation | Offline-to-online terms conversion | Final offline terms cannot bypass structured quote/agreement | Marketplace | Marketplace | READY |
| License Order | Order creation / idempotency | Same accepted offer version cannot create duplicate authoritative order | Commerce boundary | Commerce | READY |
| Rights Check | Pre-sign / pre-issue rights decision | Buyer, seller, scope, territory, term and conflict checks are enforced | Rights | Rights | READY |
| Agreement Preparation | Contract snapshot generation | Agreement references exact IP/Rights/Offer/Order/terms versions | Agreement | Agreement boundary | READY |
| E-Signature | Signature session / evidence capture | Signer, timestamp, provider reference, hash and evidence are persisted | Agreement Adapter | E-Sign Adapter | READY |
| License Activation | Activation decision | License activates only after required rights, agreement and payment/policy conditions pass | Rights + Commerce | Rights | READY |
| Authorization Certificate | Certificate issuance | One effective License/Agreement state produces one deterministic authorization artifact | Authorization | Rights-derived issuance | READY |
| Authorization Download | Controlled document access | Only authorized users can download; bytes match stored document hash | Authorization | Authorization | READY |
| Authorization Verification | Public verification projection | Number/hash resolves to valid/revoked/expired/invalid state without private leakage | Verification | Authorization | READY |
| Revocation / Expiry | Status propagation | Revocation/expiry updates verification and consumers without stale valid cache | Rights | Rights | READY |
| Refund / Cancel Impact | Transaction-to-rights reconciliation | Refund/cancel cannot leave inconsistent active-license state | Commerce + Rights | Commerce / Rights | READY |
| Dispute | Transaction dispute case | Dispute preserves evidence references and does not mutate historical signed facts | Marketplace | Marketplace / domain authorities | READY |

## 4. Mandatory L5 Contract Fields

Each implementation-scoped instance MUST define:

```text
instanceId
l1Id
l2Id
l3Id
l4Id
l5Id
l6Id
owner
authoritativeSource
dataRef
apiRef
eventRef
permissionRef
securityRef
runtimeRef
costRef
testRef
evidenceRef
status
version
```

## 5. Transaction State Machine

```text
DRAFT
→ PUBLISHED
→ AVAILABLE
→ CHECKING
→ ORDER_CREATED
→ RIGHTS_CHECKED
→ CONTRACT_PREPARED
→ SIGNATURE_PENDING
→ SIGNED
→ PAYMENT_PENDING / PAID
→ LICENSE_ISSUED
→ FULFILLMENT_ACTIVE
→ COMPLETED / EXPIRED
```

Exceptional states MUST be explicit:

```text
REJECTED
CANCELLED
REFUNDED
DISPUTED
SUSPENDED
RIGHTS_REVOKED
VOIDED
```

No implementation may infer terminal authorization validity from an unrelated order status.

## 6. Price Integrity

Money MUST be represented as:

```text
currency
minorUnitAmount
```

The following snapshots MUST be immutable once accepted into an order/agreement:

```text
priceSnapshot
rightsSnapshot
territorySnapshot
termSnapshot
contractTemplateSnapshot
```

Offer edits MUST NOT rewrite historical transactions.

## 7. Offline Negotiation Closure

```text
Offline Meeting
→ Negotiation Record
→ Structured Final Terms
→ Quote Version
→ Counterparty Confirmation
→ Agreement Snapshot
```

Chat text, email, phone notes or external CRM records cannot be the sole source of final contract truth.

## 8. E-Sign Evidence

Every signed agreement MUST be traceable to:

```text
agreementId
agreementVersion
signerRefs
signedAt
providerRef
signatureStatus
documentHash
evidenceRef
auditRef
```

A boolean `signed=true` is insufficient as evidence.

## 9. Authorization Certificate Invariants

```text
Authorization
→ exactly one source License
→ exactly one effective Agreement snapshot
→ exact rights/territory/term snapshot
→ deterministic authorizationNumber
→ deterministic documentHash
```

Duplicate issuance for the same effective license/version MUST be rejected or idempotently resolved to the existing artifact.

## 10. Verification Invariants

Public verification MUST return only approved fields:

```text
valid / revoked / expired / invalid
authorizationNumber
IP summary
licensor summary
licensee summary where public policy permits
rights summary
territory
term
```

Private pricing, full contract text, negotiation history, internal evidence and payment detail MUST NOT be exposed unless explicitly public.

## 11. Revocation / Expiry

```text
Rights Revocation / Expiry
→ License Status
→ Authorization Status
→ Verification Projection
→ Relevant Consumer Notification
```

Any cache serving authorization validity MUST be version-aware and revocation-aware.

## 12. Cross-Domain Saga

Permitted coordination:

```text
Order
→ Rights Check
→ Agreement
→ E-Sign
→ Payment Condition
→ License
→ Authorization
```

No distributed transaction across Rights, Commerce, Agreement Adapter and Ledger is required.

Compensation MUST be explicit for failures such as:

```text
payment failure
signature voided
rights conflict
revocation
refund
cancellation
```

## 13. Event Requirements

Representative events:

```text
ip.license.offer.published
ip.license.quote.created
ip.license.quote.accepted
ip.license.order.created
ip.license.rights.checked
ip.license.agreement.prepared
ip.license.agreement.signed
ip.license.payment.satisfied
ip.license.issued
ip.authorization.issued
ip.authorization.downloaded
ip.authorization.verified
ip.license.revoked
ip.license.expired
```

Each event MUST have stable `eventId`, `entityId`, `eventVersion`, `timestamp`, `correlationId` and duplicate-safe consumption.

## 14. Permission / Security

P0 authorization is required for:

```text
publish offer
change price
change rights conditions
submit quote
accept quote
create order
prepare agreement
sign agreement
issue license
issue authorization
revoke/suspend
view private contract
view private negotiated price
```

Evidence and contract documents are controlled data.

## 15. Data / Storage Boundary

Structured transactional metadata MUST remain in the authoritative relational store.

Large signed documents / authorization PDFs MAY reside in object storage with stable references and content hashes.

Cache/search are derived only.

The IP Center MUST NOT store duplicate final rights facts or financial ledgers.

## 16. Required L6 Verification Set

Minimum atomic claims:

```text
L6-IP-200-001 offer version immutability
L6-IP-200-002 price minor-unit correctness
L6-IP-200-003 quote version determinism
L6-IP-200-004 offline terms structured closure
L6-IP-200-005 order idempotency
L6-IP-200-006 rights check enforcement
L6-IP-200-007 agreement snapshot immutability
L6-IP-200-008 e-sign evidence completeness
L6-IP-200-009 license activation preconditions
L6-IP-200-010 authorization issuance idempotency
L6-IP-200-011 authorization document hash integrity
L6-IP-200-012 authorization download permission
L6-IP-200-013 public verification privacy
L6-IP-200-014 revocation propagation
L6-IP-200-015 expiry propagation
L6-IP-200-016 refund/cancel rights reconciliation
L6-IP-200-017 dispute evidence preservation
L6-IP-200-018 duplicate event safety
L6-IP-200-019 cross-domain compensation
L6-IP-200-020 audit trace completeness
```

Every L6 claim requires reproducible evidence before acceptance.

## 17. Readiness Gate

```text
REGISTERED
→ CONTRACT-CHECKED
→ L5-COMPLETE
→ L6-COMPLETE
→ TEST-COMPLETE
→ EVIDENCE-COMPLETE
→ READY
→ IMPLEMENTED
→ CL-PASS
→ CI-PASS
→ ACCEPTED
```

Current state:

```text
L4→L5→L6 = REGISTERED
Implementation = NOT AUTHORIZED
CL = NOT RUN
CI = NOT RUN
```

## 18. STOP Conditions

STOP when any of the following occurs:

- IP Center becomes IP ownership authority
- Marketplace grants rights without Rights Authority
- final financial balance is maintained outside Ledger
- final price is not snapshot-versioned
- offline negotiation bypasses structured terms
- agreement has no immutable version
- signed evidence lacks document hash
- authorization can be duplicated
- revoked authorization remains publicly valid
- private contract data leaks through verification
- cache/search becomes authorization authority
- refund/cancel leaves rights state inconsistent
- historical signed evidence can be rewritten

## 19. Source Contracts

```text
67A  IP License Marketplace / Transaction / E-Signature Addendum
64   Copyright / Rights / Licensing System Contract
65   Monetization / Commerce Contract
68   Wallet / Ledger / Settlement Contract
71   Platform Operations / Reliability Contract
139  Global Product / Experience Superiority Contract
154  Center Layer Master Matrix
156  Center Layer Unified Admission Gate
157  Center Layer Unified Preflight Contract
176  Evidence Registry / Acceptance Traceability Contract
179  L5 Execution Specification Contract
180  L6 Verification / Evidence Atomic Unit Contract
182  L4-L5-L6 Full Coverage Registry Contract
183  L4-L5-L6 Instance Generation Protocol
195  Global Instance Closure / Traceability Audit

Authority order remains governed by the final reconciliation/admission chain.
```

## 20. Admission

This registry closes the engineering-instance gap introduced by the IP License Marketplace expansion. It does not authorize implementation.

**Status: INSTANCE-REGISTERED / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**
