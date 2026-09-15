# Luckread 12-Worker Master v1.0

> Status: **ACTIVE / CANONICAL WORKER MASTER**
>
> Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` → `docs/00-PROJECT-BLUEPRINT-v1.4.md` → `docs/02-FINAL-MAPPING-v1.0.md` → this Worker Master.
>
> Promotion basis: `docs/10-WORKER-CHANGE-CONTROL-DECISION-v1.0.md`.
>
> Frozen topology: **12 Workers / 4 D1 domains / 25 Contract Tasks**.

## 1. Canonical status

This document is the authoritative identity and primary-responsibility definition for W01–W12.

Historical Worker models, including W00–W08 and the historical W01–W13 topology, remain historical evidence only. They must not be silently renamed, merged, deleted, or reused as current ownership.

No implementation, API contract, database ownership, or deployment decision may infer Worker authority from directory names, routes, Payload Collections, or existing code. Ownership is defined here and refined only through approved Mapping/Contract artifacts.

## 2. Canonical Worker Master

| ID | Canonical responsibility | Primary Task(s) | Primary D1 authority |
|---|---|---|---|
| W01 | Public API / Gateway / Developer & Admin API Boundary | T24 | None; API boundary only |
| W02 | Identity / Account / Authorization | T01,T02,T03 | D1-01 |
| W03 | Content / Article / Media / Translation | T05,T06,T07,T15 | D1-02 |
| W04 | Feed / Recommendation / Search | T08,T09,T10 | Derived/projection boundary; no new D1 |
| W05 | Social / Community / Messaging / Notification | T11,T12,T13,T14 | D1-02; D1-03 only for scoped runtime delivery state |
| W06 | Rights / Trust & Safety / Governance | T19,T20,T21 | D1-03 |
| W07 | Subscription / Commerce / Payment / Advertising | T16,T17,T18 | D1-04; scoped D1-01 entitlement transition only |
| W08 | Creator / Organization | T04 | D1-01 |
| W09 | Platform / Storage / Reliability | T25 | D1-03 |
| W10 | Async / Queue / Job Execution | None | D1-03 scoped execution only |
| W11 | Growth / Campaign / Analytics / Operations | T22,T23 | D1-03 |
| W12 | External Developer / Integration Execution | None | No default business D1 authority |

## 3. Primary Task ownership

Every Contract Task has exactly one authoritative Primary Worker:

- T01 → W02
- T02 → W02
- T03 → W02
- T04 → W08
- T05 → W03
- T06 → W03
- T07 → W03
- T08 → W04
- T09 → W04
- T10 → W04
- T11 → W05
- T12 → W05
- T13 → W05
- T14 → W05
- T15 → W03
- T16 → W07
- T17 → W07
- T18 → W07
- T19 → W06
- T20 → W06
- T21 → W06
- T22 → W11
- T23 → W11
- T24 → W01
- T25 → W09

W10 and W12 are execution/integration boundaries and therefore do not receive an artificial Primary Task.

## 4. Non-negotiable authority boundaries

1. Public API exposure does not create business-state ownership.
2. W01 is not a universal database writer.
3. W04 owns feed/discovery execution but does not create a Feed/Search/Recommendation authority D1.
4. W07 owns commerce and financial workflows; D1-04 is the financial authority.
5. Subscription and access state remain authoritative in D1-01; payment and financial facts remain authoritative in D1-04.
6. W10 executes asynchronous work but does not become a second owner of T25.
7. W12 executes external integrations but does not become a second owner of T24.
8. Cross-D1 mutations require explicit event, idempotency, authorization, timeout, retry, audit, and reconciliation semantics.
9. No Worker receives unrestricted write access to all D1 domains.
10. Payload Core remains immutable; only supported extension points are permitted.
11. Cache, feed, recommendation, search, analytics, and other projections cannot silently become authoritative data stores.
12. Cloudflare-specific runtime choices must remain replaceable for later PostgreSQL/GCP migration.

## 5. Runtime/resource boundary

Worker contracts must explicitly declare access to:

- D1
- R2
- Cache
- Queue
- Cron / scheduled execution
- Secrets / environment bindings
- external integrations

Runtime access to a resource does not make that resource authoritative for the Worker.

W10 may execute queued/background work under the authority of the owning Worker/Task and approved event contract. W12 may execute external integration workflows under an explicit integration contract and must not acquire unrestricted business-data write authority.

## 6. Worker-to-Worker rules

Worker-to-Worker communication is not implied by shared functionality.

Any such call must have an explicit contract defining at minimum:

- caller and callee Worker IDs;
- API/event operation ID and version;
- authentication/authorization requirements;
- request/response or event schema;
- timeout and retry policy;
- idempotency semantics where mutation is possible;
- backpressure/failure behavior;
- audit/observability requirements;
- test and evidence references.

No Worker-to-Worker call may be introduced merely to compensate for an unclear ownership boundary.

## 7. Payload boundary

Payload Core is not a Worker business-logic container and must not be forked, patched, copied, or modified outside supported extension points.

Payload-related implementation must respect the canonical Worker boundary, API boundary, authorization model, D1 ownership model, and migration constraints established by the Blueprint and subsequent Contracts.

## 8. Promotion and freeze result

The Worker Change-Control decision has promoted the candidate topology to the canonical Worker Master without changing the frozen counts or adding capabilities.

| Dimension | Status |
|---|---|
| Worker count | **12/12 CANONICAL** |
| Worker identities | **12/12 CANONICAL** |
| Primary Task ownership | **25/25 CANONICAL** |
| Worker boundary | **FROZEN** |
| Historical topology reconciliation | **CLOSED** |
| Worker → D1 binding | **NEXT GATE** |
| Feature → Task → Worker → D1 Mapping | **BLOCKED until D1 binding** |
| Mapping Freeze | **BLOCKED** |
| Contract generation | **BLOCKED** |
| Implementation authorization | **BLOCKED** |

## 9. Next mandatory gate

The next artifact is the **Worker × D1 Binding Mapping**.

It must bind all 12 Workers to the canonical 4-D1 topology while preserving:

- one authoritative D1 owner per authoritative entity;
- no implicit fifth D1;
- no unrestricted cross-domain writer;
- D1-01 identity/account/access authority;
- D1-02 content/community authority;
- D1-03 platform operations/governance/runtime authority;
- D1-04 commerce/financial authority;
- explicit read/write/scoped permissions;
- cross-D1 event and reconciliation requirements.

Only after that binding is audited can the Final Mapping be frozen and Contract generation be authorized.

## 10. Contract-First gate

The canonical sequence remains:

**Blueprint → Architecture Blueprint → 25 Tasks → 12 Worker Master → 4 D1 Master → Mapping → Contracts → Implementation → Tests → CI → Deployment → Evidence**

No Contract may authorize a Worker responsibility that is absent from this Master or a subsequent approved Mapping change.
