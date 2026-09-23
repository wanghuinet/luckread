# AUTH-013 — Canonical Account-State Field Admission — 2026-09-23

- Change Control: `CC-MAPPING-0-AUTH-013-AUTHORITY-2026-09-23`
- Feature: `AUTH-013`
- Admission status: `CONTRACT_ADMITTED / VERIFICATION_PENDING`
- Entity: `ENT-USER`
- Authority: W02 / D1-01 (approved by the preceding AUTH-013 authority decision)

## Admitted canonical fields

The two candidates previously recorded in the AUTH-013 decision-input packet are admitted as the canonical field identifiers for the existing `ENT-USER` entity:

| Field | Canonical Field ID | Contract status |
|---|---|---|
| `account_state` | `ENT-USER-F-ACCOUNT-STATE` | CONTRACTED_NOT_VERIFIED |
| `account_state_version` | `ENT-USER-F-ACCOUNT-STATE-VERSION` | CONTRACTED_NOT_VERIFIED |

The admission does not create a new Entity. Both fields belong to the already verified `ENT-USER` Entity.

## Binding source

- State field source: `contracts/state-machines/account.json#x-luckread.state-field`
- Version field source: `contracts/state-machines/account.json#x-luckread.version-field`
- State enum: `contracts/enums/account-state.json`
- Authoritative writer: W02
- Authoritative domain: D1-01

## Field rules admitted

`account_state`:
- enum value authority remains the existing AccountState contract;
- required and non-null;
- lifecycle state;
- authoritative mutation remains W02 / D1-01;
- physical persistence is not yet verified.

`account_state_version`:
- integer;
- required and non-null;
- monotonic lifecycle/version value;
- physical persistence is not yet verified.

No default value, physical table/column, migration, Payload collection field, or runtime implementation is inferred by this admission.

## Acceptance boundary

This closes the canonical Field-ID decision input for AUTH-013.

It does **not** close:
- physical D1-01 table/column mapping;
- migration execution;
- DTO admission;
- W02 runtime implementation;
- event/audit execution evidence;
- security/lifecycle integration evidence;
- AUTH-013 GREEN;
- E6 Runtime-003 promotion.

## Next gate

Bind these admitted Field IDs to an authoritative D1-01 persistence artifact using actual repository/schema evidence, then continue Contract-First runtime admission.
