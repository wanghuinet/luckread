# Migration Admission and Evidence Contract v1.0

## Status
NOT_GREEN — admission contract is established, but no migration artifact or remote D1 execution evidence is claimed.

## Scope
This contract governs Payload schema migrations for Luckread. It does not replace Payload's migration system and does not infer Cloudflare runtime state from source configuration.

## Canonical lifecycle
1. Schema/collection change is approved by the relevant contract.
2. Payload generates a migration under `src/migrations`.
3. The migration is reviewed and committed to Git.
4. Deployment executes only committed migrations.
5. `migrate:status` verifies applied state.
6. Persistence evidence independently verifies the authoritative D1 state.
7. Entity evidence may be promoted only after the persistence evidence is recorded.

## Fail-closed rules
- Missing `src/migrations` is a blocker when migration admission is required.
- Missing migration artifacts are a blocker.
- `push` cannot be used as production migration evidence.
- A local configuration reference such as `cloudflare.env.D1` is not proof of a live D1 binding.
- A successful build is not migration execution evidence.
- No Entity Catalog record may be promoted to VERIFIED from contract-only evidence.

## CI boundary
Pull-request CI validates migration structure and repository configuration. Real D1 execution belongs to an explicitly configured deployment environment and must produce independently inspectable evidence.

## Current blockers
- No current `src/migrations` artifact is verified.
- No current remote D1 migration execution evidence is verified.
- No current migration status evidence is verified.
- No current persistence verification is verified.
