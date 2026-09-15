# Luckread Worker Topology Change-Control Decision v1.0

> Status: **PROPOSED FOR CANONICAL PROMOTION**
> 
> Authority: `docs/00-PROJECT-BLUEPRINT-v1.4.md`
> 
> Depends on: `docs/09-D1-DOMAIN-MASTER-v1.0.md`

## 1. Purpose

This record closes the Worker topology reconciliation required before Contract-First implementation.

The Blueprint freezes the target at exactly **12 Workers / 4 D1 domains / 25 Contract Tasks**. This record does not change those counts and does not add capabilities.

Historical Worker topologies remain historical evidence and are not silently renamed, merged, or reused.

## 2. Canonical Worker candidates

| Worker | Responsibility | Primary Task | Primary D1 |
|---|---|---|---|
| W01 | Public API / Gateway / Developer & Admin API Boundary | T24 | None; API boundary only |
| W02 | Identity / Account / Authorization | T01,T02,T03 | D1-01 |
| W03 | Content / Article / Media / Translation | T05,T06,T07,T15 | D1-02 |
| W04 | Feed / Recommendation / Search | T08,T09,T10 | Derived/projection boundary; no new D1 |
| W05 | Social / Community / Messaging / Notification | T11,T12,T13,T14 | D1-02; D1-03 only for runtime delivery state |
| W06 | Rights / Trust & Safety / Governance | T19,T20,T21 | D1-03 |
| W07 | Subscription / Commerce / Payment / Advertising | T16,T17,T18 | D1-04; scoped D1-01 entitlement transition only |
| W08 | Creator / Organization | T04 | D1-01 |
| W09 | Platform / Storage / Reliability | T25 | D1-03 |
| W10 | Async / Queue / Job Execution | None | D1-03 scoped execution only |
| W11 | Growth / Campaign / Analytics / Operations | T22,T23 | D1-03 |
| W12 | External Developer / Integration Execution | None | No default business D1 |

## 3. Primary ownership invariant

Every Contract Task has exactly one Primary Worker:

T01→W02, T02→W02, T03→W02, T04→W08, T05→W03, T06→W03, T07→W03, T08→W04, T09→W04, T10→W04, T11→W05, T12→W05, T13→W05, T14→W05, T15→W03, T16→W07, T17→W07, T18→W07, T19→W06, T20→W06, T21→W06, T22→W11, T23→W11, T24→W01, T25→W09.

W10 and W12 are execution/integration boundaries and therefore do not require an artificial Primary Task.

## 4. Authority rules

1. Public API exposure does not create business-state ownership.
2. W01 is not a universal database writer.
3. W04 owns feed/discovery execution but does not create a Feed/Search/Recommendation authority D1.
4. W07 owns commerce and financial workflows; D1-04 is the financial authority.
5. Subscription/access state remains D1-01; payment and financial facts remain D1-04.
6. W10 executes asynchronous work but does not become a second owner of T25.
7. W12 executes external integration capabilities but does not become a second owner of T24.
8. Cross-D1 mutations require explicit event, idempotency, authorization, timeout, retry, audit, and reconciliation semantics.
9. No Worker receives unrestricted write access to all D1 domains.
10. Payload Core remains immutable; only supported extension points are permitted.

## 5. Infrastructure permissions

Worker contracts must explicitly declare, rather than infer, access to D1, R2, Cache, Queue, Cron, Secrets, and external integrations.

A Worker having runtime access to a resource does not make that resource authoritative for the Worker.

## 6. Promotion gate

This decision is ready for formal promotion only if the following invariants remain unchanged:

- exactly 12 Worker identities;
- exactly 25 Contract Tasks;
- exactly 4 D1 domains;
- exactly one Primary Worker per Task;
- exactly one Primary D1 per authoritative entity;
- no implicit fifth D1;
- no unrestricted cross-domain writer;
- no Worker-to-Worker call without an explicit contract;
- historical topologies remain non-authoritative;
- Mapping must contain Feature → Task → Worker → D1 → API → Data → Security → Event → Test → Evidence.

## 7. Gate status

| Gate | Status |
|---|---|
| Worker count | READY |
| Worker candidate boundaries | READY |
| Task primary uniqueness | READY |
| D1 Master dependency | GREEN |
| Historical conflict reconciliation | CLOSED for current decision |
| Canonical Worker Master promotion | **PENDING** |
| Worker × D1 Binding | **PENDING** |
| Mapping Freeze | BLOCKED until Worker promotion |
| Contract generation | BLOCKED until Mapping Freeze |
| Implementation | BLOCKED until Contract authorization |
