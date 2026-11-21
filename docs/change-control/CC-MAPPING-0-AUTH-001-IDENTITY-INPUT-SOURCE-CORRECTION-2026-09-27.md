# CC-MAPPING-0-AUTH-001-IDENTITY-INPUT-SOURCE-CORRECTION-2026-09-27

## Status

`PHONE_SOURCE_PERSISTENCE_BLOCKED`

## Reason for correction

The prior AUTH-001 registration reconciliation established semantic destinations for the request fields. A current-source audit shows that semantic destination is not equivalent to durable source evidence for every identity type.

The active W01 Payload Users collection declares:

- username
- displayName
- bio
- avatar
- locale
- timezone

and uses Payload's native auth boundary. It does not declare a phone field.

Therefore a public registration request with `identityType=phone` currently has no admitted durable source field in the active User record from which W02 could deterministically materialize ENT-IDENTITY after a retry or delivery failure.

## Correct disposition

| Field | Semantic destination | Durable source status |
| --- | --- | --- |
| identityType=email | ENT-IDENTITY.email + Credential kind=email | SOURCE NOT YET IMPLEMENTED |
| identityType=phone | ENT-IDENTITY.phone + Credential kind=phone | **BLOCKED — source field absent** |
| username | ENT-IDENTITY.username + Credential kind=username | Source exists in Payload User; synchronization not implemented |
| credential | Payload native auth password boundary | Source boundary established; runtime registration unimplemented |

No inference is allowed that phone can be stored in username, consent, or another unrelated User field.

## Consequence for eventual consistency

The existing AUTH-001 queue budget (`enqueueMax=1`, taskType `verification_or_welcome`) proves only that one asynchronous task is allowed by the operation policy. It does not define an identity-materialization payload, retry key, durable source, consumer authority, or failure-recovery contract.

The previously implemented AUTH-013 publication-journal pattern is scoped to Account State publication and must not be copied into AUTH-001 as an identity-materialization authority without explicit contract admission.

Therefore the project does not yet have enough existing contract authority to admit eventual Identity/Credential materialization.

## Fail-closed boundary

This correction does not:

- add a phone field;
- modify Payload Users;
- add a migration;
- create an identity-materialization queue;
- create an outbox;
- create a new Worker;
- create a reverse Worker binding;
- change AUTH-001 resource budgets.

The next governed decision must first establish the durable source authority for all supported registration identity types and define the registration consistency model. Only then may a minimal runtime slice be admitted.

Mapping 0 remains NOT_GREEN.
