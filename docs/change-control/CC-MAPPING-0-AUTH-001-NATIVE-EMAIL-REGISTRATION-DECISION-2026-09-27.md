# CC-MAPPING-0-AUTH-001-NATIVE-EMAIL-REGISTRATION-DECISION-2026-09-27

## Status

`NATIVE_EMAIL_ENTRY_CLOSED / PHONE_ENTRY_DEFERRED / REMAINING_GATES_BLOCKED`

## Base

- Base main: `6332989808ae3570b7e6dfc004c170ba08570695`
- Backup branch: `backup/pre-auth001-writer-boundary-reconcile-20260927`

## Decision

AUTH-001 registration is constrained to the identity entry path that already matches the active Payload native authentication boundary:

`identityType = email`.

The public registration request continues to require:

`identityType, identity, credential, username, consent`.

## Evidence basis

The active W01 `Users.ts` uses Payload native authentication and does not declare a custom phone authentication strategy.

The repository has an admitted AUTH-003 credential model for username/email/phone, and AUTH-005 is the separate email/phone verification capability.

No current contract or runtime evidence authorizes:

- a phone-native Payload authentication strategy;
- a phone field on the active W01 User source for registration recovery;
- a synthetic/placeholder email;
- phone-to-username substitution.

Payload's native authentication remains the preferred implementation boundary rather than introducing a parallel phone-auth subsystem.

## Phone disposition

Phone is **not removed from the product architecture**.

It remains part of:

- AUTH-003 username/email/phone credential management;
- AUTH-005 email/phone verification.

AUTH-001 registration does not claim phone as an entry identity until a separate Change Control establishes a native-compatible durable phone registration/authentication boundary.

This closes the immediate AUTH-001 phone-source ambiguity without inventing a new authentication strategy.

## Impact on account lifecycle

AUTH-001 registration continues to create the account in:

`PENDING_VERIFICATION`.

For the admitted AUTH-001 entry path, the verification precondition is the email branch of the existing account-state contract.

Phone verification remains independently governed by AUTH-005.

## Remaining blockers

Still blocked:

1. canonical consent persistence/retention authority;
2. AUTH-001 registration writer/transaction boundary;
3. transactional binding of the already-canonical IdempotencyRecord semantics to the registration outcome;
4. executable registration handler;
5. anti-abuse/security/integration evidence;
6. Evidence Registry admission / Mapping 0 promotion.

## Non-authorizations

This decision does not:

- modify Payload Core;
- add a phone field;
- add a custom phone authentication strategy;
- add another Worker or D1;
- create a generic identity service;
- implement `authRegister`;
- promote AUTH-001 or Mapping 0 to GREEN.

## Result

The AUTH-001 identity-entry contract now matches the currently admitted Payload-native authentication capability.

Phone remains a separate verified credential path governed by AUTH-003/AUTH-005 rather than becoming an implicit second native-login system.
