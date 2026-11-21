# B15 — Security / Authorization / Account Lifecycle Reconciliation v1.0

Status: `BLOCKED_UNTIL_EVIDENCE`

## Purpose

Close the Mapping-0 contract boundary from API/DTO/Entity into authorization, scope, account state and lifecycle without inventing implementation identifiers.

## Canonical chain

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code → Security → Lifecycle → Test → Evidence`

Every unresolved or contradictory link remains a Mapping-0 blocker.

## Scope

### AUTHZ

The canonical inventory defines ten authorization capabilities:

- AUTHZ-001 roles
- AUTHZ-002 permissions
- AUTHZ-003 entitlement model
- AUTHZ-004 subscription-derived access
- AUTHZ-005 resource ownership
- AUTHZ-006 organization/team scope
- AUTHZ-007 API/OAuth scopes
- AUTHZ-008 delegated permissions lifecycle
- AUTHZ-009 service accounts/API keys
- AUTHZ-010 authorization audit

The current cross-system mapping records these as `UNRESOLVED`; therefore this batch must not promote them to GREEN merely from blueprint presence.

## Mandatory reconciliation dimensions

For each AUTHZ feature, the final mapping record must identify, with repository evidence:

1. authoritative capability ID;
2. canonical API operation ID(s);
3. request/response DTO schema reference(s);
4. canonical entity ID(s);
5. canonical field ID(s);
6. persistence authority and concrete persistence evidence;
7. Payload collection/config evidence where applicable;
8. permission authority;
9. resource scope authority;
10. ownership rule;
11. account-state precondition(s);
12. lifecycle/state transition(s);
13. audit event identity and storage authority;
14. enforcement code evidence;
15. security test evidence;
16. integration/E2E evidence;
17. commit SHA evidence.

## Account lifecycle boundary

The lifecycle mapping must explicitly distinguish:

- active;
- pending verification;
- suspended;
- restricted;
- recovery in progress;
- deletion requested;
- deleted/restored where contractually supported.

A lifecycle state is not GREEN until the state transition, authorization effect, persistence authority, API behavior and test/evidence chain are all bound.

## Authority invariants

1. `User != Account != Credential`.
2. `Role != Permission != Entitlement`.
3. `Subscription != Payment != Order`.
4. Authorization enforcement cannot be inferred from a Payload collection declaration.
5. Entitlement cannot be inferred from subscription naming alone.
6. Organization/team scope cannot be inferred from a user relation alone.
7. Local/internal APIs must not create a permission bypass.
8. Privileged operations require explicit authorization and account-state enforcement.
9. Sensitive credential material must never become public API DTO data.
10. Audit evidence must identify the authoritative event/storage path.

## Fail-closed rules

The following statuses are blocking:

`UNRESOLVED`, `MISSING`, `CONFLICT`, `DUPLICATE`, `DRIFT`, `EXTRA`, `BLOCKED`.

Blueprint text, feature inventory entries, Payload dependency versions, collection names, route names, or historical documents are not sufficient evidence for a GREEN mapping.

## Evidence requirements

A feature may only advance when all applicable evidence exists:

- canonical API/OpenAPI operation;
- DTO schema;
- entity/field authority;
- persistence/migration evidence;
- authorization policy/catalog;
- scope/ownership evidence;
- account-state/lifecycle contract;
- implementation enforcement evidence;
- security test;
- integration/E2E test where required;
- evidence registry entry with commit SHA.

## Current repository finding

The repository already contains the ten AUTHZ IDs in the feature inventory and blueprint, but `contracts/alignment/cross-system-mapping.v1.json` currently records AUTHZ-001 through AUTHZ-010 as `UNRESOLVED`. This batch therefore defines the closure gate rather than falsely assigning mappings.

## Admission criterion

B15 is GREEN only when every AUTHZ item and every account-state/lifecycle dependency has an evidence-bound API → DTO → Entity → Persistence → Security → Lifecycle → Test chain. Empty evidence arrays or inferred identifiers are automatic failure.

## Next dependency

B16 may reconcile remaining Content / Media / Social / Organization features, but must consume the same fail-closed security and lifecycle rules. B17 then closes Test/Evidence/CI/Validator gates before the final Mapping-0 audit.
