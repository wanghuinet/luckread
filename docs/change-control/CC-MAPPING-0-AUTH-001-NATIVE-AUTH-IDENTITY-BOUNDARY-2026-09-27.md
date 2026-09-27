# CC-MAPPING-0-AUTH-001-NATIVE-AUTH-IDENTITY-BOUNDARY-2026-09-27

## Status

`NATIVE_AUTH_IDENTITY_BOUNDARY_BLOCKED`

## Evidence

The active W01 User collection uses Payload's native `auth: true` boundary and does not declare a custom authentication strategy.

The repository's Payload reference material shows the native User creation path with `email` and `password` on the auth-enabled `users` collection.

The current W01 `Users.ts` contains a required unique `username` plus profile fields, but it does not declare:

- a `phone` authentication field;
- a custom phone authentication strategy;
- a custom local-auth identifier resolver;
- a registration handler that converts phone identity into a native Payload auth principal.

The current admitted remote baseline also shows the native Payload `users` persistence shape contains `email` and the native password/reset fields.

## Consequence

AUTH-001 public registration explicitly permits:

`identityType = phone | email`

Therefore a phone-only registration cannot currently be implemented as a pure Payload-native User creation using the admitted W01 source and current contracts.

A workaround such as:

- synthesizing a fake/placeholder email;
- placing phone into `username`;
- adding a hidden phone field;
- introducing a custom authentication strategy;
- creating a parallel User/authentication record

would alter the current authority boundary or create new semantics.

None is authorized by inference.

## Combined contract blockers

The current registration contract therefore has these coupled unresolved items:

1. username is optional on the public wire but required in ENT-USER/User;
2. phone is accepted on the wire but lacks an admitted durable/native authentication source;
3. consent has no admitted persistence authority;
4. AUTH-001 durable idempotency/replay authority is not evidenced;
5. Payload-native User creation and W02/D1-01 Identity/Credential persistence do not yet have an admitted atomic or eventual consistency contract.

## Fail-closed disposition

No change is made to Payload Core, `Users.ts`, OpenAPI, DTOs, migrations, Workers, D1 topology or queues.

The native-auth finding is evidence of the current boundary, not authorization to extend Payload.

## Next governed decision

The AUTH-001 contract must explicitly decide how supported registration identity types relate to the native User/auth boundary:

- whether email is the sole native registration login identity and phone is materialized as a separate verified credential after registration;
- whether phone registration must become a separately contracted supported authentication entry path;
- how username optionality is reconciled with the required User field;
- how consent and idempotency/replay are durably represented;
- how partial registration failure is recovered.

Until those decisions are explicit, `authRegister` runtime implementation remains blocked.

Mapping 0 remains NOT_GREEN.
