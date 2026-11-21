# B08 — Persistence Evidence Gate v1.0

Status: NOT_GREEN

## Purpose

This batch closes the evidence-gate definition for Entity → Field → Payload → D1 persistence without inventing database tables, columns, migration identifiers, or execution results.

## Current verified facts

1. The declared active W01 implementation source is `workers/W01-payload/src/collections/Users.ts`.
2. `workers/W01-payload/src/payload.config.ts` configures `@payloadcms/db-d1-sqlite`, binds the W01 D1 environment, sets `push: false`, and points `migrationDir` to `workers/W01-payload/src/migrations`.
3. The canonical persistence inventory still records `ENT-USER.persistenceStatus = NOT_VERIFIED` and has no migration references.
4. No current repository evidence was found that proves the concrete D1 table/column mapping or migration execution for `ENT-USER`.

## Mandatory closure evidence

The following must all exist before `ENT-USER` persistence can become VERIFIED:

- Concrete generated/maintained migration file reference.
- Migration identifier/version and repository path.
- Concrete table name for the Payload Users collection.
- Concrete column mapping for every canonical field in `entity-field-contract.v1.json`.
- SQL type, nullability, uniqueness and index evidence where applicable.
- Migration application/execution evidence for the target D1 environment.
- Authority mapping connecting the persistence record back to `ENT-USER` and its field IDs.
- Validator evidence proving no unmapped canonical fields and no extra authoritative fields.

## Fail-closed rule

Configuration of a D1 adapter is not sufficient evidence of a deployed schema. A Payload collection is not sufficient evidence of a concrete D1 table/column mapping. A migration directory configuration is not evidence that a migration exists or has executed.

Therefore this batch MUST NOT promote any persistence record to GREEN by inference.

## Downstream dependency

Until this gate closes, Mapping 0 cannot be GREEN and implementation of the base/domain workers remains blocked by Contract-First policy.

## Next batch

After real migration/schema evidence is present, reconcile `ENT-USER` field-by-field. Then repeat the same process for each entity that is promoted from PROPOSED to implemented. Only after persistence reconciliation should API/DTO mapping be promoted toward GREEN.
