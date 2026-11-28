# LuckRead Merchant / Seller Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authoritative Entities

```text
Merchant
Store
MerchantQualification
MerchantStaff
MerchantScope
FulfillmentProfile
MerchantPolicyState
```

## 2. Core Fields

### Merchant

```text
merchantId
merchantType
status
displayName
identityRef
verificationRef
primaryStoreId
version
createdAt
updatedAt
```

### Store

```text
storeId
merchantId
name
status
profileRef
locale
region
version
createdAt
updatedAt
```

### Staff

```text
staffId
merchantId
userId
role
scope
status
version
createdAt
updatedAt
```

## 3. Constraints

- `merchantId` and `storeId` are immutable identifiers.
- A store has one authoritative merchant owner at a time.
- Staff membership is unique by merchant/user active relationship.
- Scope is explicit and deny-by-default.
- Status transitions are versioned and auditable.
- Derived performance metrics are not authoritative merchant data.

## 4. Privacy / Retention

Identity evidence is represented by references, not copied into ordinary merchant records. Sensitive evidence follows least-retention principles and is excluded from public DTOs.

## 5. Rebuild

Operational read models may be rebuilt from authoritative Merchant/Store/Staff state and domain events.

## 6. Storage and Physical Authority

The logical Merchant/Seller authority belongs to the existing D1-04 Commerce / Financial domain. Its approved physical runtime target is the existing Neon finance PostgreSQL database owned exclusively by W07.

```text
W07 + existing Neon finance database (logical D1-04) = authoritative Merchant / Store / Qualification / Staff state
R2 = merchant media and controlled evidence objects/references where required
Cache/KV = derived hot views only; never authoritative
W10 = existing asynchronous execution/Queue boundary only; never Merchant data owner
```

Rules:
- W07 is the sole writer and authoritative reader for Merchant/Seller records in this domain; other Workers consume admitted W07 APIs/events and may keep only bounded references/projections.
- W01 is the only public API ingress; clients never access Neon, D1 or W07 internal routes directly.
- No Cloudflare D1 binding, D1 fallback, D1 compatibility adapter, cross-database dual write, new database, Worker, Queue or Service Binding is introduced.
- Existing `D1-04` naming in source migration history is a logical lineage label only. New physical migrations must be native PostgreSQL and follow the existing W07 Neon migration/generation/rehearsal contract.
- Sensitive identity/KYC/tax evidence remains in its approved controlled evidence store; Merchant rows keep opaque references and status/version only. Do not copy raw evidence into order snapshots, public DTOs or ordinary logs.
- This storage mapping does not mark Merchant implementation complete and does not authorize remote DDL or production activation.
