# CC-MAPPING-0-AUTH-001-REGISTRATION-MIGRATION-EXECUTION-2026-09-28

- Status: GREEN — DEV CONTROLLED EXECUTION ADMITTED / PRODUCTION BLOCKED
- Base main at change start: `bd2791a4ca799126fac16afbc0506070e9074a77`
- Backup branch: `backup/pre-auth001-registration-migration-execution-gate-20260928`
- Work branch: `governance/auth001-registration-migration-execution-gate-20260928`

## Purpose

Authorize one controlled remote D1 execution of the already-committed W01 Payload migration that materializes the physical persistence required by the admitted AUTH-001 registration writer:

- `auth_registration_envelopes`;
- `consents`.

This control does not add a migration, change the AUTH-001 contract, or authorize production deployment. It closes the execution gate required to obtain same-schema remote evidence for the already-admitted development/integration slice.

## Authoritative inputs

- `docs/change-control/CC-MAPPING-0-AUTH-001-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-27.md`
  - development/integration implementation is admissible;
  - physical collections require migration evidence;
  - production remains blocked.
- `contracts/persistence/AUTH-001-registration-envelope-contract.v1.json`
- admitted PRIV-002 concrete consent persistence contract and decision record;
- `workers/W01-payload/src/migrations/20260928_020000_MIG_AUTH_001_REGISTRATION_BATCH_V1.ts`
- `workers/W01-payload/src/migrations/index.ts`

## Observed remote gap

Controlled remote materializer evidence run `36377880967` against D1-01/`luckread` reached the ephemeral W02 runtime but failed before the materializer assertions because the target D1 did not contain `auth_registration_envelopes`.

Observed diagnostic:

```text
D1_ERROR: no such table: auth_registration_envelopes: SQLITE_ERROR
```

Therefore the failure is classified as a remote schema prerequisite gap, not as evidence of incorrect W02 materializer behavior.

The existing Payload migration file is present on the tested source and is registered exactly once. No temporary table creation is admitted in the evidence harness.

## Authorized execution scope

Only the existing migration `20260928_020000_MIG_AUTH_001_REGISTRATION_BATCH_V1` may be newly applied.

The execution workflow MUST:

1. check out one exact source SHA;
2. verify the migration blob and migration index against that SHA;
3. verify the target is the last executable Payload migration in that source, so `payload migrate` cannot silently apply a later unrelated migration;
4. preflight D1-01 migration history and require every predecessor migration to be already applied, with the AUTH-001 migration absent;
5. preflight the target tables/indexes are absent;
6. require explicit manual confirmation `APPLY_AUTH001_REGISTRATION_MIGRATION`;
7. execute `pnpm exec payload migrate`;
8. verify the target migration is recorded exactly once;
9. verify the exact contracted tables/indexes exist;
10. verify the existing `users` schema and user count are unchanged by the migration;
11. write immutable run provenance and post-migration evidence.

No application data fixture is required or created by this migration execution.

## Boundaries

This execution does not:

- deploy W01 or W02;
- mutate Identity/Credential rows;
- add a Worker, Queue, D1 database, or binding;
- alter Payload Core;
- rewrite any existing migration;
- rerun previously PASS_VERIFIED runtime evidence;
- promote AUTH-001 to GREEN;
- promote ENT-IDENTITY or ENT-CREDENTIAL;
- promote Mapping 0;
- authorize production deployment or production legal/compliance operation.

The target D1 remains D1-01/`luckread`. The workflow is a controlled remote execution gate, not a product deployment path.

## Promotion after execution

Successful migration execution only changes the physical-schema gate from missing/unverified to evidence-backed for the exact migration.

The next gate remains the AUTH-001 W02 materializer remote runtime evidence. The existing failed run `36377880967` must not be reclassified as PASS; a successful rerun against the now-correct D1 schema is required.

Only after the materializer runtime assertions pass may the exact run be admitted into the Evidence Registry.

## Production boundary

This admission is development/integration-only. Production deployment and production Evidence Registry promotion remain blocked by the production policy/consent authority gates in the existing AUTH-001 runtime admission.
