# W08 — Creator / Organization + CASL Policy Evaluation

Canonical Worker identity: **W08**  
Primary Task: **T04**  
Primary D1 authority: **D1-01**

## Responsibility

W08 remains the creator/organization domain. Under [CC-1.1-W08-CASL-POLICY-ENGINE-2026-10-13](../../docs/change-control/CC-1.1-W08-CASL-POLICY-ENGINE-2026-10-13.md), its code also hosts the bounded CASL policy evaluator.

- W02 remains authoritative for identity, account state, credentials, sessions, role assignments, and L0-L8 resolution.
- W08 evaluates trusted server-side effective permission context against `contracts/authz/permissions.json`.
- `resolveCatalogPermissionsForRoles` maps current, authoritative W02 RoleAssignment role IDs to explicit catalogued permissions; unknown roles fail closed. The map covers only currently catalogued permissions, and documented permission IDs absent from the catalogue remain an explicit open gap.
- W08 does not persist or independently resolve role assignments, infer layers, or become a second identity/account source of truth.
- The policy module does not access D1 directly and does not replace the owning Worker's entitlement, workflow, resource ownership, lifecycle, or business-state gates.
- Unknown permissions, malformed context, insufficient layer, missing required MFA, and out-of-scope resources fail closed; explicit DENY overrides ALLOW.

## Current implementation status

`src/authorization.ts` is the local policy evaluator and `src/authorization.test.ts` covers its unit-level security boundaries.

**Not yet production-integrated:** this directory does not yet expose an admitted public route or cross-Worker transport contract for runtime policy decisions. Unit tests must not be interpreted as proof that current public APIs use this evaluator or as Security GREEN.

No additional Worker, D1, Queue, or Payload Core change is introduced.
