# Messaging Phase 1 — Implementation Authorization

**Status:** USER-AUTHORIZED / PHASE-1-BOUNDED / VERIFICATION-PENDING

## Decision

The project owner explicitly instructed: "开始实现代码，别停下来等指令" on 2026-11-21. This authorizes implementation work for the bounded Messaging Phase 1 scope below. It does not authorize deployment, production database mutation, worker topology changes, or merging another engineer's PR.

## Authority and runtime

- Business owner: W05 — Social / Community / Messaging / Notification.
- API boundary: W01 only.
- Persistence authority: D1-02, using the existing W05 Neon PostgreSQL connection through HYPERDRIVE_D1_02.
- Identity: W01 authenticated principal forwarded through the existing W01→W05 Service Binding.
- Existing W05 Block relationship is enforced before direct-conversation creation and message sending.
- Notifications are not the authoritative message store.

## Phase 1 implementation scope

- Create/reuse a 1:1 direct conversation.
- List the authenticated user's conversations.
- Send and list text messages.
- Enforce membership on every conversation read/write.
- Require Idempotency-Key for message send and enforce sender-scoped deduplication.
- Allocate a strictly increasing per-conversation sequence under a PostgreSQL row lock.
- Maintain a monotonic per-member read cursor.
- Use bounded cursor pagination and no-store responses.

## Explicitly deferred

Group conversations, attachments, message requests, message edit/recall/delete, typing, presence, WebSocket/DO realtime, generic Queue fan-out, push delivery and production rollout are not part of this authorization. These require their own contracts and infrastructure admission.

## Guardrails

- No new Worker, D1 database, Queue, Durable Object, or Service Binding.
- No D1 adapter or SQLite fallback in new Messaging runtime.
- No production migration apply, deploy, or Neon data mutation in this phase.
- No administrator default access to private message content.
- Do not mark the full N-messaging batch or B10-B12 GREEN from Phase 1 implementation alone.
- Do not merge any PR created by another engineer.

## Verification required

TypeScript, focused W05 tests, W01 route tests, OpenAPI/contract CI, PostgreSQL 18 empty-schema rehearsal, migration parity and authorization/idempotency/concurrency tests must pass before the phase can be considered complete.
