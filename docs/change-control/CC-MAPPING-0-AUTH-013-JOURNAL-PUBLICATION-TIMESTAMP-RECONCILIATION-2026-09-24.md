# AUTH-013 — Journal Publication Timestamp Reconciliation — 2026-09-24

- Feature: AUTH-013
- Scope: D1-01 durable publication journal → Queue transport
- Status: APPROVED RECONCILIATION
- Repository authority: GitHub main

## Decision

The canonical Event Contract requires `publishedAt`. AUTH-013 Q1 defines the D1-01 publication journal as the durable publication boundary.

Therefore, for AUTH-013:

`publishedAt` = timestamp at which the immutable event envelope is durably committed to `auth_013_publication_journal` in the same D1-01 atomic transaction as the Account State transition.

The later Cloudflare Queue delivery is transport delivery, not a second mutation of the canonical event envelope.

## Invariants

- `occurredAt` identifies the Account State transition occurrence.
- `publishedAt` identifies durable publication of that event intent.
- The event JSON stored in the journal is immutable after the atomic commit.
- The Queue publisher MUST publish the exact stored event envelope and MUST NOT rewrite `publishedAt`, `eventId`, `sourceVersion`, actor, before/after state, or reason.
- Queue delivery time is observable through transport metrics / consumer evidence and is not written back into the canonical event payload.
- This does not make the journal a business authority.
- W02/D1-01 remains the sole Account State authority.
- W06/D1-03 remains the AuditEvent authority.

## Acceptance

This reconciliation does not change the Event Contract schema, Worker count, D1 count, Queue topology, or Account State transition matrix. It resolves only the timestamp semantics needed to implement the already-approved durable publication boundary without creating mutable event payloads or falsely claiming Queue delivery before it occurs.
