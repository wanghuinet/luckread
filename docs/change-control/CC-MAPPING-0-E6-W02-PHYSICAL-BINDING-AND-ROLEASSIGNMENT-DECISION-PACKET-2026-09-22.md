# Mapping 0 — E6 W02 Physical Binding & RoleAssignment Decision Packet

- Date: 2026-09-22
- Status: `WAIT_AUTHORITY_DECISION`
- Scope: `GAP-E6-RUNTIME-001` only
- Repository authority: GitHub `main`
- Prepared against current main: `711d5a411a15abab8e2d2ec0114cb27975f51c6a`

## Purpose

Prepare the minimum decision inputs required to unblock the existing AUTH-002 E6 runtime gate without changing the frozen 12-Worker / 4-D1 logical architecture, API contracts, session identity model, or authorization semantics.

This packet is a decision aid only. It does not select a physical Worker name, transport, implementation location, D1 schema, or deployment target.

## Verified current facts

1. Canonical logical authority:
   - W01 = Public API / Gateway edge.
   - W02 = Identity / Account / Authorization.
   - T01/T02/T03 and D1-01 remain under W02 authority.
2. Current Cloudflare read-only inventory records 2 D1 resources and 0 uploaded Worker scripts.
3. No current repository evidence establishes a concrete physical Worker resource/name/source binding for canonical W02.
4. No current repository evidence establishes an implemented or persisted `ENT-ROLE-ASSIGNMENT`.
5. `contracts/entity/AUTHZ-role-assignment-authority.v1.json` and `contracts/authz/role-assignment-layer-resolution.v1.json` already freeze the RoleAssignment semantics and deterministic layer algorithm at Contract scope.
6. AUTH-002 remote schema evidence is already closed at read-only evidence scope; do not repeat it without changed inputs.
7. E6 wire/input and layer-authority reconciliations are already closed and must be inherited.

## Decision A — Physical canonical W02 binding

The authority decision must establish, using the existing logical W02 ownership:

- the concrete physical Worker resource/name;
- the repository source path or implementation source that owns that physical Worker;
- the deployment configuration that binds source to that resource;
- the source-commit → build → deployment evidence chain;
- the approved W01 ↔ W02 transport mechanism for AUTH-002 / T01 / T03 traffic.

Constraints:
- Do not derive the physical identity from `workers/W02-content` or any directory naming convention.
- Do not import historical P01-P08 or W01-W13 topology.
- Do not create a Worker merely to satisfy Mapping 0.
- Do not reassign `luckread-w01-payload` from W01 to W02.
- Do not introduce a new Worker or D1 domain unless separately and explicitly approved by a new architectural Change Control.

## Decision B — D1-01 RoleAssignment realization

The authority decision must establish how the already-contracted `ENT-ROLE-ASSIGNMENT` becomes an evidence-bound implementation under D1-01.

Required outputs:
- implementation owner = W02/T03 authorization boundary;
- physical persistence source under D1-01;
- evidence-backed entity/field/persistence registration;
- uniqueness, status, validity and role_version semantics remain exactly those already contracted;
- runtime resolver reads the authoritative source and does not treat User.role, cache, device, IP, entitlement, subscription, membership or verification as a substitute.

Constraints:
- No new RoleAssignment entity variant.
- No hand-authored schema invented from column names.
- No duplicate authorization authority.
- No User.layer field.
- No client-supplied role elevation.
- No runtime promotion from contract-only evidence.

## Decision C — E6 admission prerequisites after A/B

Only after Decision A and Decision B are approved and implemented may the existing E6 admission gate proceed to:

1. static/type/build validation;
2. canonical W01 edge ↔ W02 runtime binding verification;
3. RoleAssignment persistence/runtime evidence;
4. controlled `authLogin` / `authRefresh` execution;
5. security and concurrency evidence;
6. commit-bound Evidence Registry records;
7. final Mapping 0 reconciliation.

## Current decision state

- A: `WAIT_AUTHORITY_DECISION`
- B: `WAIT_AUTHORITY_DECISION`
- C: `BLOCKED` until A and B are complete
- AUTH-002: `NOT_GREEN`
- Mapping 0: `NOT_GREEN`

## Anti-loop rule

This packet closes the discovery phase for GAP-E6-RUNTIME-001. Repeating broad repository searches for physical W02 binding or RoleAssignment implementation is not useful unless a new source/Contract/authority decision/remote evidence artifact changes the evidence set.

## Source evidence

- `artifacts/mapping-0/current-w01-downstream-checkpoint-2026-09-22.json`
- `artifacts/mapping-0/auth-002-worker-boundary-reconciliation-2026-09-21.md`
- `artifacts/mapping-0/worker-deployment-admission-audit-2026-09-21.md`
- `artifacts/mapping-0/authz-role-assignment-real-evidence-absence-audit-2026-09-21.md`
- `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- `contracts/authz/role-assignment-layer-resolution.v1.json`
- `docs/change-control/CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21.md`


## Current-head revalidation — 2026-09-22

A targeted current-`main` search was performed for concrete W02 physical naming/resource authority and existing `ENT-ROLE-ASSIGNMENT` implementation/persistence authority.

Result: **NO_NEW_AUTHORITY_FOUND / PASS_INHERITED**.

No existing authoritative physical W02 name/resource binding, no current W02 runtime implementation, and no existing RoleAssignment physical table/migration/runtime implementation evidence was found beyond the already recorded audits.

This observation does not change any Contract, Mapping record, Worker topology, D1 schema, or implementation status.

Per the anti-loop rule, this search result is now inherited. It must not be repeated unless a new Contract, authority decision, implementation/persistence commit, deployment evidence, or relevant remote evidence changes the input set.
