# AUTH-013 — Account-State Authority Decision — 2026-09-23

- Decision ID: `CC-MAPPING-0-AUTH-013-AUTHORITY-2026-09-23`
- Feature: `AUTH-013`
- Decision status: `APPROVED_PARTIAL`
- Decision scope: authoritative writer only
- Repository authority: GitHub `main`
- Effective scope: current Worker Master / D1-01 model

## Decision

**Alternative A is approved: W02 / D1-01 is the authoritative writer for Account State.**

The authoritative account-state mutation boundary is therefore:

`Account State transition → W02 → D1-01`

This decision reconciles the stale `W00` declaration in `contracts/enums/account-state.json` with the active canonical Worker Master and the existing W02 ownership reconciliation.

## Evidence inherited

- Active Worker Master assigns Identity / Account / Authorization to W02 and primary D1 authority to D1-01.
- B01 worker-ownership reconciliation records W02 as the current Identity / Account / Authorization owner.
- W02 deployment evidence is already verified and inherited.
- W01 → W02 `W02_AUTH` Service Binding deployment is already verified and inherited.

No W01 direct business-state write is authorized.

## Explicit non-decisions

This decision does **not** by itself admit:

- canonical Field IDs for `account_state` or `account_state_version`;
- physical D1 table/column names;
- a new migration;
- Payload User-field implementation;
- a new API operation;
- runtime implementation;
- AUTH-013 GREEN;
- E6 Runtime-003 promotion.

Candidate Field IDs already documented in the decision-input packet remain candidates until separately reconciled:

- `ENT-USER-F-ACCOUNT-STATE`
- `ENT-USER-F-ACCOUNT-STATE-VERSION`

The persistence mapping must be established from repository/schema evidence and must not be inferred.

## Required next gate

1. Admit canonical Field IDs through the Entity/Field Contract.
2. Bind those fields to the existing D1-01 persistence artifact.
3. Reconcile DTO/state/event/audit/cache/security contracts.
4. Only then authorize the W02 Account State transition implementation.
5. Execute the required positive/negative/security/integration evidence.
6. Advance AUTH-013 only from executable evidence.

## Acceptance boundary

Current AUTH-013 status remains:

`BLOCKED_NOT_GREEN`

Implementation authorization remains false until the remaining Contract and persistence inputs are closed.

No previously verified W02 deployment, RoleAssignment migration, or W01 → W02 Service Binding evidence is re-executed by this decision.
