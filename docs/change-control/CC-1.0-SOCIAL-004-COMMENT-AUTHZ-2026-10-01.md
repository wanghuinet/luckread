# Change Control — SOCIAL-004 Comment Authorization Closure — 2026-10-01

- Status: `CONTRACT-FIRST / VERIFICATION-PENDING`
- Work branch: `work/social-follow-subscription-20261001`
- Scope: reconcile the existing comment/read/edit/delete API authorization boundary before runtime admission.

## Contracted permissions

- `comment.read` — public resource visibility scope.
- `comment.create` — authenticated actor/resource scope.
- `comment.update` — author or moderator scope.
- `comment.delete` — author or moderator scope; audit required.

These permissions were already documented as intended comment capabilities; this change formalizes them in the canonical permission catalog.

## Existing API routes reused

- `listComments`
- `createComment`
- `patchCommentsCommentId`
- `deleteCommentsCommentId`

No new operationId, Worker, D1, Task, Payload Collection, or storage authority is introduced.

## Concurrency and safety

- Comment edit requires `If-Match` and returns HTTP 412/428 on optimistic-concurrency preconditions.
- Comment edit/delete require `Idempotency-Key`.
- Author identity remains server-derived.
- Moderation, visibility, block/mute and anti-abuse remain enforced by Social policy.
- Durable delete remains a state transition, not silent physical removal.

## Verification boundary

This does not claim W05 runtime GREEN, migration execution, remote D1 evidence, moderation E2E, concurrency E2E or Evidence Registry completion.

## Next gate

Resolve W05 trusted-admission inputs -> controlled `social_comments` migration -> runtime/security/concurrency evidence -> Evidence Registry reconciliation.
