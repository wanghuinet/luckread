# CC-1.0 Creator Content Read v1 — 2026-09-30

**Status:** CHANGE-CONTROL / READY FOR RECONCILIATION

## Purpose

Authorize one bounded Creator Center read slice for content management without creating a second content authority.

## Scope

Implement a creator-scoped read operation behind W01:

`GET /api/creator/contents`

The response is sourced from W03 Content Authority (D1-02) and returns only records owned by the authenticated principal.

Supported query inputs:
- `cursor`: opaque cursor;
- `limit`: bounded page size;
- `status`: optional exact ContentState filter;
- `type`: optional `article | post | video` filter.

Ordering is deterministic by `updated_at DESC, id DESC`.

## Authority

- W01: authentication, creator principal resolution, application boundary.
- W03: authoritative content state and read data.
- D1-02: existing Content persistence only.
- Payload collections are not read as content authority.

## Security

- Authentication is required.
- ownerUserId comes only from W01 resolved principal.
- Client cannot supply an ownerUserId filter.
- Missing/invalid principal fails closed.
- Private content is never exposed outside the owning principal.
- No bearer token or Payload secret is forwarded to W03.

## Transport

Add one internal W01→W03 operation:

`listCreatorContents`
- method: GET
- internal path: `/internal/content/creator-contents`
- principal: required
- idempotency: false
- cache: no-store
- cursor pagination is bounded and stable.

This does not add a Worker, D1, Task, RPC surface, or public `/api/v1` operation.

## Non-goals

- no bulk mutation;
- no Personal Content Space `/v1/me/content` implementation;
- no analytics;
- no new persistence model;
- no search index;
- no cache authority;
- no lifecycle rule changes.

## Acceptance

1. authenticated creator receives only owned content;
2. status/type filters are enforced by W03;
3. cursor pagination is stable;
4. unauthenticated access fails closed;
5. cross-user content is not returned;
6. public `/api/v1/contents` behavior remains unchanged;
7. W03 Content Authority remains the sole source of truth.

## Gate

After this Change Control and transport reconciliation are GREEN, implementation may proceed as one reviewable code slice.
