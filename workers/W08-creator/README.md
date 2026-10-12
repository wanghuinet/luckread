# W08 — Authorization / Creator / Organization

Canonical Worker identity: **W08**  
Canonical responsibilities: **Authorization / Creator / Organization**  
Primary Tasks: **T03, T04**  
Primary D1 authority: **D1-01**

Canonical repository path: `workers/W08-creator`. The physical path remains unchanged; Worker authority is defined by the amended Worker Master and this change-control record.

## Authorization runtime

- CASL is the shared permission policy engine for L0–L8.
- Policy source: `src/authz/casl-policy.ts`.
- Role-layer context reader: `src/authz/role-layer.ts`; it reads time-valid persisted RoleAssignment facts from D1-01 and never writes them.
- Internal endpoint: `POST /internal/authz/check-permission`.
- Worker name: existing `luckread-w08`; D1 binding is the existing D1-01 database. No new Worker, D1, Queue, public route, or caller Service Binding is introduced by this source slice.
- The endpoint returns `Cache-Control: no-store`; unknown actions, unknown roles, invalid inputs, and unavailable authorization facts fail closed.
- Callers must derive `subjectId` from trusted server-side authentication and load resource attributes from the authoritative business Worker. Callers may not provide their own layer, account state, or scoped role grants.
- Account identity, Better Auth, login/session lifecycle, and authoritative account state remain W02 responsibilities. CASL does not replace authentication, MFA/credential assurance, governance restrictions, entitlements, or domain-specific business-state checks.
- W02's existing layer projection may remain temporarily for login/session responses; it is not the business permission decision endpoint. RoleAssignment lifecycle mutation and caller wiring are explicitly separate closeout work; this PR does not deploy or change those call paths.

## Validation

The W08 verification workflow installs the pinned `@casl/ability@7.0.1`, typechecks the Worker, runs the L0–L8 policy tests, and verifies the Worker/D1 access-boundary contract.
