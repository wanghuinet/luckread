# CC-MAPPING-0-AUTH-004-AUTH-014-RECOVERY-BOUNDARY-CONFLICT-2026-09-26

- Scope: AUTH-004 / AUTH-014 recovery boundary
- Status: PASS_VERIFIED_SCOPE_BOUNDARY_ONLY
- Implementation authorization: false
- OpenAPI promotion: false
- DTO registry promotion: false
- Runtime admission: false
- Evidence admission: false
- Mapping-0 GREEN: false

## 1. Finding

A current-head reconciliation surfaced an additional recovery-scope boundary that is distinct from the existing AUTH-004 Wire Schema and Operation Policy gaps.

AUTH-004 already has an explicit feature-contract operation set:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

Separately, the repository still inventories AUTH-014 as `account recovery`, and the current API inventory contains:

- `postAccountRecovery` — `POST /v1/account/recovery`
- OpenAPI discovery path: `/account/recovery`
- inventory status: `DISCOVERED`
- no admitted canonical AUTH operation binding in the AUTH-014 reconciliation

The AUTH-014 reconciliation explicitly treats the inventory route as inventory evidence only and states that no canonical operation ID or DTO binding has been established.

## 2. Why this is a real boundary decision

The repository therefore contains two recovery-related surfaces:

1. AUTH-004: password change / password-reset request / password-reset confirmation, with canonical operation IDs already frozen by its feature API contract.
2. AUTH-014: account recovery, with an inventoried `/v1/account/recovery` route but no admitted canonical operation ID or DTO binding.

These surfaces may describe:

- one capability decomposed into AUTH-004 operations;
- two intentionally distinct capabilities with different recovery semantics;
- or a historical/discovery route that must remain non-canonical.

The current repository evidence does not establish which interpretation is authoritative.

## 3. Explicit non-inference rule

Do not:

1. bind `postAccountRecovery` to `authPasswordResetRequest` by name similarity;
2. bind `postAccountRecovery` to `authPasswordResetConfirm` by recovery semantics;
3. rename either operation to remove the apparent overlap automatically;
4. promote `/v1/account/recovery` or `/account/recovery` into canonical AUTH-004 OpenAPI;
5. create a new AUTH-014 operation ID merely to eliminate the collision;
6. copy AUTH-004 DTOs into AUTH-014;
7. merge AUTH-014 into AUTH-004 feature mapping without an explicit scope decision;
8. treat the presence of the inventory route as runtime implementation evidence.

## 4. Required authority decision

A boundary decision must explicitly establish one of the following, with evidence and provenance:

### Decision — AUTH-004 and AUTH-014 remain distinct feature scopes

The authoritative Blueprint and Feature Inventory identify:

- AUTH-004 = password reset/change;
- AUTH-014 = account recovery.

The current B01 reconciliation likewise models AUTH-014 as a separate Recovery capability. Existing AUTH-004 route authority separately establishes that `postAccountRecovery` is not a canonical AUTH-004 operation and remains a discovery/historical alias.

Decision:

- AUTH-014 remains a distinct feature scope from AUTH-004.
- No equivalence or decomposition from AUTH-014 into the three AUTH-004 operations is admitted.
- `postAccountRecovery` / `POST /v1/account/recovery` remains an unbound inventory/discovery route for AUTH-014.
- AUTH-014 still has no canonical operationId, DTO schema, OpenAPI admission, or runtime authorization from this decision.
- The non-overlap boundary is now frozen at the feature-scope level only; operation/API closure for AUTH-014 remains a separate future authority task.

## 5. Interaction with existing AUTH-004 decisions

This control does not alter the already-resolved AUTH-004 route/operation authority:

- `authPasswordChange`
- `authPasswordResetRequest`
- `authPasswordResetConfirm`

It also does not close the existing AUTH-004 Wire Schema decision gate or Operation Policy authority gap.

The feature-scope boundary is now decided. AUTH-004 and AUTH-014 remain separate Mapping-0 decision subjects. This decision does not close AUTH-004 Wire Schema or Operation Policy, and does not authorize any AUTH-014 API/DTO promotion.

## 6. Current authoritative inputs

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `contracts/alignment/feature-inventory.v1.json`
- `contracts/alignment/api-inventory.v1.json`
- `contracts/api/api-inventory.v1.json`
- `contracts/alignment/mapping-batches/AUTH-014-real-evidence-reconciliation.v1.md`
- `contracts/alignment/mapping-batches/AUTH-004-wire-projection-decision-gate.v1.md`
- `docs/change-control/CC-MAPPING-0-AUTH-004-OPENAPI-DISCOVERY-SHELL-CONFLICT-2026-09-26.md`
- `docs/change-control/CC-MAPPING-0-AUTH-004-WIRE-SCHEMA-DECISION-REQUIRED-2026-09-26.md`
- `docs/change-control/CC-MAPPING-0-AUTH-004-OPERATION-POLICY-AUTHORITY-GAP-2026-09-26.md`

## 7. Provenance

- Source decision inputs reviewed at current main: `742fdb68866599c54b9ba52ba45c291f7a8558d9`
- Backup branch: `backup/main-before-auth004-auth014-boundary-decision-20260926`
- Supporting authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`, `contracts/alignment/feature-inventory.v1.json`, `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`.
- Existing AUTH-004 route authority decision remains unchanged.
- No OpenAPI, DTO, runtime, persistence, or evidence promotion is performed by this decision.

## 8. Result

`AUTH-004 / AUTH-014 FEATURE-SCOPE BOUNDARY = PASS_VERIFIED_SCOPE_BOUNDARY_ONLY`

The repository now has an explicit feature-scope boundary between AUTH-004 and AUTH-014. This removes the ambiguity without inventing an AUTH-014 operation contract.

Remaining independent blockers:
- AUTH-004 Wire Schema = `DECISION_REQUIRED`
- AUTH-004 Operation Policy = `DECISION_REQUIRED`
- AUTH-014 canonical API/DTO/persistence/runtime/evidence closure remains open.

No runtime or public-schema promotion is authorized by this record.
