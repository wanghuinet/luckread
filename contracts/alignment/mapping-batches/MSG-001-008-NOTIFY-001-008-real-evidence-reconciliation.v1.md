# MSG-001..MSG-008 / NOTIFY-001..NOTIFY-008 Real-Evidence Reconciliation v1

Status: `BLOCKED_NOT_GREEN`
Implementation authorization: `false`
Mapping mode: `Evidence-bound only; fail-closed`
Canonical source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
Canonical feature inventory: `contracts/alignment/feature-inventory.v1.json`

## 1. Scope

- MSG-001 one-to-one messaging
- MSG-002 group messaging
- MSG-003 message attachments
- MSG-004 reply/forward/mention
- MSG-005 read receipt/typing state
- MSG-006 recall/delete/archive
- MSG-007 conversation mute/block
- MSG-008 messaging abuse controls
- NOTIFY-001 in-app notifications
- NOTIFY-002 push notifications
- NOTIFY-003 email notifications
- NOTIFY-004 SMS extension
- NOTIFY-005 notification preferences
- NOTIFY-006 digest
- NOTIFY-007 quiet hours
- NOTIFY-008 security/payment/moderation notifications

## 2. Authoritative evidence found

- `docs/56-NOTIFICATION-IM-REALTIME-MESSAGING-SYSTEM-CONTRACT-v1.0.md` — canonical notification / IM / realtime-messaging authority (messaging, push/email/sms notifications, preferences, digest, quiet hours, security/payment/moderation notifications).
- `docs/148-MESSAGE-CENTER-EXPERIENCE-CONTRACT-v1.0.md` — message-center experience surface.
- `docs/163-EVENT-SEMANTICS-DELIVERY-ORDERING-REPLAY-DLQ-CONTRACT-v1.0.md` — message/notification delivery, ordering and replay semantics.
- `docs/305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md` — message idempotency/dedup.

These are authoritative messaging contracts, not executable messaging/notification runtime.

## 3. Common closure gaps (apply to all records)

- canonical message/conversation/notification entity, fields and DTO;
- realtime transport (WebSocket/edge) and ordering/dedup authority;
- attachment/media reference handling (`docs/57` media authority);
- read-receipt/typing ephemeral-state semantics and privacy mirroring;
- recall/delete/archive propagation and retention (`docs/160`);
- preference/digest/quiet-hours store and scheduling;
- push/email/sms delivery via provider adapters (`docs/56`/`docs/163`);
- abuse-control and blocked-list enforcement (`docs/62` risk authority);
- Payload / Worker code owner, executable tests and Evidence Registry provenance.

## 4. Feature notes

All MSG-001..MSG-008 and NOTIFY-001..NOTIFY-008 are `BLOCKED_NOT_GREEN`:

- MSG features (MSG-001..MSG-008) — see `docs/56`/`docs/148`; messaging surface is contracted but has no bound entity/persistence/transport/runtime or executable evidence.
- NOTIFY features (NOTIFY-001..NOTIFY-008) — see `docs/56`/`docs/148`; notification surface and preference/digest/quiet-hours semantics are contracted but have no bound delivery runtime or executable evidence.

## 5. Admission decision

`MSG-001..MSG-008 / NOTIFY-001..NOTIFY-008 = BLOCKED_NOT_GREEN`

No messaging/notification runtime implementation is authorized by this batch. Contract/design evidence exists; executable evidence is not closed.