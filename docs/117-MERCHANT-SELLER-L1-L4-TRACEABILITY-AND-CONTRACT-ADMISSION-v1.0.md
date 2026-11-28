# LuckRead Merchant / Seller L1-L4 Traceability & Contract Admission v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**

## 1. Traceability

```text
Merchant/Seller
→ L1
→ L2
→ L3
→ L4
→ Authority
→ Data
→ API
→ Event
→ Permission/Security
→ Risk/Privacy
→ Runtime/Cost
→ Test/Acceptance
→ Evidence
```

## 2. Coverage

| L2 | Core L3 | L4 examples | Authority |
|---|---|---|---|
| Merchant Identity | Profile/Type/Lifecycle | merchantId, type, active, suspended | Merchant |
| Qualification | Verification/Capability/Lifecycle | approval, sell capability, expiry | Merchant |
| Store Management | Identity/Profile/Operations | storeId, profile, pause/close | Merchant |
| Staff & Delegation | Staff/Role/Scope | invite, role, store scope | Merchant |
| Product Relationship | Catalog/Offer/Content binding | product/SKU/content refs | Commerce/Content |
| Fulfillment | Digital/Physical/Service | fulfillment refs, delivery state | Commerce/Fulfillment |
| Merchant Operations | Order/Support/Performance | order refs, disputes, metrics | Commerce/derived |
| Governance | Policy/Risk/Audit | restrictions, risk ref, audit | Risk/Governance |

## 3. Rules

Every L4 must map to one authoritative fact or an explicitly identified projection. Merchant identity/lifecycle cannot be redefined by Commerce, Payload, Cache or external engines.

## 4. STOP

- L4 lacks authority
- merchant/store authority duplicated
- staff scope not enforceable
- qualification bypass
- external commerce engine treated as hidden authority
- derived metric treated as merchant fact
## 5. Physical Runtime / Authority Mapping

- Merchant, Store, Qualification, Staff and Merchant Scope facts map to logical D1-04 Commerce / Financial authority. Neon `luckread_finance` is the approved PostgreSQL schema target; existing D1 remains production authority until separately approved cutover.
- W07 is the sole logical Worker owner for those facts. Existing production writes continue through the currently admitted D1 path during schema migration; after cutover W07 alone writes Neon. W01 is the only public API ingress and W08 supplies authorization decisions.
- W10 may execute existing asynchronous propagation only; it does not own Merchant facts. Other domains consume references/events and do not create duplicate Merchant records.
- No dual-write or second Merchant authority is permitted. Existing D1 production bindings remain until cutover; no new D1 binding or fallback may be introduced.
