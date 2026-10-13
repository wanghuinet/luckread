# CC-1.1-W08-CASL-POLICY-ENGINE-2026-10-13

## Status

`DECISION RECORDED / POLICY EVALUATOR SLICE AUTHORIZED`

## 1. Decision

W08 will host the CASL-based application permission policy evaluator. This is a bounded policy-execution responsibility inside the existing W08 directory; it does not introduce another Worker, Task, D1, Queue, identity store, role store, or authorization fact store.

The authority split is:

```text
W02 / Better Auth
  = User identity, credentials, sessions, account state,
    authoritative RoleAssignment facts, and L0-L8 resolution

W08 / CASL
  = Evaluate a trusted, server-resolved permission context against
    the canonical permission catalog, minimum layer, MFA, scope,
    ownership, and explicit DENY rules

Owning business Worker
  = Enforce its own resource lifecycle, entitlement, workflow,
    business-state, and mutation/audit contracts
```

This decision implements the user-directed separation of the account system (W02) from the permission evaluation engine (W08), while retaining W02 as the source of truth for identity, account, role-assignment, and resolved-layer facts.

## 2. Permission inputs

W08 must consume only server-trusted context. Identity ID, account state, layer, effective permission names, MFA status, and organization/IP scopes must be resolved by authoritative server-side code.

W08 must never accept client-supplied roles, permission lists, layer values, ownership claims, organization/IP memberships, or MFA claims as authorization facts.

The preferred `createW08AbilityForRoles` input is a complete set of authoritative W02 RoleAssignment tuples (`roleId`, `scopeType`, `scopeId`) with active/time-valid status already verified by W02. Each role is checked against the canonical scope type in the permission contract. A global assignment must have `scopeId: null`; an organization/IP assignment must have one exact non-empty `scopeId`. The resolved global layer must match the highest global assignment. Organization/IP grants are emitted per assignment and bound to that assignment's ID; IDs from different assignments are never combined into one `$in` scope. Global role mappings cannot grant organization/IP-scoped permission names. Unknown roles, role/scope mismatch, invalid scope IDs, missing global layer, or inconsistent layer fail closed.

The canonical machine-readable permission vocabulary is `contracts/authz/permissions.json`. Its `x-role-permissions` section defines explicit additive grants for every role in `contracts/authz/layers.json`; `resolveCatalogPermissionsForRoles` exposes this mapping to trusted server code. The catalog now covers public discovery, verified-user interactions and notifications, creator self-service/revisions, and L5 curation/topic/campaign/analytics operations. The L5 operations require verified MFA at evaluation time.

The mapping remains deliberately marked `PARTIAL_IMPLEMENTED_PERMISSION_CATALOG`. Only two permission identifiers referenced by docs/301 remain intentionally open in `x-role-permissions-gap`: `security.manage` and `role.assign.any`. These L8 operations require their separate high-risk grant/approval semantics before they can be safely materialized. Unknown role IDs or an inconsistent role/permission map return `null`, and a permission absent from the catalog cannot grant access. The layer is a ceiling and a minimum-layer check; it does not independently grant permission. The caller must provide only active, time-valid role assignments resolved from W02 and keep scope assignment context authoritative.

## 3. Mandatory policy invariants

1. Default deny. A missing, malformed, inconsistent, or incomplete trusted context produces an empty ability.
2. Explicit DENY is applied after grants and must override any matching ALLOW.
3. The resolved layer must meet the permission's catalogued `minLayer`.
4. L5-L8 protected/operational grants require verified MFA.
5. Every L8 permission additionally requires trusted, target-bound privileged approval evidence: exact permission and resource type, actor match, non-empty reason, two distinct approvers excluding the actor, an active issue/expiry interval no longer than four hours, and a verified audit-event reference. Missing/invalid evidence denies the privileged action.
6. L8 approvals bind the resulting CASL grant to the approved resource ID; a permission check made with only a resource-type string fails closed whenever a conditional rule applies.
7. Own, organization, and IP grants require matching server-resolved resource/scope context.
8. Restricted/frozen accounts may receive only explicitly granted public-read/resolve permissions. Suspended, pending-deletion, deleted, and banned accounts receive no grants from this evaluator.
9. Anonymous L0 access is limited to explicitly granted public read/resolve actions; it cannot use own, organization, IP, or platform scopes.
10. The evaluator is not authentication, role assignment, entitlement, ownership, workflow, business-state, or approval-authority truth. A trusted adapter must verify approval and audit evidence before passing it to W08.

## 4. Boundary and implementation status

This change does not modify Better Auth or Payload Core, and does not transfer D1-01 role-assignment persistence or layer resolution from W02 to W08. The initial code slice is a local policy module and unit tests only.

No public API route, cross-Worker call, or production authorization path is declared integrated by this change. Runtime acceptance remains blocked until a separate admitted integration slice wires the evaluator through an explicit transport/contract, proves that trusted context cannot be supplied by clients, and provides positive/negative runtime evidence.

## 5. Acceptance evidence

Required for eventual closure:

- CASL ability module is tested against the canonical permission catalog.
- Unknown grants and missing/invalid context fail closed.
- Ownership, organization/IP scope, minimum layer, MFA, and DENY precedence have positive and negative tests.
- Public/private resource behavior is verified at the owning Worker boundary.
- Runtime API tests prove unauthorized direct calls are denied and valid scoped calls are allowed.
- CI evidence is recorded without conflating unit-test success with runtime or security GREEN.

This change preserves the frozen 12 Worker / 4 D1 / 25 Task topology.
