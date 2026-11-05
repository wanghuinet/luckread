# CC-MAPPING-0-AUTH-013-PUBLICATION-JOURNAL-MIGRATION-EXECUTION-RECONCILIATION-2026-09-24

## Status

`REMOTE_MIGRATION_APPLIED / SCHEMA_AND_INDEX_VERIFIED / LEDGER_CONTENT_REVIEW_PENDING`

## Scope

Reconcile the stale `remoteExecution.mutation = NOT_EXECUTED` value in
`contracts/migration/AUTH-013-publication-journal.v1.json` against the original
controlled remote D1-01 workflow execution.

This is an evidence reconciliation only. No migration is re-run and no D1 data
is mutated by this change.

## Controlled remote execution

- Workflow: [AUTH-013 D1-01 Publication Journal Migration](https://github.com/wanghuinet/luckread/actions/runs/36000833449)
- Run: `36000833449`
- Job: `107636785364`
- Result: `success`
- Executed: `2026-09-24T12:43:09Z`
- Exact checked-out source SHA: `202244cd2a67d54733fe0ddd6518a8b4a41a7251`
- Worker: `luckread-w02`
- Binding: `D1_01`
- D1 database: `luckread`
- D1 UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`

The job log records the checkout of the exact source SHA and a successful
W02 D1-01 binding check against the database name and UUID above.

## Execution results

1. Preflight ran `PRAGMA table_info("auth_013_publication_journal")` and passed
   the fail-closed absence check. The table did not exist before the migration.
2. Wrangler applied `0003_auth_013_publication_journal.sql` remotely; the CLI
   reported the migration as applied successfully.
3. The post-migration read-back step queried the journal schema and indexes.
   Its executable assertions passed:
   - all 13 required columns were present;
   - `journal_id` was a NOT NULL primary key;
   - `event_id` was NOT NULL;
   - `source_version` was a required INTEGER;
   - `attempt` defaulted to `1`;
   - required index
     `auth_013_publication_journal_status_next_attempt_idx` existed.
4. The workflow also captured `SELECT * FROM d1_migrations ORDER BY id` into
   `d1-migrations.json`.

## Source identity across the W02 directory rename

At the execution SHA, the migration path was:

`workers/W02-content/migrations/0003_auth_013_publication_journal.sql`

The current path is:

`workers/W02-identity/migrations/0003_auth_013_publication_journal.sql`

Both paths resolve to the identical Git blob:

`ff903644db255ada37e1948226085f76a595e63c`

Therefore the W02 directory rename did not change the applied SQL migration.
The current W02 D1_01 binding still names database `luckread` with UUID
`2f80471e-3756-49f9-8db1-7707a433ad64`.

## Static migration verification

- Workflow: [AUTH-013 Journal Migration Static Verification](https://github.com/wanghuinet/luckread/actions/runs/36000971085)
- Run: `36000971085`
- Job: `107637237470`
- Source SHA: `202244cd2a67d54733fe0ddd6518a8b4a41a7251`
- Result: `PASS`

This independently confirms that the contract and SQL migration source passed
the SQLite static migration audit at the same exact source commit.

## Artifact retention boundary

The remote migration workflow uploaded:

- Artifact ID: `10807623109`
- Name: `auth-013-journal-migration-36000833449`
- ZIP SHA-256: `3d161d99dc741d07cf8f2b9eb69edeefc2aaea3f93a7d1bfd229c8391e579284`
- Retention configured by the workflow: 14 days
- Files included: preflight schema, post-migration schema, post-migration indexes,
  D1 migration ledger capture, and provenance.

The artifact is no longer available through the run's artifact listing. Although
the job log proves the artifact upload completed and records its digest, this
reconciliation does not claim independent review of the expired
`d1-migrations.json` contents.

## Contract disposition

Correct only the factual remote execution field from `NOT_EXECUTED` to
`APPLIED`, recording the exact run, source SHA, target D1 UUID, migration blob,
post-schema/index result and artifact provenance.

Keep the top-level contract status `CONTRACTED_NOT_VERIFIED` and
`promotion = NOT_GREEN`. The ledger file's contents were not independently
reviewed in this reconciliation, and this migration result does not prove
feature-wide lifecycle, publication delivery, W06 consumption, audit delivery,
or cache/deindex/feed/search convergence.

## Non-changes

- No remote D1 query or mutation was executed in this reconciliation.
- No migration was re-applied.
- No Worker, D1, Queue, binding, or table was added.
- W02 remains the authoritative writer.
- The publication journal remains a durable publication boundary, not a second
  Account State authority.
- AUTH-013, R4, Evidence Registry and Five-Way remain fail-closed / NOT_GREEN.
