# Change Control — 1.0 Media Owner Migration / Runtime Evidence — 2026-10-04

Status: CONTROLLED-EXECUTION-REQUIRED / RUNTIME-EVIDENCE-PENDING

## Trigger

Controlled Media Runtime E2E run 37184812539 tested source c297c41e72ee3fcc8a5a9cf628760c54c9b5266e against deployment run 37184361846.
The deployment provenance check passed, but the runtime E2E failed at synthetic media upload with HTTP 400.
Independent cleanup verification then proved the deployed D1 schema did not contain media.owner_user_id.

## Root Cause

The repository contained workers/W01-payload/src/migrations/20261002_120000_media_owner.ts but workers/W01-payload/src/migrations/index.ts did not register that migration.
Therefore the controlled W01/W02 application deployment, which intentionally performs database_mutation=false, deployed Media code that depended on a column not yet present in the remote D1.
The E2E fixture also omitted the required Media alt multipart field. Both are test/release-path defects; no Media authorization business rule is being changed.

## Decision

1. Register 20261002_120000_media_owner at the end of the canonical Payload migration index.
2. Add a dedicated controlled remote migration workflow.
3. The migration workflow must require explicit workflow_dispatch confirmation, checkout an exact source commit, verify the target migration is registered exactly once, verify the remote migration history matches the five admitted predecessors exactly, fail closed if owner_user_id already exists, fail closed when existing Media rows exist because this migration has no authoritative ownership backfill path, execute pnpm exec payload migrate with PAYLOAD_MIGRATION_REMOTE=true, and prove the migration record plus media.owner_user_id after execution.
4. Fix the Media Runtime E2E fixture to send the required alt field.

## Scope

- no new Worker;
- no new D1;
- no R2 topology change;
- no Payload core modification;
- no public Media cache;
- no production GREEN claim.

## Evidence

- failing runtime run: 37184812539
- controlled application deployment: 37184361846
- source commit tested: c297c41e72ee3fcc8a5a9cf628760c54c9b5266e
- remote failure: no such column: owner_user_id
- target migration source: workers/W01-payload/src/migrations/20261002_120000_media_owner.ts
- corrected migration registry: workers/W01-payload/src/migrations/index.ts
- controlled migration workflow: .github/workflows/w01-media-owner-migration-execution.yml
- corrected runtime E2E workflow: .github/workflows/media-runtime-e2e.yml

## Gate

This change is not a production GREEN claim. After the code/CI gate passes, the controlled Media owner migration must execute successfully before Media Runtime E2E can be rerun.
