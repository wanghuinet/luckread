# Change Control — AUTHZ L1/L2 Role Representation Reconciliation v1

- ID: CC-MAPPING-0-AUTHZ-L1-L2-ROLE-REPRESENTATION-2026-09-21
- Status: CLOSED — CONTRACT RECONCILIATION ADMITTED
- Parent: M0-AUTHZ-LAYER-MAPPING-CONFLICT-001
- Scope: reconcile the existing L1/L2 role representation ambiguity without changing the existing role contracts or introducing persistence.

## Authority basis

1. `contracts/authz/layers.json` is the machine-readable L0-L8 contract and explicitly maps:
   - `user` → L1
   - `verified_user` → L2
2. `contracts/authz/layers.json` also declares `verified_user` as a required new role and names `docs/301` as its canonical source.
3. `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md` describes the user lifecycle as:
   - `user` (unverified) → L1
   - `user` (verified) → L2
   and separately declares `verified_user` as the required L2 role.
4. `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md` explicitly separates Verification from Role and states that Verification is an authorization input, not a Role substitute.
5. `docs/14-P0-AUTHORIZATION-CONTRACT-RECONCILIATION-v1.0.md` makes Payload `User.role` compatibility metadata only, not complete authorization authority.

## Reconciliation decision

The phrase `user (verified)` in the descriptive layer table is interpreted as a human-readable verified-user account state, not as a second canonical RoleAssignment identifier.

For normalized authorization mapping:

```text
user           → L1
verified_user  → L2
```

The canonical normalized L2 role identifier is therefore `verified_user`.

Verification status remains a separate authorization input. Verification alone does not become a permission, entitlement, or arbitrary role. An effective L2 authorization state must be represented through the canonical authorization model; this record does not define its persistence mechanics or invent a RoleAssignment schema.

## Compatibility rule

The existing Payload `User.role` value remains a v1 compatibility/projection field. This reconciliation does not require rewriting existing users or mutating `User.role` from `user` to `verified_user`.

## Multiple assignments

This reconciliation does **not** authorize multiple concurrent L1/L2 RoleAssignments, nor does it define precedence among arbitrary RoleAssignments. Those remain part of the separate ENT-ROLE-ASSIGNMENT authority contract.

## Runtime consequence

The public authLogin/authRefresh `layer` field must resolve from the future canonical authorization source. No runtime layer may be hard-coded or inferred directly from verification state or Payload `User.role`.

## Change boundary

No changes were made here to:
- `docs/301`;
- `contracts/authz/layers.json`;
- Payload User schema;
- D1 schema;
- RoleAssignment persistence;
- W01 runtime.

## Closure evidence

- Existing machine role mapping and required-role declaration are mutually usable after treating the `user (verified)` wording as descriptive state rather than normalized role identity.
- Verification/Role separation is preserved.
- Payload compatibility semantics are preserved.
- The downstream implementation blocker is narrowed to the independent ENT-ROLE-ASSIGNMENT authority contract.

## Next gate

`ENT-ROLE-ASSIGNMENT` authority remains OPEN and is the next required upstream contract input before deterministic layer resolution or E6 runtime implementation.
