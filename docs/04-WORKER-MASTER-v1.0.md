# Luckread 12-Worker Master v1.0

> Status: **PROPOSED / PENDING BLUEPRINT CHANGE CONTROL**
>
> Scope: candidate final Luckread Worker topology.
>
> Authoritative architecture source: `docs/00-PROJECT-BLUEPRINT-v1.4.md`.

## 1. Critical status

The architecture Blueprint freezes the **count** at 12 Workers / 4 D1 domains / 25 Contract Tasks, but it does not itself publish the canonical identity and responsibility definition for W01–W12.

Therefore the Worker definitions in this document are a **proposal only**. They must not be treated as frozen architecture, used to authorize implementation, or used as the basis for Contract GREEN until formally promoted by Blueprint Change Control.

This correction is intentional: Contract-First development must not convert an inferred allocation into an authoritative architecture decision.

## 2. Candidate Worker Master

| ID | Proposed responsibility | Proposed primary Tasks | Status |
|---|---|---|---|
| W01 | Public API / Gateway | T01,T02,T03,T08,T10,T11,T12,T13,T14,T15,T16,T17,T18,T19,T20,T21,T22,T23,T24 | PROPOSED |
| W02 | Identity & Access | T01,T02,T03 | PROPOSED |
| W03 | Content & Media | T05,T06,T07,T19 | PROPOSED |
| W04 | Feed & Discovery | T08,T09,T10,T11 | PROPOSED |
| W05 | Community & Messaging | T12,T13,T14 | PROPOSED |
| W06 | Trust & Safety | T20,T21,T19 | PROPOSED |
| W07 | Commerce & Monetization | T16,T17,T18,T22 | PROPOSED |
| W08 | Creator & Organization | T04,T22,T24 | PROPOSED |
| W09 | Platform & Storage | T25 | PROPOSED |
| W10 | Async & Jobs | T23,T25 | PROPOSED |
| W11 | Operations & Administration | T23,T24,T25 | PROPOSED |
| W12 | Developer & Integration Platform | T24,T25 | PROPOSED |

## 3. Why this is not yet canonical

Repository evidence contains older and incompatible Worker models, including W00–W08 and another topology containing W01–W13. Those historical artifacts cannot be silently reconciled by deleting or merging a Worker.

The current Blueprint requires formal Change Control when the frozen topology or its authoritative boundaries are changed. The proposal therefore remains non-binding until that gate is passed.

## 4. Promotion criteria

Before this Master can become canonical, Change Control must explicitly approve:

1. W01–W12 immutable identities.
2. Worker names and responsibilities.
3. Primary Task ownership.
4. API/runtime ownership.
5. Authentication and authorization boundaries.
6. D1 read/write permissions.
7. R2/cache/queue permissions.
8. Cross-worker call rules.
9. Timeout/retry/backpressure rules.
10. Deployment and environment boundary.
11. Payload extension boundary.
12. Test and evidence ownership.

## 5. Current binding status

| Dimension | Status |
|---|---|
| Worker count | **12/12 frozen by Blueprint** |
| Worker identities | **0/12 canonical** |
| Task → Worker | **0/25 canonical** |
| Worker → D1 | **BLOCKED** |
| Contract authorization | **BLOCKED** |

No implementation may use the proposed assignments as authoritative ownership.

## 6. Next gate

The next required artifact is a formal **Worker Topology Change Control / Reconciliation Record**. Only after approval should this proposal be promoted to the canonical Worker Master and used for the 25-Task binding.
