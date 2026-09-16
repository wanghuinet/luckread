# AUTH-002–AUTH-006 Persistence Closure Contract v1.0

## Status

`CONTRACTED_NOT_VERIFIED / NOT_GREEN`

This contract freezes the persistence obligations before runtime implementation. It does not claim that the remote D1 schema or migrations already exist.

## Authority

- `contracts/alignment/mapping-batches/AUTH-002-006-shared-closure-matrix.v1.md`
- `contracts/entity/entity-catalog.v1.json`
- `contracts/entity/entity-field-contract.v1.json`
- `contracts/api/auth-operation-policy.v1.json`

## Common persistence invariants

1. Every authoritative authentication field has exactly one canonical persistence owner.
2. No credential secret, raw password, raw recovery token, raw verification token, or private WebAuthn key may be persisted.
3. Secret-derived material must use an explicit classification and documented hashing/derivation contract.
4. Security-state writes must be authoritative; stale cache or projection state must never override them.
5. Every schema change requires an ordered migration artifact and an executable migration verification result.
6. Production promotion requires schema evidence from the intended D1 environment, not documentation-only evidence.
7. Migration and runtime evidence must reference the same tested commit SHA.
8. Destructive or irreversible migration steps require an explicit rollback/forward-recovery contract before execution.

## AUTH-002 Session

Canonical entity: `ENT-SESSION`.

Required persisted fields are the fields frozen by `contracts/entity/AUTH-002-session-field-contract.v1.json`.

Required persistence properties:

- `id` unique and authoritative;
- `userId` indexed relation to User;
- `deviceId` indexed privacy-sensitive identifier;
- `tokenVersion` indexed monotonic authorization state;
- `refreshCredentialHash` secret-derived material and never returned;
- `expiresAt` indexed security metadata;
- `revokedAt` nullable write-once revocation state;
- `createdAt` immutable audit metadata;
- `lastSeenAt` mutable security metadata.

Required verification: uniqueness, expiry lookup, revocation write, token-version change, and session isolation by user.

## AUTH-003 Credential

Canonical authority must distinguish identity attributes from authentication credential material.

Required persistence classes:

- username identifier/value representation;
- normalized username uniqueness representation;
- email identifier/value representation where enabled;
- normalized email uniqueness representation where enabled;
- phone identifier/value representation where enabled;
- normalized phone uniqueness representation where enabled;
- credential state/lifecycle;
- verification state references;
- secret-derived credential material where applicable.

Normalization must be deterministic and versioned. Uniqueness must be enforced by authoritative persistence, not an application-only pre-check. Conflict behavior must not disclose whether a protected account exists beyond the public contract.

## AUTH-004 Recovery

Required persistence classes:

- recovery challenge identifier;
- purpose;
- target identity reference;
- token hash/derived secret representation;
- issued-at;
- expiry;
- consumed-at;
- invalidated-at where required;
- attempt/replay state where contract requires it.

Raw recovery tokens must never be persisted. A consumed or expired challenge cannot become valid again through retry or stale state.

## AUTH-005 Verification

Required persistence classes:

- verification challenge identifier;
- identity/credential reference;
- purpose/channel;
- token hash/derived representation;
- issued-at;
- expiry;
- consumed-at;
- revocation state.

Exactly one successful consumption is authoritative. Concurrent confirmations must resolve to one winner with all later attempts denied.

## AUTH-006 Passkey/WebAuthn

Required persistence classes:

- credential identifier;
- owning user/identity reference;
- credential public key material;
- relying-party identifier binding;
- sign-count/authenticator state where required by the WebAuthn contract;
- creation/update metadata;
- credential lifecycle/revocation state;
- challenge state for registration/assertion flows.

Private keys are never persisted. Challenge records are single-use, purpose-bound and time-bounded.

## Migration contract

For each AUTH-002–006 persistence change, the implementation batch must produce:

1. migration identifier;
2. ordered schema operations;
3. preconditions;
4. postconditions;
5. compatibility expectation;
6. rollback or forward-recovery strategy;
7. executable migration test;
8. remote D1 schema evidence;
9. evidence record bound to the tested commit SHA.

## Fail-closed gate

No entity is promoted to `VERIFIED` merely because this contract exists. The following remain mandatory: actual migration, actual remote schema inspection, runtime persistence tests, security/concurrency tests, Evidence Registry entries, and final Mapping 0 validation.
