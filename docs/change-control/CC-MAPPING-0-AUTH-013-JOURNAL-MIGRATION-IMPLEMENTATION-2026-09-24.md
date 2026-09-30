# AUTH-013 — D1-01 Durable Publication Journal Implementation Admission — 2026-09-24

- Feature: AUTH-013
- Slice: 1 — D1-01 Durable Publication Journal
- Status: ADMITTED / RUNTIME EVIDENCE PENDING
- Authority: CC-MAPPING-0-AUTH-013-EVENT-ACTOR-TRANSPORT-AUTHORITY-2026-09-24
- Minimum Contract Delta: CC-MAPPING-0-AUTH-013-MINIMUM-CONTRACT-DELTA-2026-09-24
- Repository authority: GitHub main

## 1. Admission evidence

Current main at admission: 6f935d72cdeb2440121b62e42a495e62eb88a055.

Actions run 35995377171 at this head reports the AUTH-013 event Contract Admission Gate and the other core Contract CI matrix gates as SUCCESS. The same workflow still has pre-existing Five-Way / Strict R4-Evidence-R5 downstream failures; those are not AUTH-013 contract-definition failures and are not used as runtime GREEN evidence.

## 2. Scope

This slice admits only the physical D1-01 durable publication journal required by the approved Q1=A decision.

The journal is a durable publication boundary, not an Account State authority.

The authoritative Account State remains W02 / D1-01 / users.account_state + users.account_state_version.

## 3. Physical contract

The journal target is auth_013_publication_journal and contains the minimum durable event metadata and publication lifecycle fields admitted by the Minimum Contract Delta:

- journal_id
- event_id
- event_type
- schema_version
- resource_id
- source_version
- payload
- status
- attempt
- next_attempt_at
- created_at
- published_at
- last_error_code

Required invariants:
- event_type = identity.account_state_changed
- schema_version = 1.0
- status is PENDING, PUBLISHED, or FAILED
- attempt >= 1
- event_id is unique
- one row per resource_id + event_type + source_version
- the journal is not business authority
- W02/D1-01 remains the authoritative writer for Account State and this durable intent boundary
- W02 does not write D1-03

## 4. Atomicity boundary

The migration creates only the persistence boundary. The next Slice must implement users.account_state/version UPDATE + journal INSERT in one D1-01 atomic transaction.

No W02 transition code is changed by this slice.

## 5. Remote execution gate

Remote mutation is NOT EXECUTED by this commit.

Controlled workflow:
.github/workflows/auth-013-publication-journal-migration.yml

It requires an exact source_sha, exact D1-01 database display name, explicit APPLY confirmation, preflight absence of the journal table, post-migration schema proof, index proof, migration ledger proof, and an uploaded evidence artifact.

## 6. STOP conditions

Stop when the D1-01 binding differs from the admitted UUID, the target journal already exists, the schema does not match this Contract, the migration source SHA is not pinned, or any Account State authority is moved into the journal.

## 7. Current state

Slice 1 source admission = OPEN for implementation; static CI and controlled remote migration evidence remain pending.

No Queue resource, W02 publisher, W06 consumer, side-effect integration, deployment, or E2E implementation is admitted by this slice.
