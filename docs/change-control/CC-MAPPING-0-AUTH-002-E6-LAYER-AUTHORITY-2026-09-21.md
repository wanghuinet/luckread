# Change Control — AUTH-002 / AUTH-011 E6 Layer Output Authority Gap v1

- ID: CC-MAPPING-0-AUTH-002-E6-LAYER-AUTHORITY-2026-09-21
- Date: 2026-09-21
- Status: CLOSED — AUTHORITY RECONCILED
- Feature: AUTH-002 / AUTH-011
- Gate: E6 Wire/Runtime output authority

## Upstream authority reconciliation

The upstream RoleAssignment authority blocker is now closed by:
`contracts/entity/AUTHZ-role-assignment-authority.v1.json`

The following E6 layer semantics are now authoritative for the next resolver/implementation gate:
- Only eligible global RoleAssignments participate in the public authLogin/authRefresh response layer.
- Organization/IP-scoped assignments remain scoped authorization inputs and do not change the global response layer.
- Each eligible roleId maps directly through `contracts/authz/layers.json`.
- Multiple eligible global assignments resolve to the highest numeric L0-L8 layer; equal-layer assignments are equivalent.
- Non-ACTIVE account state remains a deny gate before token issuance/rotation.
- Layer is derived at evaluation time; it is not persisted as User.layer and is not taken from cache.
- No valid global assignment may be replaced by an inferred fallback from verification, User.role, entitlement, subscription, membership, device or IP.

## Observed facts

The canonical authLogin/authRefresh response schema requires:
- layer: string
- pattern: ^L[0-8]$

The repository contains the authoritative L0-L8 permission-layer definitions, but the active W01 User runtime model has no implemented/canonical layer field or resolver. Current searches did not establish a runtime function that can authoritatively return the actor's layer.

## Prohibited inference

Do not:
- hard-code L1, L2 or another default;
- infer layer from account state, email verification, username, role name, subscription, entitlement, organization or device;
- add a new User field merely to make the response pass;
- introduce a new layer entity or Worker;
- treat documentation layer definitions as executable runtime evidence.

## Reconciled authority decision

The authority decision is now recorded and reconciled in:
- `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- `contracts/authz/role-assignment-layer-resolution.v1.json`
- `docs/change-control/MAPPING-0-AUTHORITY-DECISIONS-2026-09-20.md`

Resolved:
1. authoritative source = D1-01 RoleAssignment;
2. global-layer precedence = highest numeric L0-L8 among eligible global assignments;
3. organization/IP assignments do not affect global response layer;
4. layer is derived at evaluation time;
5. non-ACTIVE account state denies before successful issuance/rotation;
6. no valid global assignment or unknown role fails closed under the existing authentication/error contract.

Runtime binding remains separately gated and is not authorized by this Change Control.

## Current disposition

- E6 layer output authority: CLOSED — AUTHORITY RECONCILED.
- E6 runtime implementation: BLOCKED only for exact W01 runtime binding and controlled evidence.
- No runtime implementation or layer field is authorized by this record.
- Existing E6-WIRE-001 and E6-WIRE-002 remain resolved at authority scope.
- AUTH-002 and Mapping 0 remain NOT_GREEN.


## Closure evidence

- Deterministic resolver contract: `contracts/authz/role-assignment-layer-resolution.v1.json`
- Resolver schema: `contracts/authz/role-assignment-layer-resolution.v1.schema.json`
- Upstream RoleAssignment authority: `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- No W01 runtime code changed.
- No D1 mutation performed.
- E6 implementation remains subject to the existing runtime admission gate.
