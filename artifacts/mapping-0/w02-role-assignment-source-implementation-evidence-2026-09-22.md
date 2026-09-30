# W02 RoleAssignment Source Implementation Evidence — 2026-09-22

- Audit ID: M0-AUTHZ-ROLE-ASSIGNMENT-SOURCE-IMPLEMENTATION-2026-09-22
- Scope: GAP-E6-RUNTIME-001
- Evidence class: SOURCE_IMPLEMENTATION_ONLY
- Authority: GitHub main
- D1-01 physical primary allocation UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`
- D1-02 physical secondary allocation UUID: `6c342634-97f6-4248-9f4a-85772af4f22c`

## Source implementation present

1. W02 Worker configuration
   - `workers/W02-content/wrangler.jsonc`
   - Worker: `luckread-w02`
   - D1 binding: `D1_01`
   - Physical database identity: D1-01 UUID above
   - `workers_dev=false`

2. RoleAssignment resolver
   - `workers/W02-content/src/authz/role-assignment.ts`
   - Reads only `role_assignments` from D1-01.
   - Enforces account-state gate before successful resolution.
   - Filters subject, ACTIVE status, temporal validity, and global scope.
   - Resolves role identifiers through canonical `contracts/authz/layers.json`.
   - Selects the highest numeric L0-L8 layer.
   - Fails closed when authorization input is unavailable or no eligible global assignment exists.
   - Does not use User.role, cache, IP, device, entitlement, subscription or membership as a substitute authority.

3. Internal W02 endpoint
   - `workers/W02-content/src/index.ts`
   - `POST /internal/authz/resolve-layer`
   - Intended Service-Binding target; no public W02 auth route is introduced solely for this implementation.
   - Returns DENY/503 when authoritative resolution cannot be completed.

4. Persistence artifact
   - `workers/W02-content/migrations/0001_role_assignments.sql`
   - Generated from `contracts/entity/AUTHZ-role-assignment-authority.v1.json` by `scripts/generate-role-assignment-migration.mjs`.
   - Contains the ten contracted fields, required indexes, scope validity checks, temporal validity check and overlap protection for effective assignments.

5. W01 transport binding
   - `workers/W01-payload/wrangler.jsonc`
   - `W02_AUTH` → `luckread-w02`
   - Transport remains Cloudflare Service Binding over HTTP.

## Verification boundary

PASS — source files and binding configuration are present in repository source.

NOT VERIFIED — no claim is made here for:
- remote D1-01 migration execution;
- physical `role_assignments` table existence in Cloudflare;
- Worker deployment/version/source provenance;
- W01 Service Binding deployment;
- role_version mutation/invalidation runtime;
- authLogin/authRefresh end-to-end execution;
- security/concurrency runtime evidence;
- Mapping 0 GREEN promotion.

No remote D1 mutation was performed by this evidence record.
