# CC-T14-W05-D1-03-PUSH-ENDPOINT-REGISTRATION-2026-11-04

## Status

`IMPLEMENTATION_SLICE / REMOTE_BINDING_AND_MIGRATION_PENDING`

## Scope

Admit one W09-owned D1-03 platform runtime entity for Expo push routing, with a narrowly scoped W05/T14 delegated writer for registration and self-service deletion.

This slice does not implement push sending, W10 scheduling, Queue delivery, notification preferences, in-app notification storage, or authentication device/session management.

## Existing authority basis

- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`: W05 owns notification domain behavior and may access D1-03 only for scoped notification/runtime delivery state.
- `contracts/transport/worker-d1-access-boundary.v1.json`: W05 is allowed D1-02 and D1-03; no new D1 domain is created.
- `docs/02-FINAL-MAPPING-v1.0.md`: T14 Notification is W05-owned with scoped D1-03 runtime delivery persistence.
- `docs/09-D1-DOMAIN-MASTER-v1.0.md`: D1-03 is platform operations/governance/runtime state and every entity class requires one explicit Worker owner.

## Decision

1. Register `ENT-NOTIFICATION-PUSH-ENDPOINT` as a W09/T25-owned D1-03 platform runtime entity; grant W05/T14 only the explicit self-service writer delegation recorded in `contracts/transport/d1-03-entity-owner-boundary.v1.json`.
2. Keep social notification inbox, notification preferences, read/unread state, and social event generation in existing W05 D1-02.
3. Keep authentication sessions, trusted devices, account identity, and session revocation in W02/D1-01. An `installation_id` is an app-generated correlation key only; it is not an authentication factor or trusted device identifier.
4. Add only the existing D1-03 database as a second, scoped D1 binding on W05 to execute the approved W05/T14 delegation. W09 remains the primary owner. Preserve existing D1-02 binding and its `migrations/` directory unchanged.
5. Set `migrations_dir=migrations-d1-03` only on W05's D1-03 binding. The controlled migration workflow targets the existing database name `secondary` and verifies the remote schema before the Worker is deployed with the new binding.
6. No Service Binding, Worker, D1 database, Queue, KV namespace, or Payload Core change is introduced.

## Data boundary

The table stores only the current push route for an app installation:

- canonical W02 user ID from the W01-authenticated principal;
- app-generated installation UUID;
- fixed provider `expo`;
- platform `ios|android`;
- Expo push token, private routing address only;
- permission state, app version, and timestamps.

Push tokens are never returned from W01/W05 APIs and must never enter logs, analytics payloads, URLs, or error messages. Unknown client fields, including `userId`, `ownerUserId`, account state, session ID, or trusted-device claims, are rejected.

A denied or undetermined permission state clears any previously stored token, preventing stale delivery. An installation can register again after token rotation. A token already bound to another installation returns a generic conflict without identifying the other owner.

## API

- `PUT /v1/push/endpoints/{installationId}`: idempotent, authenticated endpoint upsert.
- `DELETE /v1/push/endpoints/{installationId}`: idempotent, owner-scoped deletion.

Both operations enter W01, resolve the existing session, and call W05 through the already-existing W01→W05 Service Binding. W05 accepts only trusted W01 transport headers and L2+ principal context.

## Resource and deployment controls

- One D1-03 write per registration/deletion; no read-before-write.
- No notification fan-out or Queue enqueue in this slice.
- W05 D1-02 remains bound to `luckreadpro`; D1-03 is the existing `secondary` database.
- The D1-03 migration uses its own directory and migration ledger; it must not apply against D1-02.
- Apply the D1-03 migration first, verify table/index/ledger readback, then deploy the W05 exact-SHA binding update.

## Acceptance

- W05 unit tests prove actor identity is server-derived, token is not returned, token collision fails generically, disabled permission clears token, and deletion is owner-scoped.
- W01 tests prove bearer/cookie session principal resolution, write rate limiting before auth, and no direct D1/Payload access.
- CI statically verifies the exact D1-02 + D1-03 binding UUIDs and separate migration directories.
- Remote migration and Worker deployment remain pending until their explicit workflow_dispatch gates are run against a merged main SHA.
