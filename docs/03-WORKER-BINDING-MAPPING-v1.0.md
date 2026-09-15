# Luckread Worker × D1 Binding Mapping v1.0

> Status: **ACTIVE / CANONICAL WORKER × D1 BINDING**
>
> Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` → `docs/00-PROJECT-BLUEPRINT-v1.4.md` → `docs/02-FINAL-MAPPING-v1.0.md` → `docs/04-WORKER-MASTER-v1.0.md` → `docs/09-D1-DOMAIN-MASTER-v1.0.md`.
>
> Frozen topology: **12 Workers / 4 D1 domains / 25 Contract Tasks**.

## 1. Purpose

This document freezes the authoritative Worker × D1 binding required before the Feature → Task → Worker → D1 Mapping Freeze.

Worker identity and Primary Task ownership are defined by the canonical Worker Master. D1 authority is defined by the canonical D1 Domain Master. This document binds those two frozen layers without adding capabilities or changing domain ownership.

No Worker/D1 ownership may be inferred from code, routes, Payload Collections, directory names, runtime bindings, or historical documents.

## 2. Canonical D1 domains

| D1 | Authority |
|---|---|
| D1-01 | Identity / Account / Access |
| D1-02 | Content / Community Data |
| D1-03 | Platform Operations / Governance / Runtime |
| D1-04 | Commerce / Financial Authority |

Exactly four D1 domains are authoritative. No implicit fifth D1 exists.

## 3. Canonical Worker × D1 matrix

| Worker | Primary responsibility | Primary D1 | D1-01 | D1-02 | D1-03 | D1-04 |
|---|---|---|---|---|---|---|
| W01 | Public API / Gateway / Developer & Admin API Boundary | None | No direct authority | No direct authority | No direct authority | No direct authority |
| W02 | Identity / Account / Authorization | D1-01 | RW scoped | No | No | No |
| W03 | Content / Article / Media / Translation | D1-02 | No | RW scoped | No | No |
| W04 | Feed / Recommendation / Search | Derived/projection boundary | Read/projection only where explicitly contracted | Read/projection only where explicitly contracted | Read/projection only where explicitly contracted | Read/projection only where explicitly contracted |
| W05 | Social / Community / Messaging / Notification | D1-02 | No direct authority | RW scoped | RW scoped runtime-delivery only | No |
| W06 | Rights / Trust & Safety / Governance | D1-03 | No | Read/reference only where contracted | RW scoped | No |
| W07 | Subscription / Commerce / Payment / Advertising | D1-04 | Scoped entitlement transition only | No | Operational event/audit integration only | RW scoped financial/commercial authority |
| W08 | Creator / Organization | D1-01 | RW scoped | No | No | No |
| W09 | Platform / Storage / Reliability | D1-03 | No | No | RW scoped platform/runtime authority | No |
| W10 | Async / Queue / Job Execution | D1-03 scoped execution | No | No | RW scoped execution records only | No |
| W11 | Growth / Campaign / Analytics / Operations | D1-03 | No | Read/reference only where explicitly contracted | RW scoped operational/analytics state | No |
| W12 | External Developer / Integration Execution | No default business D1 | No direct authority | No direct authority | No direct authority | No direct authority |

### Permission notation

- **RW scoped** = read/write authority only for entities and operations explicitly assigned to that Worker/Task contract.
- **Read/projection only** = may consume explicitly authorized source data or projections; cannot mutate authoritative source state.
- **Runtime-delivery only** = D1-03 access is limited to delivery/runtime state and does not grant platform-wide operational authority.
- **Scoped entitlement transition only** = W07 may initiate the D1-01 entitlement transition through an approved cross-D1 event/contract; it does not become the D1-01 owner.
- **No direct authority** = Worker must use the owning Worker/API/event contract rather than direct authoritative D1 mutation.

## 4. Worker-specific binding rules

### W01

- API/gateway boundary only.
- No direct authoritative D1 write authority.
- Must route authenticated operations to the owning Worker/contract.
- Public API exposure never creates data ownership.

### W02

- Sole Worker authority for T01/T02/T03 and D1-01 identity/account/authorization state.
- Owns authorization decisions for identity/access state under the applicable contracts.
- Must not become owner of payment or financial facts.

### W03

- Sole Primary Worker for T05/T06/T07/T15 and D1-02 content/article/media/translation state.
- Physical media storage remains subject to the storage boundary; D1-02 owns metadata/reference state.
- Must not create financial authority in D1-02.

### W04

- Executes feed/recommendation/search capabilities.
- No authoritative D1 ownership.
- May consume explicitly authorized source data/projections.
- Cannot turn a feed, recommendation, search index, cache, or analytics projection into source-of-truth state.

### W05

- Primary D1-02 authority for T11/T12/T13/T14 content/community-side state assigned by the Blueprint.
- D1-03 access is limited to scoped notification/runtime delivery state.
- Does not become general D1-03 operational authority.

### W06

- Sole Primary Worker for T19/T20/T21 and D1-03 governance/moderation/report/appeal operational state assigned by contract.
- Cross-domain references remain references and do not transfer entity ownership.

### W07

- Sole Primary Worker for T16/T17/T18 and D1-04 commerce/financial workflows.
- D1-04 is authoritative for orders, payments, ledger, settlement and related financial facts.
- Subscription/access entitlement remains D1-01 authority.
- Any D1-01 entitlement effect is an explicit validated cross-D1 transition, never unrestricted direct ownership.

### W08

- Sole Primary Worker for T04 and D1-01 creator/organization identity relationships.
- Must not become general identity/account authorization authority outside its assigned entities and contracts.

### W09

- Sole Primary Worker for T25 and D1-03 platform/reliability/runtime authority.
- D1-03 authority is limited to platform entities assigned by the D1 Master and contracts.
- Must not become a generic business-data writer.

### W10

- Executes asynchronous jobs under the authority of the owning Worker/Task.
- D1-03 writes are limited to job/execution/idempotency/retry/DLQ/runtime records explicitly assigned by contract.
- Does not become a second Primary Worker for T25.

### W11

- Primary Worker for T22/T23 and D1-03 operational/analytics/campaign state assigned by contract.
- Analytics and operational projections cannot replace D1-01, D1-02, or D1-04 authoritative state.

### W12

- External integration execution boundary.
- No default business D1 authority.
- Integration callbacks/mutations must use explicit owning-domain contracts and cannot acquire unrestricted D1 write access.

## 5. Cross-D1 mutation rules

Cross-D1 mutation is never an implicit direct write permission.

Canonical pattern:

```text
Owning-domain authoritative transaction
        ↓
