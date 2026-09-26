# CC-MAPPING-0-AUTH-004-AUTH-014-RECOVERY-BOUNDARY-CONFLICT-2026-09-26

- Scope: AUTH-004 / AUTH-014 recovery boundary
- Status: DECISION_REQUIRED
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

### Option A — AUTH-014 is decomposed into AUTH-004

Record that the account-recovery inventory route is a historical/discovery representation of the AUTH-004 recovery surface, define the exact admitted equivalence/boundary, and preserve the existing AUTH-004 operation vocabulary as canonical.

### Option B — AUTH-014 is a distinct capability

Freeze the distinct purpose of AUTH-014, its canonical operation set, DTO vocabulary, authorization/state semantics, and its non-overlap boundary with AUTH-004.

### Option C — Historical/discovery route only

Record that `postAccountRecovery` remains a discovery/inventory artifact with no canonical feature binding until a later explicit contract decision.

No option is selected by this control.

## 5. Interaction with existing AUTH-004 decisions

This control does not alter the already-resolved AUTH-004 route/operation authority:

- `authPasswordChange`
- `authPasswordResetRequest`
- `authPasswordResetConfirm`

It also does not close the existing AUTH-004 Wire Schema decision gate or Operation Policy authority gap.

Until the boundary is decided, AUTH-004 and AUTH-014 must remain separate decision subjects for Mapping-0 purposes.

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

- Current main reviewed: `b25f9c2499e431470b6d3823dec94acf2c45685e`
- Backup branch: `backup/main-before-auth004-auth014-recovery-boundary-20260926`
- Existing AUTH-004 route authority decision remains unchanged.
- No OpenAPI, DTO, runtime, persistence, or evidence promotion is performed by this record.

## 8. Result

`AUTH-004 / AUTH-014 RECOVERY BOUNDARY = DECISION_REQUIRED`

This control is decision material only. It intentionally preserves the conflict instead of auto-merging, renaming, or promoting either recovery surface.
