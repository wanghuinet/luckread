# CC-MAPPING-0-AUTH-001-PAYLOAD-NATIVE-CAPABILITY-RECONCILIATION-2026-09-27

## Status

`CAPABILITY_RECONCILED / IMPLEMENTATION_NOT_AUTHORIZED`

## Scope

This control records what Payload 3.87.1 can already provide natively for the AUTH-001 registration/authentication boundary. It is a capability reconciliation only; it does not authorize a runtime or schema change.

## Current repository boundary

The active W01 Payload package is pinned to Payload 3.87.1:

- `payload: 3.87.1`
- `@payloadcms/db-d1-sqlite: 3.87.1`

The active `Users.ts` collection currently has:

- native Payload `auth`;
- required unique indexed `username`;
- native email/password authentication in the current implementation path;
- no phone field;
- no custom authentication strategy;
- `forgotPassword` enabled natively.

No code change is made by this control.

## Payload capability verified

The current Payload authentication documentation states:

1. An auth-enabled Collection receives native account creation, login, logout, password reset and related auth operations.
2. `auth.loginWithUsername` is a native configuration option for username/password login.
3. `loginWithUsername` may be configured with `allowEmailLogin`.
4. `loginWithUsername.requireEmail: false` permits creation without an email address when username login is enabled.
5. Custom authentication `strategies` are an advanced extension point and are not required merely to enable username/password authentication.
6. Authentication fields such as `email`, `password` and, when `loginWithUsername` is enabled, `username` are Payload-managed authentication fields. Custom field definitions may override configuration while preserving the underlying auth behavior.

Authoritative reference:

- https://payloadcms.com/docs/authentication/overview
- https://payloadcms.com/docs/fields/default-fields

## Architectural consequence

This closes one capability uncertainty:

> LuckRead does not need to invent a parallel username authentication subsystem merely to make username/password authentication native to W01.

A future username-first registration/authentication boundary can remain inside the existing Payload User/auth collection by using Payload's native `loginWithUsername` capability.

The capability question is now **closed**. Subsequent AUTH-001 wire and runtime controls determine whether and when that capability is actually enabled.

## AUTH-001 implications

### Username

The repository already has three converging inputs:

- W01 `Users.ts` requires username;
- ENT-USER contract requires username;
- the foundation registration journey places Username in the registration sequence.

No authoritative repository rule supports omitted username, username synthesis, or derivation from phone/email.

The later AUTH-001 wire reconciliation has already made `username` required on `authRegister`. This capability record is therefore historical capability authority, not a pending wire decision.

### Phone

Payload supports custom fields and advanced custom authentication strategies, but the current LuckRead boundary has not admitted either for phone registration.

Therefore:

- no phone value may be placed into username;
- no fake email may be synthesized;
- no hidden phone field is added by inference;
- no custom phone authentication strategy is introduced by inference.

Phone registration remains blocked pending explicit contract authority for its durable source and authentication semantics.

### Email

Payload's native email/password path is already present and is the current W01 native authentication source.

This establishes the native side of the email branch, but it does not by itself authorize synchronization into ENT-IDENTITY / ENT-CREDENTIAL or the cross-worker registration write boundary.

## What this control closes

- Payload-native username authentication capability uncertainty: **CLOSED AS CAPABILITY QUESTION**
- Need for a parallel username auth subsystem solely for username/password: **NO**
- Need for a custom strategy solely to support username/password: **NO**

## What remains blocked

- phone durable source and supported registration semantics;
- consent persistence authority;
- AUTH-001 durable Idempotency-Key/replay authority;
- atomic-vs-eventual consistency between W01 User creation and W02/D1-01 identity materialization;
- AUTH-001 executable runtime and evidence admission.

## Non-authorizations

This control does not authorize:

- changes to `Users.ts`;
- changes to OpenAPI;
- addition of a phone field;
- a custom authentication strategy;
- a new idempotency table;
- a new Worker, Queue or D1;
- direct W01 ownership of D1-01;
- Payload core changes;
- runtime evidence reruns for already verified AUTH-002/AUTH-003 slices.

Mapping 0 remains `NOT_GREEN`.
