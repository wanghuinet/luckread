# AUTH-002 Worker Boundary Reconciliation — 2026-09-21

- Audit ID: M0-AUTH-002-WORKER-BOUNDARY-RECONCILIATION-001
- Feature: AUTH-002
- Scope: reconcile the current authoritative Worker/D1 boundary for login/logout and E6 authorization/session behavior.
- Status: PASS_VERIFIED_BOUNDARY — W01 DIRECT AUTHORITY REJECTED; W02 IS CANONICAL AUTHORITY

## Current canonical Worker facts

The active Worker Master and Worker × D1 Binding Mapping are authoritative:

- W01 = Public API / Gateway / Developer & Admin API Boundary; no direct authoritative D1.
- W02 = Identity / Account / Authorization; primary Tasks T01/T02/T03; D1-01 authority.
- W02 is the sole Worker authority for identity/account/authorization state under the current mapping.
- W01 must route authenticated operations to the owning Worker/contract and must not become a universal database writer.

The current Final Mapping independently records:

- T01 → W02 → D1-01 (Identity/account)
- T03 → W02 → D1-01 (Authorization)
- T24 → W01 → API boundary / no direct D1 authority

Historical W00-W08 and historical W01-W13 topology are explicitly non-authoritative and must not be reused.

## AUTH-002 implication

AUTH-002 is the canonical login/logout feature under Identity / Auth / Account.

The current repository nevertheless has no active `workers/W02/` implementation tree and no evidence-bound W02 runtime handler for the authentication operations.

Therefore the implementation path cannot be:

`W01 Payload business-auth implementation → D1-01`

That would conflict with the current Worker Master and Worker × D1 Binding Mapping.

The compliant future path must preserve the existing boundary:

`W01 API/Gateway boundary → owning AUTH-002/T01/T03 implementation boundary (W02) → D1-01`

The exact inter-Worker transport mechanism is not invented by this audit. It requires the applicable existing API/Worker binding contract before implementation.

## E6 consequence

The deterministic RoleAssignment → L0-L8 resolver remains contractually valid.

Its live authoritative data source remains D1-01 RoleAssignment.

Its implementation consumer must be the current authorization authority (W02/T03), not W01 directly.

The existing W01 Payload project may remain the platform/API boundary implementation, but it is not evidence of W02 identity/authorization implementation.

## Decision

1. W01 direct authoritative RoleAssignment read/write is **NOT ADMITTED**.
2. W01 direct implementation of AUTH-002 business authorization/session authority is **NOT ADMITTED** unless a separate approved Worker-boundary change explicitly changes the canonical mapping.
3. W02/T01/T03 remains the canonical implementation boundary.
4. No W02 implementation is inferred from documentation.
5. No new Worker, D1, table, migration, User.layer, or duplicate authority is created by this audit.

## Remaining blocker

The current E6 implementation prerequisite is therefore more precise:

- authoritative RoleAssignment source must become evidence-bound under D1-01;
- W02/T01/T03 implementation/binding must exist and be admitted under its applicable contract;
- only then can the E6 layer resolver be wired into the authLogin/authRefresh response path;
- controlled runtime evidence must be generated from the admitted implementation commit.

## Evidence references

- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `docs/02-FINAL-MAPPING-v1.0.md`
- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/entity/AUTHZ-role-assignment-authority.v1.json`
- `contracts/authz/role-assignment-layer-resolution.v1.json`
- `workers/W01-payload/src/collections/Users.ts`
- `workers/W01-payload/src/payload.config.ts`

## Anti-drift rule

This audit supersedes only the mistaken assumption that W01 itself is the authoritative AUTH-002 business Worker. It does not change the canonical 12-Worker/4-D1 architecture and does not authorize implementation.

