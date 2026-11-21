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
