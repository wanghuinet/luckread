# B11 — Payload 3.87.1 + D1 Migration Workflow Closure v1.0

**Status: CLOSED — workflow verified; schema evidence still BLOCKED**

## 1. Purpose

Close the Mapping 0 gate for the official Payload migration workflow before any concrete D1 schema is authored or claimed as verified.

This batch establishes the authoritative workflow only. It does **not** invent tables, columns, migration files, migration execution results, or production database state.

## 2. Current repository facts

- `package.json` declares `payload` and `@payloadcms/db-d1-sqlite` at `3.87.1`.
- The repository already exposes the `payload` CLI through `"payload": "payload"`.
- `src/payload.config.ts` uses `sqliteD1Adapter`, binds `cloudflare.env.D1`, sets `push: false`, and explicitly sets `migrationDir` to `src/migrations`.
- The current `src` directory listing does not contain a `migrations` directory.
- Therefore the repository currently has the migration configuration contract, but no repository evidence proving that a generated migration exists or has been executed.

## 3. Official workflow verified

Payload's current migration documentation establishes:

1. `migrationDir` controls where migrations are stored/read.
2. `migrate:create` creates a migration from the current schema changes.
3. `migrate` executes migrations that have not yet run.
4. `migrate:status` reports migration execution state.
5. SQLite/D1 inherits the SQLite migration controls.
6. Payload's SQLite documentation states that `push: false` can be used to rely solely on migrations rather than development `db push`.

For this repository, the configured CLI therefore maps to:

- `npm run payload migrate:create <name>` — generate migration
- `npm run payload migrate` — execute pending migrations
- `npm run payload migrate:status` — verify execution state

These commands are workflow evidence, not execution evidence. A command appearing in documentation does not prove that it has been run successfully in this repository.

## 4. Required Mapping 0 evidence

The persistence gate remains closed until all of the following are present in repository/CI evidence:

### 4.1 Migration artifact

- migration file exists under the configured `src/migrations` directory;
- migration has stable timestamp/name/version;
- migration contains generated SQL/schema changes appropriate to the authoritative Payload schema;
- migration has an executable `up` path and a valid rollback/down path where supported by the adapter.

### 4.2 Schema reconciliation

For every canonical entity field:

`Entity ID → Field ID → Payload field → physical table → physical column → SQL type → nullability → uniqueness → index → lifecycle`

No canonical field may remain unmapped.

### 4.3 Execution evidence

- migration execution command/result;
- migration status showing the migration as executed;
- CI evidence for the same migration path where production admission requires CI validation.

### 4.4 Authority evidence

- exactly one authoritative persistence owner for every admitted entity;
- no undocumented duplicate table/column that can become an alternate source of truth;
- no inferred schema accepted as evidence.

## 5. Fail-closed rules

The following are explicitly **not sufficient** evidence:

- `sqliteD1Adapter(...)` configuration alone;
- `migrationDir` configuration alone;
- existence of a Payload collection alone;
- generated TypeScript types alone;
- a migration command documented in `package.json` alone;
- historical migration files from an earlier commit that are not present on current `main`;
- a claimed D1 dashboard state without repository/CI evidence;
- a manually guessed table or column name.

## 6. Current gate result

**B11 workflow gate: GREEN.**

**B11 persistence/schema evidence gate: RED/BLOCKED.**

The workflow is now fixed and no longer an architectural unknown. The next batch must produce and verify the real migration/schema evidence rather than further describing the workflow.

## 7. Next batch — B12

B12 will reconcile the first authoritative persisted entity, `ENT-USER`, field by field against the actual Payload-generated migration/schema evidence.

B12 may only mark a field verified when the concrete physical table/column and migration evidence are available. No table/column names will be invented before that evidence exists.

## 8. Source references

- Payload SQLite/D1 database documentation: https://payloadcms.com/docs/database/sqlite
- Payload migrations documentation: https://payloadcms.com/docs/database/migrations
- Repository `src/payload.config.ts`
- Repository `package.json`
