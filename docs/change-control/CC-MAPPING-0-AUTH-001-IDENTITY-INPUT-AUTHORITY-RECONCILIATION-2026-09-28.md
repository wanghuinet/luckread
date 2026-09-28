# CC-MAPPING-0-AUTH-001-IDENTITY-INPUT-AUTHORITY-RECONCILIATION-2026-09-28

## Status

`CONTRACT_RECONCILED / IMPLEMENTATION_NOT_AUTHORIZED`

## Scope

Close the AUTH-001 DTO-to-entity binding gap for the already-admitted registration entry contract. This is a contract/mapping reconciliation only. It does not implement identity materialization, credential persistence, or registration runtime.

## Base

- main reviewed: `a25b9883f7383ea8d8ea63a97b7111a924742c7d`
- backup branch: `backup/pre-auth001-identity-input-authority-20260928`
- work branch: `reconcile/auth001-identity-input-authority-20260928`

## Authoritative inputs

- `docs/change-control/CC-MAPPING-0-AUTH-001-NATIVE-EMAIL-REGISTRATION-DECISION-2026-09-27.md`
- `docs/change-control/CC-MAPPING-0-AUTH-001-PAYLOAD-NATIVE-CAPABILITY-RECONCILIATION-2026-09-27.md`
- `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-WRITER-BOUNDARY-2026-09-27.md`
- `docs/change-control/CC-MAPPING-0-AUTH-003-IDENTITY-MATERIALIZATION-AUTHORITY-GAP-2026-09-27.md`
- `docs/change-control/CC-MAPPING-0-AUTH-001-IDENTITY-INPUT-SOURCE-CORRECTION-2026-09-27.md`
- `contracts/openapi/v1/openapi.yaml` (`authRegister` requires `identityType=email`, `identity`, `credential`, `username`, `consent`)
- active W01 `workers/W01-payload/src/collections/Users.ts`
- AUTH-003 identity/credential field contracts

## Reconciled DTO entity binding

The AUTH-001 request/response DTO remains the canonical public wire binding for `authRegister`, but its participating domain entities are now explicitly recorded as:

- `ENT-USER`: authoritative Payload account/User and response `userId`;
- `ENT-IDENTITY`: canonical email identity selected by `identityType=email`, with `ENT-USER.id -> ENT-IDENTITY.userId`;
- `ENT-CREDENTIAL`: initial non-password login-identifier credential material governed by the existing AUTH-003 model; Payload native password material remains outside this entity.

The registration password is not mapped to `ENT-CREDENTIAL`; it remains under Payload native auth.

## Why this is admissible

The entry identity decision is already closed to native email registration. The active W01 User source provides the admitted durable email/username/auth boundary, and the AUTH-003 contracts define the identity/credential vocabulary and normalization authority.

This change only records the participants already established by those contracts. It does not invent phone registration, fake identifiers, a new auth strategy, or a new persistence layer.

## Remaining blockers

- AUTH-001 registration writer/execution remains independently gated.
- W02/D1-01 identity/credential materialization implementation remains unauthorized until the registration consistency model and runtime contract are admitted.
- Concrete physical registration persistence and migration evidence remain separate gates.
- Consent runtime/physical evidence remains separate.
- Evidence Registry and Mapping 0 remain NOT_GREEN.

## Non-actions

- no runtime code;
- no W01/W02 deployment;
- no D1 migration;
- no schema invention;
- no new Worker/Queue/D1;
- no Payload Core change;
- no AUTH-003 runtime rerun;
- no Mapping 0 GREEN.

## Result

The DTO→Entity binding gap for AUTH-001 is closed at the contract layer only. Runtime and persistence status remain fail-closed.
