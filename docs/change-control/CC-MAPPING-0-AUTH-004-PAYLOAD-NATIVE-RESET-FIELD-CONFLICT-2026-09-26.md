# CC-MAPPING-0-AUTH-004-PAYLOAD-NATIVE-RESET-FIELD-CONFLICT-2026-09-26

- Feature: `AUTH-004`
- Scope: W01 Payload native authentication persistence versus AUTH-004 recovery-token persistence rules
- Status: `BLOCKED_DECISION_REQUIRED`
- Implementation authorization: `false`
- Runtime authorization: `false`
- Mapping-0 promotion: `false`

## 1. Observed repository fact

The current W01 Payload migration `workers/W01-payload/src/migrations/20250929_111647.ts` creates the native `users` table with:

- `reset_password_token`
- `reset_password_expiration`

The current `workers/W01-payload/src/collections/Users.ts` enables Payload authentication with `auth: true`.

The repository therefore contains a native Payload schema surface capable of holding a reset-password token/expiration pair, even though the current source inspection does not by itself prove that the application actively writes the raw token through that surface.

## 2. AUTH-004 authority

The authoritative AUTH-004 persistence contract requires:

- raw reset token absent from persistence;
- recovery token represented only by derived material (`tokenHash`);
- purpose, issue/expiry, single-use consumption and invalidation state persisted;
- recovery challenge bound to identity;
- successful reset/change invalidates affected sessions;
- green requires executable persistence/runtime evidence.

Canonical source:

`contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`

Migration target:

`MIG-AUTH-004-PASSWORD-RECOVERY-V1` in `contracts/migration/AUTH-002-006-migration-manifest.v1.json`

## 3. Conflict boundary

This is a schema-authority conflict, not yet a runtime-behavior finding.

The unresolved question is:

> Can the existing Payload-native `users.reset_password_token` / `users.reset_password_expiration` schema surface be retained as inert legacy/native schema while AUTH-004 uses an independent verification/recovery persistence model, or must the native fields be removed/superseded before AUTH-004 implementation is authorized?

No automatic answer is admitted by this Change Control.

## 4. Required decision material

Before implementation or migration execution, resolve all of the following:

1. Whether Payload's native reset-password fields are authoritative, legacy/inert, or forbidden for AUTH-004.
2. Whether retaining the physical columns violates the AUTH-004 `rawTokenNeverPersisted` invariant.
3. Whether a Payload configuration/core extension can disable the native recovery path without modifying Payload core.
4. If the native fields must be removed, define the migration/change order and backward-compatibility/recovery requirements.
5. Establish executable evidence that no raw recovery token is persisted or logged.

## 5. Evidence anchors

- W01 migration: `workers/W01-payload/src/migrations/20250929_111647.ts`
- W01 auth collection: `workers/W01-payload/src/collections/Users.ts`
- AUTH-004 field contract: `contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`
- AUTH migration manifest: `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
- Existing schema evidence also records `reset_password_token` / `reset_password_expiration` in the controlled AUTH baseline artifacts.
- No AUTH-004 runtime implementation is authorized by this document.

## 6. Gate impact

Until this conflict is resolved:

- AUTH-004 persistence remains `CONTRACTED_NOT_VERIFIED`.
- AUTH-004 Evidence Registry admission remains blocked.
- No raw-token runtime implementation may be inferred from Payload-native reset support.
- No migration execution may be claimed.
- No Mapping-0 GREEN may be claimed from this Change Control.
