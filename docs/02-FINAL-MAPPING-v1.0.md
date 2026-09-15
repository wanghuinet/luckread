# Luckread Final Mapping v1.0

> Status: **ACTIVE / FEATURE → TASK → WORKER → D1 BINDING COMPLETE — CROSS-LAYER DETAIL PENDING**
>
> Scope: Luckread Payload self-media platform.
>
> Functional source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`.
>
> Architecture source of truth: `docs/00-PROJECT-BLUEPRINT-v1.4.md`.
>
> Final implementation target: **25 Contract Tasks / 12 Workers / 4 D1 Domains**.

## 1. Purpose

This document is the canonical traceability Mapping for Contract-First development.

The current frozen chain is:

```text
Feature Domain → Primary Task → Primary Worker → D1 Authority / Boundary
```

The downstream chain remains mandatory before Contract GREEN:

```text
Feature → Task → Primary Worker → Primary D1 → API → Data → Security → Event → Test → Evidence
```

Worker and D1 ownership must never be inferred from implementation code.

## 2. Mapping Status Rules

- `MAPPED` — the current layer has an explicit authoritative assignment.
- `BOUNDARY` — the capability is infrastructure/client/projection/API boundary and has no direct business D1 authority.
- `CONFLICT` — authoritative layers require resolution before GREEN.
- `PENDING` — a downstream detail is not yet frozen.
- `GREEN` — all applicable API/Data/Security/Runtime/Test/Evidence links are verified.

`MAPPED`, `BOUNDARY`, and `CONFLICT` at this layer do not authorize Contract GREEN. Full downstream validation is still required.

## 3. Frozen Topology

| Dimension | Final target | Status |
|---|---:|---|
| Contract Tasks | 25 | CANONICAL |
| Workers | 12 | CANONICAL |
| D1 Domains | 4 | CANONICAL |

No additional Worker or D1 domain may be introduced implicitly by Mapping or implementation.

## 4. Canonical Task → Worker → D1 baseline

| Task | Primary Worker | Primary D1 / Boundary |
|---|---|---|
| T01 | W02 | D1-01 |
| T02 | W02 | D1-01 |
| T03 | W02 | D1-01 |
| T04 | W08 | D1-01 |
| T05 | W03 | D1-02 |
| T06 | W03 | D1-02 |
| T07 | W03 | D1-02 |
| T08 | W04 | Derived/projection boundary |
| T09 | W04 | Derived/projection boundary |
| T10 | W04 | Derived/projection boundary |
| T11 | W05 | D1-02 |
| T12 | W05 | D1-02 |
| T13 | W05 | D1-02 / scoped D1-03 runtime delivery |
| T14 | W05 | Scoped D1-03 runtime delivery |
| T15 | W03 | D1-02 |
| T16 | W07 | D1-01 access authority + D1-04 commerce authority |
| T17 | W07 | D1-04 |
| T18 | W07 | Blueprint-owned advertising state; D1-04 only for financial effects |
| T19 | W06 | D1-03 |
| T20 | W06 | D1-03 |
| T21 | W06 | D1-03 |
| T22 | W11 | D1-03 |
| T23 | W11 | D1-03 |
| T24 | W01 | API boundary / no direct D1 authority |
| T25 | W09 | D1-03 platform/runtime authority |

This table is authoritative only at Task/Worker/D1-boundary level. Entity-level ownership remains governed by the D1 Master.

## 5. Feature-Domain → Task → Worker → D1 Mapping

| Domain | Feature range | Task | Worker | D1 / Boundary | Status |
|---|---|---|---|---|---|
| A | AUTH-001..016 | T01 | W02 | D1-01 | MAPPED |
| B | USER-001..010 | T02 | W02 | D1-01 | MAPPED |
| C | AUTHZ-001..010 | T03 | W02 | D1-01 | MAPPED |
| D | CREATOR-001..007; ORG-001..007 | T04 | W08 | D1-01 | MAPPED |
| E | CONTENT-001..012 | T05 | W03 | D1-02 | MAPPED |
| F | ARTICLE-001..012 | T06 | W03 | D1-02 | MAPPED |
| G | MEDIA-001..015 | T07 | W03 | D1-02 | MAPPED |
| H | EXTCONTENT-001..006 | T25 | W09 | D1-03 platform boundary; content authority remains D1-02 where applicable | CONFLICT |
| I | FEED-001..013 | T08 | W04 | Projection boundary; no authoritative D1 | BOUNDARY |
| J | REC-001..009 | T09 | W04 | Projection boundary; no authoritative D1 | BOUNDARY |
| K | SEARCH-001..010 | T10 | W04 | Projection boundary; no authoritative D1 | BOUNDARY |
| L | SOCIAL-001..010 | T11 | W05 | D1-02 | MAPPED |
| M | COMMUNITY-001..008 | T12 | W05 | D1-02 | MAPPED |
| N | MSG-* | T13 | W05 | D1-02 + scoped D1-03 runtime delivery | MAPPED |
| O | NOTIFY-* | T14 | W05 | Scoped D1-03 runtime delivery | MAPPED |
| P | I18N-* / TRANSLATION-* | T15 | W03 | D1-02 | MAPPED |
| Q | SUB-* / MEMBERSHIP-* / PAID-* | T16 | W07 | D1-01 access + D1-04 commerce/financial transition | MAPPED |
| R | PAYMENT-* / WALLET-* / REVENUE-* / SETTLEMENT-* | T17 | W07 | D1-04 | MAPPED |
| S | ADS-* / ADVERTISING-* | T18 | W07 | Blueprint-owned ad state; D1-04 only reconciled financial effects | MAPPED |
| T | RIGHTS-* / COPYRIGHT-* | T19 | W06 | D1-03 governance/right operational state; authoritative content references remain owning domain | MAPPED |
| U | TRUST-* / SAFETY-* / MODERATION-* / ANTIABUSE-* | T20 | W06 | D1-03 | MAPPED |
| V | REPORT-* / APPEAL-* / GOVERNANCE-* | T21 | W06 | D1-03 | MAPPED |
| W | GROWTH-* / ENGAGEMENT-* | T22 | W11 | D1-03 operational/campaign state | MAPPED |
| X | CAMPAIGN-* / OPERATIONS-* | T22 | W11 | D1-03 operational state | MAPPED |
| Y | ANALYTICS-* | T23 | W11 | D1-03 analytics/operational state; projections only | MAPPED |
| Z | SEO-* / PUBLIC-DISCOVERY-* | T24 | W01 | API/public discovery boundary; no direct D1 authority | BOUNDARY |
| AA | CLIENT-* / WEB-* / H5-* / MOBILE-* / MINIAPP-* | T24 | W01 | Client/API boundary; no direct D1 authority | BOUNDARY |
| AB | API-* / OPENAPI-* / VERSIONING-* | T24 | W01 | API boundary; no direct D1 authority | BOUNDARY |
| AC | DEVELOPER-* / SDK-* / WEBHOOK-* | T24 | W01 | API/integration boundary; no direct D1 authority | BOUNDARY |
| AD | ADMIN-* / SUPPORT-* / OPERATIONS-* | T24 | W01 | API/admin boundary; underlying state remains owning domain | BOUNDARY |
| AE | CONFIG-* / EXPERIMENT-* / FEATUREFLAG-* | T25 | W09 | D1-03 platform/runtime state | MAPPED |
| AF | TENANT-* / ENTERPRISE-* / ORGANIZATION-* | T25 | W09 | Potential D1-01 identity/org authority conflicts with T25→W09→D1-03 | CONFLICT |
| AG | STORAGE-* / MEDIA-INFRA-* | T25 | W09 | D1-03 runtime/storage-control boundary; media metadata remains D1-02 | MAPPED |
| AH | ASYNC-* / QUEUE-* / SCHEDULE-* | T25 | W09 | D1-03 | MAPPED |
| AI | DATA-GOV-* / PORTABILITY-* | T25 | W09 | D1-03 governance/runtime boundary; entity authority remains owning D1 | MAPPED |
| AJ | CLOUDFLARE-* / DEPLOY-* | T25 | W09 | Runtime/deployment boundary; no business D1 authority | BOUNDARY |
| AK | POSTGRES-* / GCP-* / MIGRATION-* | T25 | W09 | Portability boundary; no new D1 authority | BOUNDARY |
| AL | RELIABILITY-* / DR-* / BACKUP-* | T25 | W09 | D1-03 runtime/recovery state | MAPPED |
| AM | OBSERVABILITY-* / TELEMETRY-* | T23 | W11 | D1-03 operational/analytics state | MAPPED |
| AN | SECURITY-* / CRYPTO-* / SECRETS-* | T25 | W09 | D1-03 platform/security runtime boundary; business authorization remains owning D1 | MAPPED |
| AO | PRIVACY-* / COMPLIANCE-* | T25 | W09 | D1-03 governance/runtime boundary; subject data remains owning D1 | MAPPED |
| AP | INTEGRATION-* / ECOSYSTEM-* | T25 | W09 | Integration runtime boundary; business state remains owning D1 | MAPPED |
| AQ | EXTENSION-* / COMMERCE-* / FUTURE-* | T25 | W09 | Potential D1-04 commerce authority conflicts with T25→W09→D1-03 | CONFLICT |

## 6. Conflict findings from this batch

This batch intentionally does **not** force ambiguous domains into a false GREEN state.

### H — Future content types

T25/W09 is the frozen task/worker allocation, while future content types can create authoritative content entities that belong to D1-02. This requires feature-level authority rules rather than assigning all H state to D1-03.

### AF — Multi-tenant / enterprise

The functional mapping currently assigns AF to T25, while organization identity authority is D1-01/W08. This is a cross-layer allocation conflict that must be resolved before Contract GREEN.

### AQ — Extension / future commerce

AQ is currently assigned to T25/W09, while commerce authority belongs to W07/D1-04. Future commerce cannot silently acquire D1-03 authority merely because the domain was grouped under T25.

These are **architecture/mapping conflicts**, not implementation failures. No new Worker or D1 is introduced to resolve them.

## 7. Mapping invariants

1. Every Blueprint domain has exactly one current Primary Task assignment.
2. Every Task with a canonical Primary Worker resolves to that Worker.
3. A D1 value may represent a direct authority, a scoped boundary, or no authoritative D1; these meanings are explicit.
4. Cross-D1 features require explicit ownership, event, idempotency, consistency, retry/failure and reconciliation contracts.
5. A projection/API/runtime boundary must not become an implicit source of truth.
6. No Worker/D1 assignment is inferred from code, routes, Payload Collections or directories.
7. No fifth D1 may be introduced to resolve a conflict.
8. `CONFLICT` blocks Mapping Freeze and Contract GREEN.

## 8. Batch progress

| Stage | Status |
|---|---|
| Blueprint | 100% |
| Architecture Blueprint | 100% |
| 25 Tasks | 100% |
| 43 Feature Domains | 100% |
| 12 Worker Master | 100% |
| 4 D1 Master | 100% |
| Worker × D1 Binding | 100% |
| Feature → Task | 100% |
| Feature → Task → Worker | 43/43 = 100% |
| Feature → Task → Worker → D1 | **40/43 directly resolved; 3 CONFLICT** |
| API/Data/Security/Event/Test/Evidence | Pending |
| Conflict/orphan/duplicate audit | Pending |
| Mapping Freeze | Blocked |
| Contract generation | Blocked |

## 9. Next gate

The next batch must resolve only the three identified mapping conflicts (H, AF, AQ) using the existing Blueprint, Worker Master and D1 Master. It must not add Workers, D1 domains, or capabilities.

After those conflicts close, perform the reverse/forward orphan and duplicate audit before Mapping Freeze.
