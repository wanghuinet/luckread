# Luckread Final Mapping v1.0

> Status: **ACTIVE / MAPPING IN PROGRESS — BATCH 3 COMPLETE**
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

It reconciles:

```text
Feature ID ↔ Task ID ↔ Worker ID ↔ D1 Domain ID
                     ↕
       API / Data / Security / Event / Consistency
                     ↕
       Test / CI / Deployment / Smoke / Evidence
```

Worker and D1 ownership must never be inferred from implementation code.

## 2. Mapping Status Rules

- `MAPPED` — source capability and ownership dimensions are explicitly mapped.
- `PENDING` — source information exists, but the corresponding authoritative master has not yet frozen the assignment.
- `CONFLICT` — authoritative sources disagree; implementation is blocked.
- `EXCLUDED` — capability is outside the current contract scope but remains in the functional Blueprint.
- `GREEN` — all applicable API/Data/Security/Runtime/Test/Evidence links are verified.

`PENDING` is not `GREEN` and cannot authorize implementation.

## 3. Frozen Topology

| Dimension | Final target | Source |
|---|---:|---|
| Contract Tasks | 25 | Architecture Blueprint v1.4 |
| Workers | 12 | Architecture Blueprint v1.4 |
| D1 Domains | 4 | Architecture Blueprint v1.4 |

No additional Worker or D1 domain may be introduced implicitly by Mapping or implementation.

## 4. Canonical Task Master

| Task | Responsibility | Primary Blueprint domains |
|---|---|---|
| T01 | Identity & Account | A |
| T02 | Profile & User Lifecycle | B |
| T03 | Role & Authorization | C |
| T04 | Creator / Organization | D |
| T05 | Content Creation & Lifecycle | E |
| T06 | Article & Text | F |
| T07 | Media & Asset | G |
| T08 | Feed & Discovery | I |
| T09 | Recommendation | J |
| T10 | Search | K |
| T11 | Social Graph | L |
| T12 | Interaction & Community | L, M |
| T13 | Messaging | N |
| T14 | Notification | O |
| T15 | Translation & i18n | P |
| T16 | Subscription & Paid Content | Q |
| T17 | Payment & Revenue | R |
| T18 | Advertising | S |
| T19 | Copyright & Rights | T |
| T20 | Trust & Safety | U |
| T21 | Reports & Governance | V |
| T22 | Growth & Campaign | W, X |
| T23 | Analytics & Operations | Y, AM |
| T24 | API / Developer / Admin | AB, AC, AD |
| T25 | Platform / Infrastructure / Reliability | H, AG, AH, AI, AJ, AK, AL, AN, AO, AP, AQ |

## 5. Batch 1 — Identity through Media

| Domain | Feature range | Task | Worker | D1 | API/Data/Security/Event/Test |
|---|---|---|---|---|---|
| A | AUTH-001..016 | T01 | PENDING | PENDING | PENDING |
| B | USER-001..010 | T02 | PENDING | PENDING | PENDING |
| C | AUTHZ-001..010 | T03 | PENDING | PENDING | PENDING |
| D | CREATOR-001..007 | T04 | PENDING | PENDING | PENDING |
| D | ORG-001..007 | T04 | PENDING | PENDING | PENDING |
| E | CONTENT-001..012 | T05 | PENDING | PENDING | PENDING |
| F | ARTICLE-001..012 | T06 | PENDING | PENDING | PENDING |
| G | MEDIA-001..015 | T07 | PENDING | PENDING | PENDING |

## 6. Batch 2 — Future Content through Community

| Domain | Feature range | Task | Worker | D1 | API/Data/Security/Event/Test |
|---|---|---|---|---|---|
| H | EXTCONTENT-001..006 | T25 | PENDING | PENDING | PENDING |
| I | FEED-001..013 | T08 | PENDING | PENDING | PENDING |
| J | REC-001..009 | T09 | PENDING | PENDING | PENDING |
| K | SEARCH-001..010 | T10 | PENDING | PENDING | PENDING |
| L | SOCIAL-001..010 | T11 | PENDING | PENDING | PENDING |
| M | COMMUNITY-001..008 | T12 | PENDING | PENDING | PENDING |

### H-domain rationale
Future content types are mapped to T25 as an extensibility/platform responsibility. They do not create an additional Task, Worker or D1 domain. Concrete future-content contracts remain subject to the same Feature/API/Data/Security rules.

## 7. Batch 3 — Messaging through Copyright & Rights

| Domain | Feature range | Task | Worker | D1 | API/Data/Security/Event/Test |
|---|---|---|---|---|---|
| N | MSG-* | T13 | PENDING | PENDING | PENDING |
| O | NOTIFY-* | T14 | PENDING | PENDING | PENDING |
| P | I18N-* / TRANSLATION-* | T15 | PENDING | PENDING | PENDING |
| Q | SUB-* / MEMBERSHIP-* / PAID-* | T16 | PENDING | PENDING | PENDING |
| R | PAYMENT-* / WALLET-* / REVENUE-* / SETTLEMENT-* | T17 | PENDING | PENDING | PENDING |
| S | ADS-* / ADVERTISING-* | T18 | PENDING | PENDING | PENDING |
| T | RIGHTS-* / COPYRIGHT-* | T19 | PENDING | PENDING | PENDING |

### Batch 3 ownership rule
The feature prefixes above are intentionally represented as domain-level ranges in this batch. Exact Feature IDs must be taken from the functional Blueprint; no new IDs are invented by this Mapping. Worker and D1 assignments remain `PENDING` until their respective authoritative masters are frozen.

## 8. Mapping Invariants

1. Every Feature ID maps to exactly one primary Contract Task.
2. A feature may reference multiple APIs, Data IDs, Security IDs and Events when required.
3. A feature may execute through one Worker or a justified bounded set of runtime boundaries; this must be explicit.
4. A feature may touch more than one D1 domain only when cross-domain ownership and consistency are explicitly contracted.
5. Cross-domain writes require authoritative owner, local transaction boundary, event, idempotency, consistency window, retry/failure policy and compensation where required.
6. No Worker/D1 assignment is inferred from directory names, Payload collections, route names or existing code.
7. No API, data entity, security rule, event or test may exist without a traceable Feature/Task owner unless explicitly marked infrastructure-level by the Architecture Blueprint.
8. A missing mapping link blocks `GREEN`.

## 9. Batch Progress

| Batch | Coverage | Status |
|---|---|---|
| Batch 1 | A–G | COMPLETE |
| Batch 2 | H–M | COMPLETE |
| Batch 3 | N–T | COMPLETE |
| Batch 4 | U–AQ | NEXT |
| Worker binding | 12 Workers | PENDING |
| D1 binding | 4 D1 Domains | PENDING |
| API/Data/Security/Event/Test/Evidence | Full traceability | PENDING |

Feature-domain mapping coverage is now **20 / 43 Blueprint domains ≈ 46.5%**. This is mapping coverage only; it is not implementation or contract completion.

## 10. Contract Gate

Until all applicable Worker, D1, API, Data, Security, Runtime, Event, Test and Evidence links are resolved, this Mapping is **NOT contract-ready** and must not be used as authorization to implement missing ownership decisions.
