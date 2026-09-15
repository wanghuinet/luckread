# Luckread 12-Worker Master v1.0

> Status: **ACTIVE / CANONICAL WORKER TOPOLOGY MASTER**
>
> Scope: final Luckread implementation topology.
>
> Source of truth: `docs/00-PROJECT-BLUEPRINT-v1.4.md`.

## 1. Frozen topology

Luckread final implementation target:

- 25 Contract Tasks
- 12 Workers
- 4 D1 Domains

The 12 Workers below are the only canonical runtime boundaries for this implementation baseline. Legacy Worker identifiers from superseded topology documents are not canonical and must not be reused as an alternative topology.

## 2. Worker Master

| ID | Canonical responsibility | Primary Tasks | Boundary |
|---|---|---|---|
| W01 | Public API / Gateway | T01,T02,T03,T08,T10,T11,T12,T13,T14,T15,T16,T17,T18,T19,T20,T21,T22,T23,T24 | Client-facing API admission, canonical DTO/error/auth entry, rate-limit admission |
| W02 | Identity & Access | T01,T02,T03 | Identity, account state, sessions, authorization, entitlement and scope decisions |
| W03 | Content & Media | T05,T06,T07,T19 | Authoritative content lifecycle, article/text, media metadata and rights-linked content operations |
| W04 | Feed & Discovery | T08,T09,T10,T11 | Feed/discovery, recommendation, search and social read models |
| W05 | Community & Messaging | T12,T13,T14 | Comments/community, messaging and notification workflows |
| W06 | Trust & Safety | T20,T21,T19 | Moderation, abuse/risk, reports, appeals and safety enforcement |
| W07 | Commerce & Monetization | T16,T17,T18,T22 | Subscription, paid content, payment/revenue, advertising and monetization growth |
| W08 | Creator & Organization | T04,T22,T24 | Creator, organization/MCN, enterprise-facing creator operations |
| W09 | Platform & Storage | T25 | R2/object storage, cache boundary, provider adapters and platform storage services |
| W10 | Async & Jobs | T23,T25 | Queue, scheduled jobs, aggregation, indexing/rebuild, compensation and batch work |
| W11 | Operations & Administration | T23,T24,T25 | Admin/support, configuration, feature flags, operational controls and deployment boundary |
| W12 | Developer & Integration Platform | T24,T25 | Open API, SDK, webhooks, integrations, ecosystem and extension boundary |

## 3. Ownership rules

1. W01 is the public API admission boundary; it does not become the authoritative owner of every business domain it exposes.
2. W02 is authoritative for identity/access decisions.
3. W03 is authoritative for content/media business state.
4. W04 owns discovery/read-model computation and does not become authoritative for source business state.
5. W05 owns community/messaging/notification workflows within its contract scope.
6. W06 is the authoritative trust/safety enforcement boundary and owns security-sensitive governance actions within its scope.
7. W07 owns monetization workflows; financial provider confirmation remains event/signature validated.
8. W08 owns creator/organization operations; authorization still follows W02 policy.
9. W09 provides infrastructure adapters and object/cache boundaries; it is not a business source of truth.
10. W10 owns asynchronous execution and must use idempotent jobs/consumers.
11. W11 owns administrative/operational controls and must not bypass domain authorization.
12. W12 owns developer/integration contracts and webhook delivery; it must not bypass internal authorization.

## 4. Runtime rules

- Client → Worker chains are not the default. A request should terminate at one appropriate Worker whenever practical.
- Worker-to-Worker calls require explicit contract ownership, authorization, timeout, retry, observability and cost justification.
- No Worker may introduce a new D1 domain.
- No Worker may write another domain's authoritative tables merely because it can access them.
- Derived/read-model Workers cannot silently become authoritative sources.
- High-frequency events use W10 where asynchronous aggregation is justified.
- Payload Core remains immutable; Payload is the application/CMS foundation, not a generic Worker business-code dumping ground.

## 5. Legacy reconciliation

The repository contains historical topology artifacts defining W00–W08 and another historical topology artifact containing W01–W13 logical workers. Those documents are retained as evidence/reference only.

They do not override this Master. The current architecture explicitly requires 12 Workers, and historical identifiers must not be promoted into the final topology without formal Blueprint Change Control.

## 6. Task binding summary

| Task | Primary Worker |
|---|---|
| T01 | W02 |
| T02 | W02 |
| T03 | W02 |
| T04 | W08 |
| T05 | W03 |
| T06 | W03 |
| T07 | W03 |
| T08 | W04 |
| T09 | W04 |
| T10 | W04 |
| T11 | W04 |
| T12 | W05 |
| T13 | W05 |
| T14 | W05 |
| T15 | W01 |
| T16 | W07 |
| T17 | W07 |
| T18 | W07 |
| T19 | W03 |
| T20 | W06 |
| T21 | W06 |
| T22 | W07 |
| T23 | W11 |
| T24 | W12 |
| T25 | W09 |

Secondary participation does not transfer authoritative ownership.

## 7. Binding gate

This Master freezes Worker identity and primary Task ownership. D1 ownership remains a separate Data Master and must not be inferred from this document.

Required next artifact:

`docs/05-D1-MASTER-v1.0.md`

That artifact must define the four D1 domains, authoritative entities, write ownership, cross-domain reference rules and migration boundary.
