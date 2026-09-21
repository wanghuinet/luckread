# AUTHZ Layer Mapping Conflict Audit — 2026-09-21

- Audit ID: M0-AUTHZ-LAYER-MAPPING-CONFLICT-001
- Status: OPEN — CANONICAL SOURCE RECONCILIATION REQUIRED
- Parent: CC-MAPPING-0-AUTHZ-ROLE-ASSIGNMENT-AUTHORITY-2026-09-21
- Impact: blocks deterministic RoleAssignment to L0-L8 resolver

## Conflicting existing statements

### Canonical prose contract: docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md

The role-to-layer table distinguishes:
- user (unverified) to L1
- user (verified) to L2
- creator to L3
- mcn_admin to L4
- mcn_editor to L4
- moderator to L6
- admin to L7
- super_admin to L8

The same contract also states that verified_user is a required new role at L2.

### Machine-readable contract: contracts/authz/layers.json

The machine-readable mapping states:
- user to L1
- verified_user to L2
- creator to L3
- mcn_admin / mcn_editor to L4
- moderator to L6
- admin to L7
- super_admin to L8

## Why this matters

The repository currently does not define whether a verified existing user assignment:
1. changes its role identity from user to verified_user;
2. remains user with a separate verification/eligibility dimension;
3. carries two assignments with deterministic precedence;
4. or uses another canonical representation.

That choice directly affects the public authLogin/authRefresh layer output and cannot be inferred without changing authorization semantics.

## Additional verified constraints

- docs/303 makes RoleAssignment an authorization input and Account State a separate decisive input.
- docs/14 prohibits treating Payload User.role as complete public API authorization authority.
- No executable RoleAssignment resolver exists in W01.
- No RoleAssignment persistence implementation exists in the entity/persistence inventories.
- No existing contract was found that resolves the verified-user representation.

## Required reconciliation

The canonical Contract-First decision must explicitly settle:

1. authoritative representation of an L2 verified user;
2. whether user and verified_user are distinct RoleAssignment role identifiers;
3. how the transition or activation between them is represented;
4. whether multiple assignments can coexist;
5. deterministic precedence if they coexist;
6. how this representation feeds the global auth response layer.

## Prohibitions

Until closed:
- do not implement RoleAssignment storage;
- do not implement layer resolver;
- do not alter docs/301 or layers.json by guess;
- do not add User.layer;
- do not use Payload User.role as a substitute;
- do not start authLogin/authRefresh runtime.

## Disposition

This is a genuine Contract/authority conflict, not an implementation bug. E6-LAYER-001 remains blocked.
