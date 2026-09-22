# Mapping 0 — E6 W02 Physical Binding & RoleAssignment Decision Packet

- Date: 2026-09-22
- Status: `DECISION_A_RECORDED / DECISION_B_WAIT_AUTHORITY_DECISION`
- Scope: `GAP-E6-RUNTIME-001` only
- Repository authority: GitHub `main`
- Prepared against current main: `711d5a411a15abab8e2d2ec0114cb27975f51c6a`

## Purpose

Prepare the minimum decision inputs required to unblock the existing AUTH-002 E6 runtime gate without changing the frozen 12-Worker / 4-D1 logical architecture, API contracts, session identity model, or authorization semantics.

Decision A is now recorded from the project authority's explicit source-path choice plus the deployment/transport decision recorded in `docs/change-control/CC-MAPPING-0-E6-W02-DEPLOYMENT-TRANSPORT-DECISION-2026-09-22.md`. Decision B remains unresolved.

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
- Do not infer physical authority merely from directory naming. The project authority has now explicitly selected `workers/W02-content` as the W02 source path; that selection is the authority input for this Change Control.
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

- A: `DECIDED — source path, Worker name, deployment mode and transport recorded`
- B: `WAIT_AUTHORITY_DECISION`
- C: `BLOCKED` until B is complete and A has deployment evidence
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


## Decision A confirmation — 2026-09-22

Project authority input now recorded:
- W02 source path = `workers/W02-content`.
- Physical Worker name = `luckread-w02`.
- Deployment = controlled GitHub Actions `workflow_dispatch` using Wrangler, exact source-commit provenance, GitHub Cloudflare secrets, and no automatic push-to-production trigger.
- Transport = W01 → W02 Cloudflare Service Binding over the HTTP interface, binding name `W02_AUTH`, target service `luckread-w02`.
- The target Worker must be deployed before the caller's Service Binding deployment can succeed.

These are decision inputs, not deployment evidence. No Worker was created or deployed by this decision record.

## Current-head revalidation — 2026-09-22

A targeted current-`main` search was performed for concrete W02 physical naming/resource authority and existing `ENT-ROLE-ASSIGNMENT` implementation/persistence authority.

Result: **NO_NEW_AUTHORITY_FOUND / PASS_INHERITED**.

No existing authoritative physical W02 name/resource binding, no current W02 runtime implementation, and no existing RoleAssignment physical table/migration/runtime implementation evidence was found beyond the already recorded audits.

This observation does not change any Contract, Mapping record, Worker topology, D1 schema, or implementation status.

Per the anti-loop rule, this search result is now inherited. It must not be repeated unless a new Contract, authority decision, implementation/persistence commit, deployment evidence, or relevant remote evidence changes the input set.

## Decision B authority confirmation — 2026-09-22

Project authority has now explicitly decided the logical-to-physical D1 allocation:

- **D1-01 = 主数据库（primary database）** — authoritative persistence domain for Identity / Account / Access, including the already-contracted `ENT-ROLE-ASSIGNMENT`.
- **D1-02 = 从数据库（secondary database）** — separate logical domain assignment; it is not the persistence authority for `ENT-ROLE-ASSIGNMENT`.
- Physical database display names are **non-authoritative labels** and may be renamed. Binding evidence MUST use the actual Cloudflare database identity/UUID and deployment configuration, not the names `luckread` or `luckreadpro`.

This closes the prior Decision B authority-input gap at the logical allocation level. It does **not** by itself prove physical UUID binding, create/mutate a D1 database, generate a migration, or promote `ENT-ROLE-ASSIGNMENT` to VERIFIED.

Next controlled steps are therefore evidence binding and implementation admission: identify the physical D1-01 UUID from the controlled Cloudflare inventory, record the D1-01 binding, then proceed through the existing RoleAssignment implementation/evidence gate. No Contract or Blueprint semantics are changed.

