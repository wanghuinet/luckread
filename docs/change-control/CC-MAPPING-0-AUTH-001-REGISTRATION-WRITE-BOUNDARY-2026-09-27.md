# CC-MAPPING-0-AUTH-001-REGISTRATION-WRITE-BOUNDARY-2026-09-27

## Status

`FIELD_AUTHORITY_RECONCILED / WRITE_BOUNDARY_BLOCKED`

## Scope

Resolve the AUTH-001 registration request-field authority and isolate the remaining single-writer conflict. No runtime implementation, migration, schema change, Worker topology change, or API/DTO change is introduced.

## Reconciled field authority

| AUTH-001 field | Canonical destination | Status |
| --- | --- | --- |
| identityType | Selects Identity email/phone side and corresponding Credential kind | RECONCILED |
| identity | Selected email/phone identifier value; AUTH-003 normalization applies | RECONCILED |
| username | Identity username plus Credential kind=username when supplied | RECONCILED |
| credential | Payload native authentication password material on User | RECONCILED |
| consent | No canonical persistence field/entity is admitted | BLOCKED |
| response userId | User.id; immutable cross-domain authority | RECONCILED |
| response accountState | users.account_state; initial state PENDING_VERIFICATION / version 1 | PERSISTENCE CONTRACT RECONCILED |

## Why password is not ENT-CREDENTIAL

AUTH-003 ENT-CREDENTIAL is frozen to username/email/phone identifier credentials. Its kind enum contains only username, email and phone. The registration password therefore belongs to the existing Payload auth-enabled User boundary rather than being represented as an AUTH-003 identifier credential.

The current W01 Users collection is auth-enabled and retains Payload's native authentication pipeline. Payload's current authentication documentation states that auth-enabled collections receive native account creation/login/reset capabilities and supports username/email login configuration.

Reference:
https://payloadcms.com/docs/authentication/overview

## Write-boundary conflict

AUTH-001 declares:

- SINGLE_AUTHORITATIVE_WRITE
- max 1 D1 write
- max 0 outbound/RPC
- same-request replay must not create a second account

The complete registration outcome nevertheless requires:

- creation of the authoritative Payload User;
- creation of the Identity row;
- creation of zero or more initial identifier Credential rows;
- initial account state PENDING_VERIFICATION.

No currently admitted single-writer mechanism atomically owns this whole outcome.

A W01 create followed by a W02 D1 write would introduce a cross-worker/write sequence not admitted by the current AUTH-001 policy. Creating all rows directly in D1 would bypass the Payload-native User/auth write boundary. Neither behavior is authorized by inference.

## Fail-closed disposition

The following are explicitly not authorized by this control:

- no W01→W02 registration RPC;
- no second identity service;
- no direct password persistence outside Payload auth;
- no replacement of Payload's native User/auth pipeline;
- no API/DTO rewrite;
- no Mapping 0 GREEN.

## Next governed decision

A Change Control decision must select a single authoritative registration-write boundary that can satisfy the existing AUTH-001 budget while preserving Payload-native password handling and the frozen Identity/Credential contracts.

Until that decision exists, AUTH-001 remains BLOCKED_NOT_GREEN and the implementation gate remains closed.
