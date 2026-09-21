# Change Control — AUTHZ RoleAssignment Authority Gap v1

- ID: CC-MAPPING-0-AUTHZ-ROLE-ASSIGNMENT-AUTHORITY-2026-09-21
- Status: OPEN — CONTRACT INPUT REQUIRED
- Scope: establish the existing D1-01 RoleAssignment authority needed by E6 layer resolution
- Parent: CC-MAPPING-0-AUTH-002-E6-LAYER-AUTHORITY-2026-09-21
- Runtime implementation: NOT AUTHORIZED
- Persistence mutation: NOT AUTHORIZED
- Latest representation reconciliation: docs/change-control/CC-MAPPING-0-AUTHZ-L1-L2-ROLE-REPRESENTATION-2026-09-21.md

## Verified facts

1. D1-01 is the canonical Identity / Account / Access domain.
2. D1-01 owns Role and RoleAssignment authority.
3. ENT-ROLE-ASSIGNMENT exists in the entity catalog but remains PROPOSED.
4. No RoleAssignment implementation or migration is recorded in the persistence/evidence inventories.
5. docs/303 defines Role as an authorization input carried by RoleAssignment and keeps Verification, Role, Entitlement, Subscription, Organization Membership, Account State and Ownership separate.
6. docs/301 and contracts/authz/layers.json define the L0-L8 vocabulary and normalized role mapping.
7. The L1/L2 representation ambiguity is closed: normalized mapping is user -> L1 and verified_user -> L2; existing Payload User.role remains compatibility metadata.
8. docs/14 prohibits treating Payload User.role as complete public authorization authority.
9. contracts/authz/authorization-decision.json requires mandatory authorization inputs and fail-closed behavior; a role name alone can never produce ALLOW.
10. docs/302 and contracts/authz/authz-cache-invariant.json establish role_version as a security principal version and require role assignment/revocation/layer changes to invalidate authorization cache state.

## Exact remaining authority gap

No existing canonical source was found that defines the concrete RoleAssignment authority model. The missing authority must still define, without relying on implementation inference:

- authoritative subject/user binding;
- canonical role identifier source;
- assignment status/validity semantics;
- scope type and scope identity;
- temporal validity/expiry semantics where applicable;
- revocation semantics;
- uniqueness and conflict constraints;
- authoritative version/change semantics;
- relationship to Organization/IP-scoped roles;
- evidence required for an assignment to become effective.

## Layer-specific decisions still dependent on that authority

After the RoleAssignment authority exists, a separate E6 reconciliation must define:

- which assignments are eligible for authLogin/authRefresh layer output;
- whether organization/IP-scoped assignments affect the global response layer;
- deterministic behavior when more than one eligible assignment exists;
- account-state/security-deny interaction with the response layer;
- persisted versus derived layer representation;
- exact W01 runtime binding;
- stable fail-closed response when no valid layer can be established.

## Existing non-inference boundary

The following are explicitly not authorized as substitutes:

- Payload User.role;
- email/phone verification status alone;
- account state alone;
- entitlement or subscription alone;
- organization/IP membership alone;
- cache state;
- a newly invented User.layer field;
- a parallel layer entity;
- a new Worker or D1;
- a hand-authored RoleAssignment table/migration;
- a guessed multi-assignment precedence rule.

## Closure criterion

This Change Control can close only when an explicit Contract-First RoleAssignment authority record reconciles the above authority dimensions with the existing D1-01, authorization and layer contracts, including an explicit multi-assignment/global-layer rule. Only then may E6-LAYER-001 advance to deterministic resolver specification and runtime admission.

## Current decision

E6-LAYER-001 remains blocked. The L1/L2 representation conflict is resolved, but the upstream ENT-ROLE-ASSIGNMENT authority contract is not present in the repository. No implementation or D1 mutation is authorized.
