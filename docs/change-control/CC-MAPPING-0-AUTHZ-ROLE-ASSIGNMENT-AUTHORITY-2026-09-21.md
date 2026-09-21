# Change Control — AUTHZ RoleAssignment Authority Gap v1

- ID: CC-MAPPING-0-AUTHZ-ROLE-ASSIGNMENT-AUTHORITY-2026-09-21
- Status: OPEN — CONTRACT INPUT REQUIRED
- Scope: establish the existing D1-01 RoleAssignment authority needed by E6 layer resolution
- Parent: CC-MAPPING-0-AUTH-002-E6-LAYER-AUTHORITY-2026-09-21
- Runtime implementation: NOT AUTHORIZED
- Persistence mutation: NOT AUTHORIZED

## Verified facts

1. D1-01 is the canonical Identity / Account / Access domain.
2. D1-01 explicitly owns Role and RoleAssignment authority.
3. The entity catalog declares ENT-ROLE-ASSIGNMENT, but its current status is PROPOSED.
4. The database/entity persistence inventory has no implementation or migration reference for ENT-ROLE-ASSIGNMENT.
5. docs/303 defines RoleAssignment as an authorization input and keeps Role, Entitlement, Subscription, Organization Membership, Account State and Ownership separate.
6. docs/301 and contracts/authz/layers.json define the canonical L0-L8 layer vocabulary and role mappings.
7. docs/14 explicitly prohibits treating Payload User.role as complete public API authorization authority.

## Exact gap

Before an executable Layer Resolver can be admitted, the repository needs an authoritative RoleAssignment contract that defines, at minimum:

- subject/user binding;
- canonical role identifier source;
- assignment status/validity;
- scope type and scope identity;
- temporal validity/expiry semantics where applicable;
- revocation semantics;
- uniqueness/conflict constraints;
- authoritative version/change semantics;
- relationship to Organization/IP scoped roles;
- evidence required for an assignment to become effective.

No field names, status enum, scope model, table schema, or migration are invented by this Change Control.

## Required downstream Layer decision

After RoleAssignment authority is explicitly contracted, a separate reconciliation must define:

- which RoleAssignments are eligible for the public authLogin/authRefresh layer;
- whether only platform-scoped assignments can raise the global response layer;
- how multiple eligible assignments deterministically produce one L0-L8 result;
- how account-state/security denial interacts with layer output;
- whether layer is derived or projected;
- exact W01 runtime binding;
- fail-closed behavior when no valid layer can be established.

## Prohibitions

- Do not add User.layer.
- Do not treat Payload User.role as canonical authorization.
- Do not create a parallel layer entity.
- Do not create a new Worker or D1.
- Do not hand-author a RoleAssignment table/migration before field authority exists.
- Do not implement authLogin/authRefresh runtime merely because the response schema exists.

## Closure criterion

This Change Control can close only when an explicit Contract-First RoleAssignment authority record is reconciled with the existing D1-01, authorization and layer contracts. Only then may E6-LAYER-001 move to resolver specification and runtime admission.

## Current decision

E6-LAYER-001 remains blocked, but its upstream dependency is now precisely identified as ENT-ROLE-ASSIGNMENT authority rather than an unspecified "layer source".
