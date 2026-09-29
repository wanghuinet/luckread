# CC-MAPPING-0-AUTH-013-W04-PROJECTION-DEINDEX-GAP-2026-09-29

## Status

`GAP_IDENTIFIED / IMPLEMENTATION_NOT_AUTHORIZED`

## Authority

- Repository authority: GitHub `main`
- Frozen topology: 12 Workers / 4 D1
- Canonical W04 responsibility: Feed / Recommendation / Search
- Primary Tasks: T08, T09, T10
- W04 boundary: derived/projection only; no new authoritative D1

## Verified current facts

1. AUTH-013 W02 state-transition kernel and D1 persistence are already verified.
2. AUTH-013 W06 AuditEvent transport/persistence is already verified through the admitted Queue consumer path.
3. AUTH-013 public HTTP security/concurrency and authoritative D1 assertions are already verified by Run `36503534440`.
4. The canonical account state machine declares deindex states:
   `FROZEN`, `SUSPENDED`, `BANNED`, `DELETION_PENDING`, `DELETED`.
5. Current repository search does not establish an executable canonical W04 Feed/Recommendation/Search projection/deindex runtime.
6. The historical `workers/W04-social` directory is explicitly non-authoritative and cannot be promoted by path inference.
7. Current repository search also does not establish a separate executable canonical authorization-cache invalidation runtime boundary.

## GAP

AUTH-013 cannot be promoted to GREEN from the current evidence set because the downstream projection/cache side-effect boundary is not executable/evidence-backed at feature-wide scope.

The missing scope is:

`identity.account_state_changed`
→ existing admitted event/queue boundary
→ canonical W04 projection/deindex execution
→ cache/version invalidation behavior where contracted
→ observable convergence evidence for the declared lifecycle states.

## Required admission inputs

Before implementation or deployment of this slice:

1. Bind W04 to a concrete current Worker resource and T08/T09/T10 runtime entrypoints using the existing Worker Master and binding rules.
2. Confirm the projection data/index destinations already permitted by the contracts; do not create an authoritative D1.
3. Define the smallest event-consumer boundary using the existing `identity.account_state_changed` stream.
4. Confirm cache invalidation/version semantics against `AUTHZ-CACHE-INVARIANT-001` and the existing cache contract.
5. Produce a minimal Change Control / implementation admission record covering rollback, idempotency, retry and evidence requirements.

## Minimum evidence target

A successful controlled evidence slice must prove, without changing authoritative ownership:

- one supported lifecycle transition produces exactly one consumable canonical event;
- W04 consumes it idempotently;
- affected feed/search/content projection entries converge to the contracted visibility/deindex state;
- stale projection cannot override authoritative D1 state;
- cache/version behavior cannot grant authorization from stale state;
- replay/duplicate delivery does not duplicate or regress projection state;
- synthetic fixtures are fully cleaned or retained only where the evidence contract explicitly requires immutable audit data.

## Non-changes

- No new Worker.
- No new D1.
- No direct W02 → D1-03 writer.
- No Payload Core modification.
- No public API redesign.
- No shortcut around the canonical account state machine.
- No GREEN promotion from this GAP record.

## Controls

Backup: `backup/pre-auth013-w04-projection-gap-20260929`
Working branch: `docs/auth013-w04-projection-gap-20260929`
