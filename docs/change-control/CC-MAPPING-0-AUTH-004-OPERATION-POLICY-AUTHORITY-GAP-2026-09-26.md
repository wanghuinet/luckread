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


## 8. Authority Input Matrix — 2026-09-26

This matrix decomposes the existing gap without inventing any AUTH-004 values.

| Decision dimension | Current authoritative input | Current determination |
|---|---|---|
| Operation IDs / routes | `contracts/api/AUTH-004-password-recovery-contract.v1.json` | FROZEN |
| Auth mode / subject | AUTH-004 feature API contract | FROZEN: change=authenticated/self; reset request=anonymous; reset confirm=anonymous/token-bound |
| Permission | AUTH-004 feature API contract | FROZEN for password change: `user.credential.manage`; reset request=N/A; reset confirm=recovery-token boundary |
| Recovery security invariants | AUTH-004 feature API contract + field contract | FROZEN: single-use, time-bound, purpose-bound, no enumeration, no secret return/logging, replay denied, affected-session revocation |
| Contract policy status | `contracts/api/auth-operation-policy.v1.json` | DECISION_REQUIRED for all three operations |
| Resource class / D1 budgets | Auth operation policy has no AUTH-004 entries | DECISION_REQUIRED |
| Cache mode / boundary | No AUTH-004-specific authoritative mode found | DECISION_REQUIRED |
| Retry max / client retry safety | No AUTH-004-specific authoritative profile found | DECISION_REQUIRED |
| Idempotency required / semantic | Common User Center contract requires idempotency for retryable state-changing operations, but exact AUTH-004 application is explicitly left open by the wire audit | DECISION_REQUIRED |
| Anti-abuse scopes / actions | Recovery contracts require enumeration resistance and rate/abuse protection, but no exact AUTH-004 scope/action tuple is authoritative | DECISION_REQUIRED |
| Events / queue | No AUTH-004-specific operation-policy entry | DECISION_REQUIRED |
| Operation-level security list | Core security invariants are frozen; exact operation-policy security vocabulary/admission remains to be recorded | DECISION_REQUIRED |
| Evidence categories | Auth policy green rule defines required evidence dimensions; AUTH-004 currently lacks operation records | FROZEN as gate dimensions; per-operation admission status still DECISION_REQUIRED |

### 8.1 Wire-policy interaction

The Wire Schema and Operation Policy are independent admission dependencies:

- Wire Schema must freeze exact public fields/status/body/error semantics.
- Operation Policy must freeze operation-level resource/retry/cache/abuse/idempotency/event/queue behavior.
- Neither input may be synthesized from the other.
- Persistence fields such as `tokenHash`, `issuedAt`, `expiresAt`, `consumedAt`, `invalidatedAt`, and `passwordHash` remain persistence/security inputs, not public DTO fields.

### 8.2 Decision completion test

AUTH-004 Policy Authority can move out of `DECISION_REQUIRED` only when a single authoritative decision artifact or an explicitly cross-referenced set of authoritative artifacts records the final values for all three canonical operations, including any intentional `N/A` values.

Until then, no entry may be added to `contracts/api/auth-operation-policy.v1.json` merely to satisfy schema completeness.

## 9. Result

The authority gap is now decomposed into explicit decision fields. No policy value has been inferred or promoted.

Current result remains:

`AUTH-004 OPERATION-POLICY AUTHORITY = PARTIALLY FROZEN / DECISION_REQUIRED`
