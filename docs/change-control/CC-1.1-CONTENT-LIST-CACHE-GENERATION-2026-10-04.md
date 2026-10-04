# Change Control - 1.1 Content-List Cache Generation Invalidation - 2026-10-04

Status: CHANGE-CONTROL / IMPLEMENTATION-PENDING-RUNTIME-EVIDENCE

## GAP

The current public content-list cache correctly varies by locale, cursor, creator, limit and type, but successful content mutations only removed the canonical landing key. Filtered and paginated cache variants could therefore remain reachable for the 30-second TTL after an authoritative content update or state transition.

This is a real stale-list boundary, not an authorization bypass.

## Authority

The existing content contract already requires:
- public content-list edge caching with cursor/filter dimensions;
- cache invalidation for authoritative mutations;
- W01 as the application cache boundary;
- W03/D1-02 as the content authority.

No contract semantics are changed.

## Decision

Reuse the existing Cloudflare Cache API and introduce a generation marker for the `content-list` cache namespace.

Effective key shape:

`content-list + pathname + normalized query + locale + generation`

A successful mutation advances the generation marker. All prior list variants become unreachable without enumerating creator/type/limit/cursor combinations.

Generation state is derived cache metadata only. It is not a business authority.

If generation metadata cannot be read safely, W01 bypasses shared content-list caching and calls the authoritative loader directly. This preserves freshness and leaves the existing W01/W03 rate and origin guards as protection against origin pressure.

No new Worker, D1, Queue, binding, RPC or external purge credential is introduced.

## Invalidation Semantics

The generation mechanism is scoped to the existing Cache API locality. It is not represented as a global cross-colo purge primitive.

Old cache entries are intentionally left to normal expiry/eviction; they cannot be selected by subsequent content-list reads once the generation changes.

## Acceptance

1. Normal content-list MISS/HIT continues to work.
2. Authenticated content-list requests remain outside shared cache.
3. A successful content mutation advances the content-list generation.
4. Filtered/paginated list variants from the previous generation become unreachable.
5. Generation read failure bypasses shared cache.
6. Existing cache-miss fuse, origin concurrency limit and W01/W03 rate limits remain unchanged.
7. No new Worker/D1/Task/authority is introduced.
8. Runtime evidence is still required before production GREEN.

## Traceability

Base main SHA:
`5af8103e4566bff97347a4de370ae7fd401f44f2`

Related contracts:
- `contracts/api/content-operation-policy.v1.json`
- `docs/167-CACHE-INVALIDATION-HOT-KEY-STAMPEDE-CONTRACT-v1.0.md`

Related implementation:
- `workers/W01-payload/src/lib/public-response-cache.ts`
- `workers/W01-payload/src/lib/public-response-cache.test.ts`
