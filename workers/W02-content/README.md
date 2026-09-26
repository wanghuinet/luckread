# W02 — Identity / Account / Authorization

Canonical Worker role: Identity / Account / Authorization.

Project authority has selected this repository path as the physical source location for canonical W02:
`workers/W02-content`

The legacy directory name `W02-content` is a repository path only; it is not the canonical logical role. Canonical W02 owns T01/T02/T03 and D1-01 under the ACTIVE/CANONICAL Worker Master.

Deployment and inter-Worker transport are governed by:
`docs/change-control/CC-MAPPING-0-E6-W02-DEPLOYMENT-TRANSPORT-DECISION-2026-09-22.md`

Implementation admission is now GREEN at source-implementation scope after the explicit D1-01/D1-02 physical allocation decision. W02 contains the contracted RoleAssignment resolver and Contract-driven D1-01 migration source. Remote D1 mutation and Worker deployment remain controlled evidence steps; Payload remains the platform base in W01.

## Current implementation boundary

- W02 Worker name: `luckread-w02`.
- D1 binding: `D1_01` → D1-01 primary UUID `2f80471e-3756-49f9-8db1-7707a433ad64`.
- RoleAssignment migration source: `workers/W02-content/migrations/0001_role_assignments.sql`.
- Migration generation guard: `scripts/generate-role-assignment-migration.mjs`.
- Resolver: `workers/W02-content/src/authz/role-assignment.ts`.
- Internal resolution endpoint: `POST /internal/authz/resolve-layer`.
- Internal session endpoints: `POST /internal/auth/session/establish`, `/refresh`, `/revoke`, `/validate`.
- These are Service Binding internal transports only; no public W02 auth endpoint is introduced.
- W01 transport binding: `W02_AUTH` → `luckread-w02`; deployment evidence remains pending.

