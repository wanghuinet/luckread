# B09 — Migration / D1 Schema Evidence Reconciliation v1.0

Status: NOT_GREEN

## Scope

This batch verifies whether the repository currently contains sufficient **real evidence** to promote the first implemented entity (`ENT-USER`) from `persistenceStatus = NOT_VERIFIED` to `VERIFIED`.

The check is evidence-first and fail-closed. It does not create or infer a D1 table, column, migration identifier, migration execution result, or authority mapping merely because Payload is configured to use D1.

## Evidence inspected

### 1. Payload implementation

`workers/W01-payload/src/collections/Users.ts` is the active implementation reference for `ENT-USER` and establishes that the W01 Payload Users collection exists as code.

### 2. D1 adapter configuration

`workers/W01-payload/src/payload.config.ts` configures `@payloadcms/db-d1-sqlite`, binds the W01 D1 environment, sets `push: false`, and resolves `migrationDir` to `workers/W01-payload/src/migrations`.

This proves the intended adapter/migration configuration only. The W01 repository does contain a migration file, but file existence does **not** prove that it has been applied to the controlled D1 environment.

### 3. Migration path verification

Current `main` contains `workers/W01-payload/src/migrations/index.ts` and `workers/W01-payload/src/migrations/20250929_111647.ts`. The migration source contains concrete Payload `users` / `users_sessions` DDL. This is source-level evidence only; no remote execution or schema-state claim is made.

### 4. Persistence inventory

`contracts/alignment/database-entity-persistence-inventory.v1.json` still records:

- `ENT-USER.entityStatus = VERIFIED`
- `ENT-USER.persistenceStatus = NOT_VERIFIED`
- `ENT-USER.migrationRefs = []`

The inventory therefore remains correctly fail-closed because source-level migration presence does not establish target-D1 execution.

## Field-level reconciliation result

The canonical User fields currently represented by the Entity Field Contract cannot yet be reconciled to concrete D1 columns because the required table/migration evidence is absent.

The following evidence remains mandatory for every admitted canonical field:

- concrete D1 table name;
- concrete column name;
- SQL type;
- NULL / NOT NULL semantics;
- UNIQUE semantics where required;
- index evidence where required;
- migration identifier/version and path;
- migration application evidence for the target environment;
- authoritative ownership mapping;
- validator output showing complete field coverage and no extra authoritative fields.

No field is promoted to persistence `VERIFIED` in B09.

## Result

**B09 remains NOT_GREEN.**

No canonical persistence status was changed. No invented schema or migration evidence was added. Mapping 0 therefore remains blocked.

## Required next closure batch

The next evidence batch must validate the existing W01 migration/schema artifact against the current Users collection, then capture the exact controlled-D1 schema and migration execution evidence. Only after that evidence exists should the Entity Field Contract and persistence inventory be updated field-by-field.

After `ENT-USER` persistence is verified, the same evidence chain must be repeated for each entity that is actually promoted from `PROPOSED` to implemented.

## Gate invariant

`Payload adapter config → NOT schema evidence`  
`Payload collection code → NOT table/column evidence`  
`migrationDir config → NOT migration existence/execution evidence`

The canonical gate remains fail-closed until all required evidence is present.