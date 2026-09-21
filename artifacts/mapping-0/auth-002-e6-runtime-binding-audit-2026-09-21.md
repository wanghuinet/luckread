# AUTH-002 E6 Runtime Binding Audit — 2026-09-21

- Audit ID: M0-AUTH-002-E6-RUNTIME-BINDING-AUDIT-001
- Feature: AUTH-002
- Gate: E6 Native Session Runtime Evidence
- Scope: determine whether the active W01 source tree already contains an admitted runtime binding that can supply the canonical `layer` value for `authLogin` / `authRefresh`.

## Current-head source facts

1. `workers/W01-payload/src/collections/Users.ts`
   - declares the `users` collection;
   - enables Payload native authentication with `auth: true`;
   - currently declares no `hooks` block, no custom auth strategy, and no custom auth endpoint.

2. `workers/W01-payload/src/payload.config.ts`
   - declares the active Payload configuration, D1 adapter, R2 plugin and current `onInit` adapter correction;
   - currently declares no root custom `endpoints` for `/auth/*`;
   - currently declares no root authentication hook binding.

3. Active W01 source-tree search found no `route.ts` implementation and no `src/app/api/*` runtime route for the canonical `/auth/login` or `/auth/refresh` operations.

4. Canonical API definitions exist in:
   - `contracts/openapi/v1/openapi.yaml`
   - `contracts/api/auth-operation-policy.v1.json`
   - `contracts/dto/auth-dto-contract.v1.json`

   These establish API contract authority only. They do not prove executable W01 runtime binding.

5. Repository Payload reference material documents supported collection auth extension points such as `beforeLogin`, `afterLogin`, `afterRefresh`, `refresh`, and `afterOperation`, but these are capability references and are not themselves active W01 implementation evidence.

## Decision

**EXACT EXISTING W01 RUNTIME BINDING: NOT PROVEN.**

The repository currently proves native Payload authentication capability, but it does not prove an already-bound implementation path that:

- receives the canonical `authLogin` / `authRefresh` operation;
- resolves the authoritative RoleAssignment source;
- invokes the deterministic RoleAssignment -> L0-L8 resolver;
- places the derived `layer` into the canonical response shape.

A generic statement that Payload supports authentication hooks or custom endpoints is insufficient to close this gap.

## Contract-First consequence

No runtime code is authorized by this audit.

The remaining E6 runtime gap therefore has two independent implementation prerequisites:

1. an evidence-bound authoritative RoleAssignment source owned by D1-01;
2. an explicit Change-Control-approved W01/Payload binding for the canonical authentication operations and their response projection.

After both prerequisites are satisfied, the existing E6 admission gate may be reconsidered. Controlled runtime evidence must still be generated against the exact admitted source commit.

## Prohibited inference

Do not:

- treat `User.role` as the RoleAssignment authority;
- treat Payload framework capability documentation as implementation evidence;
- add a new Worker or D1;
- add a duplicate layer entity;
- create a hand-authored RoleAssignment migration from this audit;
- modify Payload Core;
- mark E6 or Mapping 0 GREEN.

## Evidence references

- Active implementation: `workers/W01-payload/src/collections/Users.ts`
- Active implementation: `workers/W01-payload/src/payload.config.ts`
- Canonical API: `contracts/openapi/v1/openapi.yaml`
- API policy: `contracts/api/auth-operation-policy.v1.json`
- DTO contract: `contracts/dto/auth-dto-contract.v1.json`
- RoleAssignment authority: `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- Layer resolver: `contracts/authz/role-assignment-layer-resolution.v1.json`
- E6 admission: `docs/change-control/CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21.md`

## Audit result

`PASS_VERIFIED_AUDIT — NO EXISTING RUNTIME BINDING PROVEN; IMPLEMENTATION REMAINS BLOCKED`
