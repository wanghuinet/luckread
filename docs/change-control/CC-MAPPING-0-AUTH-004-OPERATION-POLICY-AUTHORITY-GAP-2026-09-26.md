# CC-MAPPING-0-AUTH-004-OPERATION-POLICY-AUTHORITY-GAP-2026-09-26

- Feature: `AUTH-004`
- Status: `DECISION_REQUIRED`
- Purpose: record a missing authoritative Auth operation-policy binding discovered during current-head review.
- Implementation authorization: `false`
- OpenAPI promotion: `false`
- DTO registry promotion: `false`
- Runtime admission: `false`
- Evidence admission: `false`
- Mapping-0 GREEN: `false`

## 1. Finding

The current authoritative Auth operation policy source:

`contracts/api/auth-operation-policy.v1.json`

does not contain entries for:

- `authPasswordChange`
- `authPasswordResetRequest`
- `authPasswordResetConfirm`

The file currently contains the established authentication/session operations and AUTH-003 credential-management entries, but no AUTH-004 operation-policy records.

## 2. Why this matters

Existing AUTH-004 closure documents identify `contracts/api/auth-operation-policy.v1.json` as an authoritative input for the feature family.

The feature API contract already establishes:

- canonical operation IDs and routes;
- authorization boundaries;
- DTO target vocabulary;
- security and recovery lifecycle invariants.

However, the operation-policy authority is still missing for operation-level controls that include:

- retryability;
- feature-specific idempotency requirement and semantics;
- anti-abuse scopes/actions;
- resource/D1 budgets;
- cache policy;
- event/queue constraints;
- operation-level evidence expectations.

These values MUST NOT be copied from `authRegister`, `authLogin`, `authLogout`, or neighboring operations by convention.

## 3. Non-inference rule

This control explicitly prohibits:

1. assigning AUTH-004 the `authRegister` resource/idempotency profile;
2. assigning AUTH-004 the `authLogout` retry/idempotency profile;
3. inferring rate-limit or anti-abuse scopes from generic password-recovery behavior;
4. inferring event/queue budgets from other Auth operations;
5. treating the missing policy entries as evidence that AUTH-004 is implemented;
6. promoting OpenAPI/DTO/runtime/evidence because the feature API contract already names the operations.

## 4. Required authority decision

A future AUTH-004 operation-policy decision must explicitly define, for all three canonical operations:

- contract status;
- visibility/auth mode;
- authorization/account-state behavior;
- resource class and D1 read/write budgets;
- cache mode/boundary;
- retry behavior;
- idempotency requirement and semantic;
- anti-abuse requirement/scopes/actions;
- event and queue limits/task type where applicable;
- operation-level security invariants;
- evidence requirements.

The policy decision must remain consistent with the already-resolved AUTH-004 feature API contract and the cross-cutting error/security contracts.

## 5. Interaction with current wire-schema gate

This finding does not close or reopen the existing AUTH-004 wire gate.

Current state remains:

`AUTH-004 = BLOCKED_DECISION_REQUIRED`

The exact public request/response Wire Schema remains unresolved. The operation-policy gap is an additional authority dependency, not permission to invent wire fields.

## 6. Provenance

- Current main reviewed: `7832504d2024c675f7f66012c4a6fac4208e2932`
- Canonical feature API contract: `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- Current Auth policy source: `contracts/api/auth-operation-policy.v1.json`
- Wire-schema input audit: `artifacts/mapping-0/auth-004-wire-schema-input-audit-2026-09-26.json`
- Wire decision boundary: `contracts/alignment/mapping-batches/AUTH-004-wire-projection-decision-gate.v1.md`
- Backup branch: `backup/main-before-auth004-operation-policy-gap-20260926`

## 7. Result

`AUTH-004 OPERATION-POLICY AUTHORITY = MISSING / DECISION_REQUIRED`

No runtime or public-schema promotion is authorized by this record.
