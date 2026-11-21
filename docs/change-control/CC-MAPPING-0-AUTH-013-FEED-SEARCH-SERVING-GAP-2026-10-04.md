# CC-MAPPING-0-AUTH-013-FEED-SEARCH-SERVING-GAP-2026-10-04

## Status

`GAP_CONFIRMED / IMPLEMENTATION_NOT_AUTHORIZED`

## Trigger

The following executable evidence is now verified:

- AUTH-013 Lifecycle Matrix: `EVD-AUTH013-LIFECYCLE-MATRIX-REMOTE-001`
- AUTH-013 W04 Side-Effect Matrix: `EVD-AUTH013-W04-SIDE-EFFECT-MATRIX-REMOTE-001`

The latest W04 matrix Run `37202032741` proves the canonical event consumer and derived projection/deindex behavior, but it does not prove user-facing Feed/Search serving convergence.

## Current runtime fact

Current `main` W04 source is:

- Worker: `luckread-w04`
- Path: `workers/W04-feed-search`
- Entrypoint: `workers/W04-feed-search/src/index.ts`

The current W04 entrypoint exposes only:

- `GET /health`
- Queue consumer handling for `identity.account_state_changed`

It has no user-facing Feed, Recommendation, or Search read route.

The current W04 projection implementation writes only the existing non-authoritative derived projection destination:

`AUTH013_W04_DERIVED_PROJECTION` → Cloudflare KV `globe`.

## Evidence boundary

Run `37202032741` proves:

`identity.account_state_changed`
→ W04 Queue Consumer
→ derived projection/deindex record

It does not prove:

`derived projection/deindex`
→ canonical Feed read eligibility
→ canonical Recommendation serving
→ canonical Search serving
→ cache-safe final result emission.

No evidence may infer these serving paths from the W04 Worker name or contract responsibility alone.

## Remaining AUTH-013 gap

The remaining feature-wide gap is:

`account_state authority`
→ `content/feed/search derived visibility`
→ `serving-time eligibility`
→ `public/shared-cache safety where applicable`

The Feed contract requires account-state eligibility before final result emission and requires cache keys to include every authorization/representation-changing dimension. The current W04 source does not yet expose the serving runtime needed to execute and observe that contract.

## Decision

1. Keep the completed lifecycle and W04 projection evidence VERIFIED.
2. Do not rerun the completed evidence workflows unchanged.
3. Do not infer Feed/Search runtime from Worker responsibility labels.
4. Do not add a new Worker or D1.
5. Do not create a public evidence-only workaround route.
6. Keep this item `BLOCKED_EXTERNAL / IMPLEMENTATION_NOT_AUTHORIZED` until the canonical Feed/Search serving implementation is admitted by Change Control.
7. Once implementation authorization exists, the minimum next slice is one bounded Feed/Search serving path using the existing W04 derived projection, with explicit serving-time account-state eligibility and cache-boundary evidence.

## Current topology

No change to the frozen 12 Worker / 4 D1 topology.

## Backup

`backup/2026-10-04-pre-auth013-feed-search-gap-reconciliation`
