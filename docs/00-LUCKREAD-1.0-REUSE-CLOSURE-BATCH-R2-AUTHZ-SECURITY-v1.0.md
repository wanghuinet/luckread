# Luckread 1.0 Reuse Closure — Batch R2 Auth / AuthZ / Security v1.0

> Status: **CLOSED / REUSE ALLOCATED / AUTHORIZATION FOUNDATION LOCKED**
>
> Scope: Consolidate high-value 1.0 identity, role, permission, entitlement, ownership, scope and security assets into the 2.0 canonical authority model. This batch does not introduce a second authorization system and does not implement product business features.

## 1. Objective

Close the second 1.0 reuse batch by assigning reusable Auth/AuthZ/Security assets to canonical 2.0 owners.

Implementation rule:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

## 2. Reuse disposition

| 1.0 asset | 2.0 canonical owner | Disposition | Rule |
|---|---|---|---|
| L0-L8 permission layer model | AUTHZ | DIRECT-REUSE | Layer defines capability ceiling; it is not a substitute for Role |
| RBAC role definitions | AUTHZ | MERGE | Roles map to layers and permissions; no duplicate role registry |
| Permission registry | AUTHZ | DIRECT-REUSE | One canonical permission/capability registry |
| Entitlement model | AUTHZ / MON | DIRECT-REUSE | Entitlement grants access; PAY remains financial authority |
| Ownership rules | AUTHZ / domain | DIRECT-REUSE | Ownership never bypasses safety/rights/platform policy |
| Organization scope | ORG / AUTHZ | DIRECT-REUSE | Scope is explicit and resource-bound |
| IP scope | RIGHTS / AUTHZ | DIRECT-REUSE | IP authority remains separate from generic organization membership |
| Resource scope checks | AUTHZ / domain | DIRECT-REUSE | Resource authorization is evaluated before mutation/read |
| Authorization decision contract | AUTHZ | DIRECT-REUSE | Canonical decision shape and reason semantics |
| AuthZ cache invariants | AUTHZ / OBS | REFACTOR | Cache may optimize decisions but cannot become authority |
| Account-state gate | AUTH / AUTHZ | DIRECT-REUSE | suspended/banned/deleted states remain hard security gates |
| Local API bypass protection | AUTHZ | DIRECT-REUSE | Internal/local routes cannot bypass canonical authorization |
| Audit of privileged operations | GOV / OBS | MERGE | One audit authority; immutable security evidence |
| Rate-limit / abuse controls | SAFETY / API | MERGE | Domain-specific limits use shared policy infrastructure |
| MFA / privileged-operation requirements | AUTH / AUTHZ / GOV | DIRECT-REUSE | Sensitive operations require appropriate assurance |

## 3. Canonical authorization chain

All protected operations must resolve through:

`Identity -> Account State -> Role -> Permission -> Entitlement -> Ownership/Organization/IP Scope -> Resource Scope -> Policy/Safety -> Decision -> Audit`

Not every operation requires every layer, but no layer may be silently skipped when its contract applies.

## 4. Critical 1.0 rules retained

### 4.1 Layer is not Role

L0-L8 defines capability ceilings and assurance levels. Named roles remain explicit authorization subjects. A high layer does not automatically grant access to arbitrary resources.

### 4.2 Ownership is not unlimited authority

Being an owner permits only operations allowed by domain policy, resource state, rights, safety, account state and platform rules.

### 4.3 Organization scope is explicit

Organization membership does not imply platform-wide authority. Cross-organization access is denied by default unless an explicit contract grants it.

### 4.4 Entitlement is access state

Entitlement can authorize consumption of paid/premium content after the canonical commercial transaction succeeds. It cannot be used to mutate wallet or ledger state.

### 4.5 Cache is never authority

Authorization caches are derived optimization state. Cache loss, staleness or poisoning must not grant access that the authoritative decision would deny.

### 4.6 Local/internal APIs are not trusted by location alone

An internal route, worker, admin route or server-side caller must still satisfy the applicable authorization invariant. Internal execution is not an automatic permission grant.

## 5. Reuse vs refactor boundary

### DIRECT-REUSE

Retain as canonical patterns:

- L0-L8 layer model;
- permission/capability registry;
- explicit ownership and scope evaluation;
- account-state security gate;
- authorization decision contract;
- MFA/privileged-operation requirements;
- cross-scope default-deny principle;
- local API anti-bypass invariant.

### MERGE

Merge into the 2.0 registries rather than creating parallel systems:

- RBAC role mappings;
- entitlement definitions;
- audit definitions;
- rate-limit policy metadata;
- operation-to-permission mapping.

### REFACTOR

Refactor implementations coupled to old routes, collection names, temporary middleware, cache assumptions or deprecated data shapes. Preserve the security invariant, not the obsolete implementation structure.

## 6. Explicit rejection

The following 1.0 patterns are not independent authorities in 2.0:

- route-local role checks as the sole authorization mechanism;
- client-provided role/permission/entitlement as authoritative;
- cache-only authorization decisions;
- organization membership automatically granting platform-admin privileges;
- ownership bypassing Safety/Rights/Entitlement rules;
- internal/local API trust based only on network location;
- duplicate permission registries;
- duplicate entitlement stores;
- direct balance/ledger mutation from AuthZ;
- hidden privilege escalation paths.

## 7. Canonical mapping

| Capability | 2.0 owner |
|---|---|
| Identity | AUTH / USER |
| Account state | AUTH |
| Role | AUTHZ |
| Permission | AUTHZ |
| Entitlement | AUTHZ / MON |
| Ownership | Domain + AUTHZ |
| Organization scope | ORG / AUTHZ |
| IP scope | RIGHTS / AUTHZ |
| Resource scope | AUTHZ + domain |
| Safety policy | SAFETY |
| Audit | GOV / OBS |
| Financial truth | PAY |

## 8. Acceptance gate

Every protected operation must be traceable as:

`Feature ID -> Contract -> Authentication -> Account State -> Permission/Scope -> Resource -> Policy -> Decision -> Event -> Audit -> Tests/CI`

Financial access additionally requires:

`Order -> Transaction -> Entitlement -> Revenue Split -> Ledger -> Settlement -> Audit`

## 9. R2 closure decision

Batch R2 is **CLOSED** at the reuse/allocation level.

The 1.0 authorization assets are now assigned to canonical 2.0 owners. No second AuthZ architecture is authorized.

Next work moves to **R3: State Machine reuse closure**. Do not reopen a broad Auth/AuthZ audit unless a concrete implementation, CI or contract reconciliation blocker is found.
