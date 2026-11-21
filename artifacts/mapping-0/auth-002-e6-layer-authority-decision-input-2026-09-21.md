# AUTH-002 E6 Layer Authority Decision Input Pack — 2026-09-21

- Decision ID: M0-AUTH-002-E6-LAYER-AUTHORITY-DECISION-INPUT-001
- Parent Change Control: docs/change-control/CC-MAPPING-0-AUTH-002-E6-LAYER-AUTHORITY-2026-09-21.md
- Status: RESOLVED — AUTHORITY DECISION RECORDED
- Runtime implementation: BLOCKED
- D1 mutation: NOT AUTHORIZED

## Already established authority

| Item | Authority |
|---|---|
| L0-L8 definitions | docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md |
| Machine-readable L0-L8 definitions | contracts/authz/layers.json |
| Authorization decision model | contracts/authz/authorization-decision.json |
| Role/permission authority domain | D1-01 |
| Role assignment input model | docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md |
| Payload User.role | Compatibility metadata only; not complete authorization authority |
| Public response shape | authLogin/authRefresh require layer matching ^L[0-8]$ |

## Decision resolution

The decision questions were resolved by the following canonical records:
- RoleAssignment authority: `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- Deterministic layer resolver: `contracts/authz/role-assignment-layer-resolution.v1.json`
- Authority decision record: `docs/change-control/MAPPING-0-AUTHORITY-DECISIONS-2026-09-20.md`

Reconciled outcome:
- Effective source = authoritative D1-01 RoleAssignment records for the subject.
- Eligibility = ACTIVE + temporal validity + applicable authoritative scope.
- Global response layer uses only global assignments.
- Organization/IP assignments remain scoped authorization inputs.
- Multiple eligible global assignments select the highest numeric L0-L8 layer.
- Layer maps directly through `contracts/authz/layers.json`.
- Non-ACTIVE account state denies before successful token issuance/rotation.
- Layer is derived at evaluation time, not persisted.
- Unknown/no eligible global role fails closed under the existing authentication/error contract.
- Runtime binding remains an implementation/evidence task, not a contract gap.

## Historical decision questions (now resolved)

The authority record must explicitly answer all of the following:

1. Effective source: which authoritative RoleAssignment record(s) are evaluated at login/refresh time?
2. Eligibility: what makes a RoleAssignment active/applicable (status, scope, time validity, revocation, tenant/IP context)?
3. Multiple assignments: when more than one applicable assignment exists, what deterministic rule produces one response layer?
4. Mapping: is the layer resolved directly from the role→layer mapping in contracts/authz/layers.json, or through another authoritative authorization projection?
5. Scope: does an organization/IP-scoped role affect the global response layer, or only resource-scoped authorization?
6. Account-state interaction: when account state is not ACTIVE, what is the response behavior before/at token issuance/rotation?
7. Persisted vs derived: is the login/refresh layer persisted, derived on each request, or projected into runtime context?
8. Runtime binding: which W01 authorization function/extension point supplies the final layer to authLogin/authRefresh?
9. Failure behavior: if the authoritative resolver cannot return one valid L0-L8 value, what stable fail-closed outcome and error contract applies?

## Existing constraints

- Do not hard-code L1/L2 or another default.
- Do not derive the layer from email verification, username, device, IP, User-Agent, cache, subscription or entitlement alone.
- Do not treat Payload admin state or User.role as complete public API authority.
- Do not add User.layer, a duplicate layer entity, a new Worker, or a new D1 solely to satisfy the DTO.
- Do not change the frozen authLogin/authRefresh wire field or regex.
- No runtime implementation is admitted by this document alone; implementation remains gated by the existing E6 implementation-admission Change Control.

## Closure evidence required after decision

1. Contract-First decision record with a stable identifier.
2. Reconciliation against docs/301 and contracts/authz/layers.json.
3. Explicit multi-assignment precedence and negative behavior.
4. Deterministic resolver specification suitable for implementation.
5. W01 runtime implementation admission update.
6. Executable tests/evidence proving the resolver behavior.
7. Auth login/refresh integration evidence showing the returned layer matches the resolved authority.

## Current closure state

E6-LAYER-001 authority-input portion is **CLOSED — CONTRACT RECONCILED**.
The remaining work is the exact existing W01 runtime binding and controlled executable evidence. Do not reopen this input pack unless a new authoritative contract changes these inputs.

## Anti-loop marker

Previous repository scans already established:
- no `effectiveLayer` implementation;
- no executable RoleAssignment→L0-L8 resolver;
- no deterministic multiple-role precedence;
- no W01 runtime layer binding.

Do not repeat the same repository-wide search unless a new canonical authority artifact or implementation commit changes these inputs.
