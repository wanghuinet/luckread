# AUTH-002 E6 Layer Authority Audit — 2026-09-21

- Audit ID: M0-AUTH-002-E6-LAYER-AUTHORITY-AUDIT-001
- Scope: determine whether the repository already contains an authoritative runtime source and deterministic resolver for the `authLogin` / `authRefresh` response `layer` field.
- Result: SOURCE DOMAIN IDENTIFIED; RESOLVER SEMANTICS STILL OPEN
- Runtime implementation authorization: false

## Verified authority facts

1. `docs/09-D1-DOMAIN-MASTER-v1.0.md` is the active canonical D1 domain master.
2. D1-01 owns identity, account/access, authorization state and entitlement/access state.
3. D1-01 primary entities include `Role` and `RoleAssignment`.
4. `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md` defines Role as an authorization input carried by `RoleAssignment`, and makes Account State a decisive authorization input.
5. `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md` is the canonical definition of the L0-L8 layers and maps the documented roles to layers.
6. `contracts/authz/layers.json` is the machine-readable L0-L8 definition and declares the same canonical source plus the authorization resolution order.
7. `docs/14-P0-AUTHORIZATION-CONTRACT-RECONCILIATION-v1.0.md` explicitly states that Payload `User.role` is only a compatibility/persistence field and must not be treated as complete authorization authority.

## Verified implementation gap

Repository search and current W01 sources do not establish:
- a persisted/authoritative `RoleAssignment` implementation in W01;
- an executable resolver that converts the effective authorization inputs into one canonical response `layer`;
- deterministic precedence when multiple applicable roles/assignments exist for a single user;
- the exact runtime binding point that supplies the `layer` value for both `authLogin` and `authRefresh`.

## Prohibited shortcuts

The following remain unauthorized:
- hard-code L1/L2/another default;
- derive layer from email verification, account state, username, Payload role string, entitlement, subscription, organization, device or cache alone;
- add `User.layer`, a duplicate layer entity or a new Worker merely to satisfy the DTO;
- treat the documentation mapping itself as runtime evidence.

## Closure decision

The audit narrows E6-LAYER-001 from “unknown authority source” to:

`D1-01 Role/RoleAssignment authority identified; effective RoleAssignment-to-L0-L8 resolver and multi-assignment precedence are still contract inputs requiring explicit authority decision.`

Therefore:
- E6-LAYER-001 remains OPEN.
- E6 runtime implementation remains BLOCKED.
- No W01 runtime code changed.
- No D1 mutation performed.
- No Mapping row re-executed.
