# CC-MAPPING-0-D1-03-OWNER-PARTITION-2026-10-01

Status: READY FOR CI / MERGE — NOT A MAPPING GREEN DECISION

## Finding

D1-03 already has a canonical domain role, but its entity list spans moderation, platform runtime, async execution and growth/operations. Without a Worker-level owner partition, the domain can become a generic operational sink.

## Minimum correction

Freeze the existing D1-03 responsibility into four Worker-owned areas:

- W06: moderation cases/decisions and report/appeal workflow state;
- W09: platform runtime, recovery, reconciliation and the append-only AuditEvent owner;
- W10: job/retry/DLQ and execution inbox/outbox/idempotency state;
- W11: campaign, analytics and growth/operations state.

Domain-local outbox/inbox/idempotency records remain with their source D1 and are not silently moved into D1-03.

## Non-changes

- No new entity/table.
- No D1 split.
- No Worker added.
- No runtime migration.
- No direct cross-D1 database access.
- No Mapping 0 GREEN promotion.

## Guard

`scripts/verify-d1-03-entity-owner-boundary.mjs` checks that each listed D1-03 entity has exactly one owner and that the owner is within the canonical W06/W09/W10/W11 set.