Outbox / versioned event
        ↓
Queue / authorized consumer
        ↓
Idempotent transition in target domain
        ↓
Audit / reconciliation / evidence
```

Required for every cross-D1 mutation:

1. explicit source and target domain;
2. caller and callee Worker IDs;
3. operation/event ID and version;
4. authorization scope;
5. idempotency identity;
6. timeout/retry behavior;
7. failure/backpressure semantics;
8. audit/correlation identifiers;
9. reconciliation behavior;
10. test and evidence references.

No distributed database transaction is assumed.

## 6. High-risk cross-D1 boundaries

### Subscription / payment

```text
D1-04 payment/order authority
        ↓ validated event
D1-01 entitlement/access transition
```

W07 does not own D1-01; W02 remains the D1-01 authority.

### Notification/runtime

W05 may write scoped D1-03 runtime delivery state, while W09/W10 retain their respective platform/runtime and job execution responsibilities. This scoped access does not transfer D1-03 authority.

### Financial effects from advertising

Advertising business state remains with its owning Blueprint domain. Only reconciled authoritative financial effects enter D1-04. No advertising flow may create a parallel ledger or wallet authority.

## 7. Global invariants

1. Exactly 12 canonical Workers.
2. Exactly 4 canonical D1 domains.
3. Exactly 25 Contract Tasks.
4. Every Task has exactly one Primary Worker.
5. Every authoritative entity has exactly one Primary D1.
6. No implicit fifth D1.
7. No unrestricted cross-domain database writer.
8. Public API exposure does not create business-state ownership.
9. Runtime access does not imply authoritative ownership.
10. Cache, feed, recommendation, search, analytics and snapshots are not authoritative replacements.
11. Payload Core remains immutable.
12. Historical Worker/D1 models remain non-authoritative.
13. Cloudflare-specific storage/runtime choices remain replaceable for PostgreSQL/GCP migration.

## 8. Gate result

| Dimension | Result |
|---|---|
| Worker Master | **12/12 CANONICAL** |
| D1 Master | **4/4 CANONICAL** |
| Worker × D1 binding | **12/12 BOUND** |
| Primary Task ownership | **25/25 CANONICAL** |
| Cross-D1 rules | **FROZEN** |
| Unrestricted writer audit | **PROHIBITED** |
| Fifth-D1 audit | **CLOSED** |
| Feature → Task → Worker → D1 | **NEXT GATE** |
| Mapping Freeze | **BLOCKED until next mapping audit** |
| Contract generation | **BLOCKED** |
| Implementation authorization | **BLOCKED** |

## 9. Next mandatory gate

The next batch must update the Final Mapping so every Blueprint feature-domain mapping can resolve:

**Feature → Task → Primary Worker → Primary D1 → API → Data → Security → Event → Test → Evidence**.

Only after that reverse/forward consistency audit passes may Mapping Freeze be authorized.
