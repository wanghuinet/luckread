# W02 — Identity / Account / Authorization

Canonical Worker role: Identity / Account / Authorization.

Project authority has selected this repository path as the physical source location for canonical W02:
`workers/W02-identity`

The directory name `W02-identity` is the canonical physical path for W02; Worker authority remains defined by the Worker Master. Canonical W02 owns T01/T02/T03 and D1-01 under the ACTIVE/CANONICAL Worker Master.

Deployment and inter-Worker transport are governed by:
`docs/change-control/CC-MAPPING-0-E6-W02-DEPLOYMENT-TRANSPORT-DECISION-2026-09-22.md`

Implementation admission is now GREEN at source-implementation scope after the explicit D1-01/D1-02 physical allocation decision. W02 contains the contracted RoleAssignment resolver and Contract-driven D1-01 migration source. Remote D1 mutation and Worker deployment remain controlled evidence steps; Payload remains the platform base in W01.

## Current implementation boundary

- W02 Worker name: `luckread-w02`.
- D1 binding: `D1_01` → D1-01 primary UUID `2f80471e-3756-49f9-8db1-7707a433ad64`.
- RoleAssignment migration source: `workers/W02-identity/migrations/0001_role_assignments.sql`.
- Migration generation guard: `scripts/generate-role-assignment-migration.mjs`.
- Layer resolver: `workers/W02-identity/src/authz/role-assignment.ts`.
- CASL policy engine: `workers/W02-identity/src/authz/casl-policy.ts` (`@casl/ability` pinned to `7.0.1`).
- Internal layer endpoint: `POST /internal/authz/resolve-layer`.
- Internal permission endpoint: `POST /internal/authz/check-permission`.
- Internal session endpoints: `POST /internal/auth/session/establish`, `/refresh`, `/revoke`, `/validate`.
- These are Service Binding internal transports only; no public W02 auth endpoint is introduced.
- W01 transport binding: `W02_AUTH` → `luckread-w02`; deployment evidence remains pending.



## CASL authorization core

W02 owns the shared L0-L8 permission evaluation entry point. The internal
\`POST /internal/authz/check-permission\` endpoint reads account state and
global role-layer facts from D1-01, and derives IP/organization scope grants
from currently active, time-valid \`RoleAssignment\` records. Callers cannot
supply their own layer, account state, or scope IDs. The request supplies only
the permission action and resource facts that the owning business domain has
already loaded.

The CASL engine denies unregistered actions and unsupported resource types by
default, checks user/resource ownership, limits scoped IP/organization roles
to their recorded scope, blocks L7 assignment of L8, and forbids audit-log
mutation at every layer. The endpoint is internal Service-Binding transport
and sends \`Cache-Control: no-store\`; authorization decisions are not cached.

**Permission checks are one required authorization facet, not a replacement
for the canonical decision contract.** Callers must still enforce authenticated
principal/session validity, account-state and ownership facts from their
authoritative domains, entitlement/subscription, MFA/credential assurance,
workflow approvals and business-state checks where applicable. A positive
CASL result alone must not authorize a sensitive administrative or commercial
operation. Payload Access Control remains in place for CMS enforcement.
