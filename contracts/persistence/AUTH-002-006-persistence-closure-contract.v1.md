# AUTH-002–AUTH-006 Persistence Closure Contract v1.1

## Status

`CONTRACTED_NOT_VERIFIED / NOT_GREEN`

This contract freezes the persistence obligations before runtime implementation. It does not claim that the remote D1 schema or migrations already exist.

## Authority

- `contracts/alignment/mapping-batches/AUTH-002-006-shared-closure-matrix.v1.md`
- `contracts/entity/entity-catalog.v1.json`
- `contracts/entity/entity-field-contract.v1.json`
- `contracts/api/auth-operation-policy.v1.json`
- `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`

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

### Native Payload persistence authority

Payload 3.87.1 native session state in `users.sessions[]` remains authoritative for:

- `id`;
- `createdAt`;
- `expiresAt`.

These native fields MUST be reused and MUST NOT be duplicated into extension storage.

### Extension persistence authority

The unsupported canonical dimensions are persisted only in `auth_session_state`, keyed by the native session identifier:

- `session_id` = native `users.sessions[].id`, primary key;
- `user_id` = authoritative User identity;
- `device_id` = canonical device binding;
- `token_version` = server-controlled invalidation state;
- `refresh_credential_hash` = secret-derived refresh verifier;
- `revoked_at` = durable revocation state;
- `last_seen_at` = bounded activity state.

Required supporting indexes:

- `auth_session_state_user_id_idx`;
- `auth_session_state_device_id_idx`;
- `auth_session_state_token_version_idx`;
- `auth_session_state_revoked_at_idx`.

`session_id` uniqueness is mandatory. A physical foreign key to a native embedded `users.sessions[]` element is not permitted; that relationship is logical.

`raw_access_token`, `raw_refresh_token`, and `password` MUST NOT exist in the extension schema.

Required verification: extension uniqueness, user isolation lookup, token-version state, revocation state, secret non-persistence, native session shape preservation, and one-to-one native-sid correlation.

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

For AUTH-002 specifically, the migration MUST create only the contracted extension state and MUST NOT modify Payload native `users.sessions[]` shape or duplicate native `id`, `createdAt`, or `expiresAt`.

## Fail-closed gate

No entity is promoted to `VERIFIED` merely because this contract exists. The following remain mandatory: actual migration, actual remote schema inspection, runtime persistence tests, security/concurrency tests, Evidence Registry entries, and final Mapping 0 validation.
