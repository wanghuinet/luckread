# Change Control: SOCIAL-004 Comment API Surface Reconciliation — 2026-10-01

**Status:** CONTRACTED_PARTIAL / IMPLEMENTATION_NOT_AUTHORIZED

## Decision

The canonical P0 Comment API surface is the singular path pair:
- `GET /v1/content/{contentId}/comments` → `getContentContentIdComments`
- `POST /v1/content/{contentId}/comments` → `postContentContentIdComments`

The plural paths under `/v1/contents/{contentId}/comments` remain discovery-only and are not granted a second authoritative runtime surface.

## Contract bindings

- Worker owner: W05.
- Data authority: D1-02.
- Comment lifecycle authority: `contracts/enums/comment-state.json`.
- Create Comment requires `Idempotency-Key`; relation mutations must converge under retry.
- Server-side visibility, block and moderation checks remain mandatory before runtime admission.
- Existing Comment schema state values `PENDING/PUBLISHED/REJECTED` are superseded by the canonical CommentState contract for current reconciliation; historical discovery text is not rewritten.

## Explicit non-decisions

No Comment entity fields beyond the already exposed API fields are invented here. No D1 schema, migration, moderation decision API, runtime route, or Evidence Registry PASS is implied.

## Remaining gate

SOCIAL-004 stays unresolved for Mapping 0 downstream reconciliation until Entity → Field → Persistence → Security/Policy → Runtime → Test → Remote Evidence are bound and verified.
