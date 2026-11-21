# CC-MAPPING-0-AUTH-001-PAYLOAD-WIRE-COMPATIBILITY-2026-09-27

## Status

`WIRE_PERSISTENCE_COMPATIBILITY_BLOCKED`

## Current authoritative inputs

AUTH-001 currently exposes:

- required: `identityType`, `identity`, `credential`;
- optional: `username`, `consent`;
- `identityType = phone | email`;
- response enters `PENDING_VERIFICATION`;
- Idempotency-Key is required.

The active W01 Payload User boundary currently exposes:

- native Payload authentication;
- public create access for registration;
- required unique indexed `username`;
- displayName, bio, avatar, locale and timezone;
- no phone field.

The canonical ENT-USER field contract independently marks `username` as required/unique/indexed.

## Concrete incompatibilities

### A. Username

Wire contract: `username` optional.

Persistence contract: `ENT-USER.username` required.

No admitted rule derives or synthesizes a username when the client omits it.

### B. Phone

Wire contract: phone identity is supported.

Current User source: no phone field.

Therefore a committed User cannot currently provide a durable source for later W02 Identity materialization after a delivery failure.

### C. Consent

Wire contract: optional consent object.

Persistence authority: no canonical entity/field admitted.

Consent cannot be stored by inference in profile or identity fields.

### D. Idempotency

AUTH-001 requires durable replay semantics, but no AUTH-001-specific idempotency persistence is currently evidenced.

The existing D1-03 operational idempotency model is architectural authority only; it has not been concretely bound to AUTH-001 and using it directly would consume a second domain/write boundary outside the current registration envelope.

## Fail-closed conclusion

The current AUTH-001 request cannot yet be implemented safely against the active Payload User boundary without changing one or more contracts.

The following are not authorized by this control:

- silently making username required in the public API;
- silently synthesizing username;
- storing phone in username or another unrelated field;
- storing consent in an unrelated User/Identity field;
- adding a generic idempotency table;
- creating a new registration service;
- adding a cross-worker compensation path;
- changing Payload Core.

## Required governed reconciliation

Before implementation, Change Control must explicitly reconcile:

1. omitted-username semantics;
2. durable phone source;
3. consent persistence authority;
4. AUTH-001 durable idempotency/replay semantics;
5. the resulting atomic-vs-eventual registration consistency model.

Only after those links are closed may a minimal `authRegister` handler be admitted.

Mapping 0 remains NOT_GREEN.
