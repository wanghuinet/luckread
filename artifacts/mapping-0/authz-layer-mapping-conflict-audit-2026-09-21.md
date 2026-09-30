# AUTHZ Layer Mapping Conflict Audit — 2026-09-21

- Audit ID: M0-AUTHZ-LAYER-MAPPING-CONFLICT-001
- Status: CLOSED — REPRESENTATION RECONCILED
- Parent: CC-MAPPING-0-AUTHZ-ROLE-ASSIGNMENT-AUTHORITY-2026-09-21
- Resolution: docs/change-control/CC-MAPPING-0-AUTHZ-L1-L2-ROLE-REPRESENTATION-2026-09-21.md
- Impact after resolution: the L1/L2 role-identifier ambiguity is closed; ENT-ROLE-ASSIGNMENT authority remains independently open and still blocks deterministic runtime resolution.

## Conflicting existing statements

### Canonical prose contract: docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md

The role-to-layer table describes:
- user (unverified) to L1
- user (verified) to L2
- creator to L3
- mcn_admin to L4
- mcn_editor to L4
- moderator to L6
- admin to L7
- super_admin to L8

The same contract also declares `verified_user` a required new role at L2.

### Machine-readable contract: contracts/authz/layers.json

The machine-readable mapping states:
- user to L1
- verified_user to L2
- creator to L3
- mcn_admin / mcn_editor to L4
- moderator to L6
- admin to L7
- super_admin to L8

## Reconciliation decision

The `user (verified)` wording in the descriptive table is treated as a human-readable account/verification state, not as a second normalized RoleAssignment identifier.

The canonical normalized mapping is:

```text
user          → L1
verified_user → L2
```

Verification remains a separate authorization input under docs/303. It is not itself a Role or Entitlement and does not become arbitrary authorization solely by being present.

Existing Payload `User.role` remains a compatibility/projection field and is not rewritten by this reconciliation.

## Explicit non-decisions

This reconciliation does not define:
- RoleAssignment table/schema fields;
- RoleAssignment status or temporal-validity model;
- assignment activation workflow;
- multi-assignment coexistence or precedence;
- organization/IP scoped assignment behavior;
- runtime resolver implementation;
- authLogin/authRefresh integration.

Those remain under the separate ENT-ROLE-ASSIGNMENT authority Change Control.

## Closure checks

- Existing machine mapping remains unchanged.
- No new role name was introduced by this reconciliation; `verified_user` was already declared by the canonical contract.
- No `User.layer` field was introduced.
- No D1 mutation or RoleAssignment persistence was introduced.
- No runtime code was changed.
- The ambiguity no longer requires choosing between `user→L2` and `verified_user→L2`; normalized L2 role identity is `verified_user`.

## Next dependency

`CC-MAPPING-0-AUTHZ-ROLE-ASSIGNMENT-AUTHORITY-2026-09-21` remains OPEN. Its required authority contract must define the concrete RoleAssignment inputs before E6-LAYER-001 can advance to deterministic resolver specification.