# AUTH-002 — Gate-1 Controlled Remote D1 Execution Runbook v1.0

## Purpose

Run the already-contracted AUTH-002 Gate-1 evidence workflow against one explicitly selected controlled remote D1 database. This runbook does not authorize migrations or runtime implementation.

## Preconditions

1. The target D1 database is a controlled evidence environment.
2. The GitHub repository contains the AUTH-002 Session Schema Evidence workflow on the commit being tested.
3. Repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured with sufficient read access for D1 metadata, migration status, and read-only SQL execution.
4. The operator knows the exact D1 database name and does not infer it from historical documentation.

## Execution

Use GitHub Actions → `AUTH-002 Session Schema Evidence` → `Run workflow`.

Set:

- `environment_class = CONTROLLED_REMOTE_D1`
- `database_name = <actual controlled D1 database name>`

The workflow is capture-only. It must not run `d1 migrations apply`, `d1 execute` with INSERT/UPDATE/DELETE/DDL, or any other mutating command.

## Required artifact package

The workflow must produce:

- `d1-info.json`
- `migration-status.json`
- `catalog.json`
- `users-schema.json`
- `users-indexes.json`
- `users-foreign-keys.json`
- `provenance.json`
- `manifest.json`

## Acceptance

Gate-1 may become `GATE1_PASS` only when the validator succeeds and the artifact proves all of the following:

- controlled remote environment;
- exact database identity;
- exact tested source commit;
- Payload and D1 adapter both exactly `3.87.1` in package and lockfile;
- successful read-only migration status query;
- physical `users` table exists in the remote SQLite catalog;
- users table/index/foreign-key structural evidence is present;
- all evidence file hashes match the manifest;
- no prohibited authentication secrets or production user records are present.

## Non-promotion rule

Gate-1 PASS does not prove native Payload `sessions[]` runtime semantics, login/logout lifecycle correlation, refresh semantics, or extension persistence. It does not authorize creation or application of `auth_session_state`.

## Failure handling

Any missing secret, invalid database name, query failure, validator rejection, provenance mismatch, dependency mismatch, hash mismatch, or sensitive-data detection leaves Gate-1 `NOT_EVALUATED_UNTIL_EXECUTED` or `REJECTED` and blocks promotion.

## Post-execution review order

1. Confirm workflow run ID and attempt.
2. Confirm `provenance.json` matches repository/workflow/commit.
3. Confirm `manifest.json` dependency and database identity.
4. Review `d1-info.json` and `migration-status.json`.
5. Review `catalog.json` for the physical `users` table.
6. Review `users-schema.json`, `users-indexes.json`, and `users-foreign-keys.json`.
7. Confirm validator result is `AUTH-002_SCHEMA_EVIDENCE_VALIDATION_PASS`.
8. Only then decide whether Gate-1 can be promoted.

## Current status

`NOT_EXECUTED`

No repository document or historical configuration may be treated as a substitute for the actual controlled D1 execution artifact.
