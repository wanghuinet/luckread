# B11 — W01 Payload Cloudflare D1 Migration Workflow Closure v1.1

**Status: CLOSED — workflow verified; schema evidence still BLOCKED**

## 1. Purpose

Close the Mapping 0 workflow definition for the official Payload Cloudflare D1 runtime before any concrete D1 schema is authored or claimed as verified.

This batch establishes the authoritative workflow only. It does **not** invent tables, columns, migration files, migration execution results, or production database state.

## 2. Current W01 authority

The current runtime authority is `workers/W01-payload/`, sourced from the official Payload `templates/with-cloudflare-d1` template.

Current W01 package baseline (current lock; `3.82.1` remains the historical upstream template observation):

- `payload = 3.87.1`
- `@payloadcms/db-d1-sqlite = 3.87.1`
- migration directory: `workers/W01-payload/src/migrations`
- `push: false`

The repository root Payload scaffold is not the W01 Cloudflare runtime authority. Historical upstream 3.82.1 material MUST NOT be used as current W01 runtime evidence.

## 3. Official workflow mapping

Payload's migration workflow establishes:

1. `migrationDir` controls where migrations are stored/read.
2. `migrate:create` creates a migration from current schema changes.
3. `migrate` executes pending migrations.
4. `migrate:status` reports migration execution state.
5. SQLite/D1 uses the SQLite migration controls.

For W01, commands MUST be executed from the W01 worker context rather than the historical root scaffold:

- `pnpm --dir workers/W01-payload run payload -- migrate:create <name>` — generate migration
- `pnpm --dir workers/W01-payload run payload -- migrate` — execute pending migrations
- `pnpm --dir workers/W01-payload run payload -- migrate:status` — verify execution state

These commands are workflow evidence, not execution evidence. A command appearing in documentation does not prove that it has been run successfully in this repository.

## 4. Required Mapping 0 evidence

The persistence gate remains closed until all of the following are present in repository/CI evidence:

### 4.1 Migration artifact

- migration file exists under `workers/W01-payload/src/migrations`;
- migration has stable timestamp/name/version;
- migration contains generated SQL/schema changes appropriate to the authoritative W01 Payload schema;
- migration has an executable `up` path and a valid rollback/down path where supported by the adapter.

### 4.2 Schema reconciliation

For every canonical entity field:

`Entity ID → Field ID → Payload field → physical table → physical column → SQL type → nullability → uniqueness → index → lifecycle`

No canonical field may remain unmapped.

### 4.3 Execution evidence

- W01 migration execution command/result;
- W01 migration status showing the migration as executed;
- CI evidence for the same migration path where production admission requires CI validation;
- exact tested commit SHA and dependency identity.

### 4.4 Authority evidence

- exactly one authoritative persistence owner for every admitted entity;
- no undocumented duplicate table/column that can become an alternate source of truth;
- no inferred schema accepted as evidence;
- no historical root Payload scaffold substituted for W01.

## 5. Fail-closed rules

The following are explicitly **not** sufficient evidence:

- `sqliteD1Adapter(...)` configuration alone;
- `migrationDir` configuration alone;
- existence of a Payload collection alone;
- generated TypeScript types alone;
- a migration command documented in `package.json` alone;
- historical migration files from an earlier commit;
- a claimed D1 dashboard state without repository/CI evidence;
- a manually guessed table or column name;
- historical upstream 3.82.1 package metadata as proof of W01 runtime behavior.

## 6. Current gate result

**B11 workflow gate: GREEN.**

**B11 persistence/schema evidence gate: RED/BLOCKED.**

The workflow is fixed. The next work is evidence acquisition, not further workflow invention.

## 7. Next evidence batch

The next batch MUST acquire, in order:

1. W01 dependency identity / lockfile evidence;
2. W01 build evidence;
3. generated artifact evidence;
4. controlled D1 schema evidence;
5. D1 adapter regression evidence, including the `upsert` behavior observed on the upstream 3.82.1 family, tested against the installed 3.87.1 runtime;
6. migration execution/status evidence;
7. native session runtime evidence;
8. Mapping 0 reconciliation and GREEN decision.

No evidence result may be claimed before the corresponding command has actually executed and produced a traceable artifact.

## 8. Source references

- Official Payload Cloudflare D1 template
- W01 `workers/W01-payload/`
- W01 migration directory `workers/W01-payload/src/migrations`
- W01 package baseline manifest
