# CC-MAPPING-0-AUTH-001-REGISTER-WIRE-RECONCILIATION-2026-09-27

## Status

`WIRE_REQUIREDNESS_RECONCILED / REMAINING_GATES_BLOCKED`

## Base

- Base main: `17d005179da4cdefb449b0db79f33d865fc99f59`
- Backup branch: `backup/pre-auth001-registration-contract-reconcile-20260927`

## Scope

This control narrows one concrete AUTH-001 contract compatibility gap before runtime implementation.

It reconciles the public registration request with already-authoritative repository requirements for:

- `username`;
- registration consent acknowledgement.

This control does **not** authorize a runtime handler, migration, new persistence entity, Worker, Queue, D1, Payload Core change, or Evidence Registry promotion.

## Authority basis

Current W01 Payload `Users.ts` declares:

- `username` required;
- `username` unique;
- `username` indexed.

The current ENT-USER contract also declares `username` as required/unique/indexed.

The AUTH-001 operation policy already declares the security invariant:

- `consent_required`.

No authoritative rule exists for username synthesis, derivation, placeholder email, or hiding phone inside username.

## Reconciliation decision

### Username

The canonical `authRegister` request now requires:

`identityType, identity, credential, username, consent`.

This removes the previously frozen mismatch:

- public wire: username optional;
- Payload/ENT-USER: username required.

The decision does **not** create username synthesis or a second identity subsystem.

### Consent

The canonical `authRegister` request now requires a `consent` object because the operation policy already marks consent as required.

This change is wire-level only.

A canonical durable consent persistence entity/field has **not** been admitted. Therefore requiring the request object does not imply that consent persistence, retention, audit storage, or downstream consent evidence is closed.

## Mirrored contract inputs

The required-field decision is recorded in both:

- `contracts/openapi/v1/openapi.yaml`;
- `contracts/api/auth-operation-policy.v1.json`.

The operation-policy record carries the machine-readable required-field set for `authRegister`.

## Remaining blockers

The registration implementation gate remains closed because these independent authority gaps remain unresolved:

1. `identityType=phone` still lacks an admitted durable/native source boundary.
2. Canonical consent persistence/retention authority remains unresolved.
3. AUTH-001 durable `Idempotency-Key` replay persistence and request-fingerprint semantics remain unresolved.
4. The complete registration writer boundary remains unresolved between Payload-native User creation and W02/D1-01 Identity/Credential persistence.
5. Registration anti-abuse, integration, security-E2E and Evidence Registry admission remain missing.

## Non-authorizations

This reconciliation does not authorize:

- adding a phone field to W01 Users;
- enabling a custom phone authentication strategy;
- synthesizing usernames;
- creating a consent table/entity;
- creating a generic idempotency system;
- adding another Worker, Queue or D1;
- direct W01 writes to D1-01;
- distributed transactions or compensation workflows;
- implementing `authRegister`;
- promoting AUTH-001 or Mapping 0 to GREEN.

## Result

The username/requiredness wire mismatch is reconciled without changing the Payload-native authentication boundary.

The registration runtime gate remains fail-closed until the remaining authority inputs are explicitly reconciled by Change Control.
