# AUTH-004–AUTH-006 Contractual Closure Delta v1.0

## Status

`CONTRACTED_NOT_VERIFIED / NOT_GREEN`

This delta records definition-layer closure only. It does not claim runtime, persistence, integration, security, or Mapping 0 verification.

## AUTH-004 — Password reset / change

Canonical API contract:
`contracts/api/AUTH-004-password-recovery-contract.v1.json`

Operations:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

Authoritative entity references:

- `ENT-CREDENTIAL`
- `ENT-VERIFICATION`

Security/lifecycle closure established at contract level:

- recovery token is single-use, time-bounded and purpose-bound;
- raw recovery token is not persisted or logged;
- successful password change/reset revokes affected sessions;
- password material is never returned;
- reset/change failure semantics must not disclose protected account existence.

Still open: D1 schema/migration, runtime implementation, executed replay/expiry/enumeration/security tests, Evidence Registry IDs, Mapping 0 evidence.

## AUTH-005 — Email / phone verification

Canonical API contract:
`contracts/api/AUTH-005-identity-verification-contract.v1.json`

Operations:

- `authVerificationRequest` — `POST /auth/verification/request`
- `authVerificationConfirm` — `POST /auth/verification/confirm`
- `authVerificationRevoke` — `POST /auth/verification/revoke`

Authoritative entity references:

- `ENT-VERIFICATION`
- `ENT-CREDENTIAL`
- `ENT-IDENTITY`

Security/lifecycle closure established at contract level:

- challenge is single-use, time-bounded and purpose-bound;
- wrong-purpose, expired and replayed challenges are denied;
- at most one successful challenge consumption is authoritative;
- credential values are not disclosed through verification errors.

Still open: canonical field authority in the shared field catalog, D1 schema/migration, runtime implementation, concurrency/security evidence, Evidence Registry IDs, Mapping 0 evidence.

## AUTH-006 — Passkey / WebAuthn

Canonical API contract:
`contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`

Operations:

- `authPasskeyRegistrationOptions`
- `authPasskeyRegistrationVerify`
- `authPasskeyAssertionOptions`
- `authPasskeyAssertionVerify`
- `authPasskeyRemove`

Authoritative entity references:

- `ENT-CREDENTIAL`
- `ENT-VERIFICATION`
- `ENT-IDENTITY`

Security/authority closure established at contract level:

- RP ID and origin are deployment/application authority, not client authority;
- private keys are never received by or persisted on the server;
- challenges are single-use, time-bounded and purpose-bound;
- assertion verification requires a valid challenge and signature verification;
- cross-account credential management is denied.

Still open: exact WebAuthn field catalog binding, D1 schema/migration, runtime implementation, positive/negative security evidence, Evidence Registry IDs, Mapping 0 evidence.

## Batch gate

All three features remain non-green until executable persistence/runtime/security evidence is bound to the same tested commit SHA and the final Mapping 0 validator passes.
