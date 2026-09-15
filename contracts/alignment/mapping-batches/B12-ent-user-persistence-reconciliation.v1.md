# B12 — ENT-USER Persistence Reconciliation v1.0

## Status
BLOCKED / NOT GREEN

## Purpose
Close the first concrete Entity → Field → Payload → D1 persistence reconciliation without inventing schema facts.

## Verified repository facts

1. `ENT-USER` is the only currently VERIFIED entity in the entity-field contract; its six canonical fields are `username`, `displayName`, `bio`, `avatar`, `locale`, and `timezone`.
2. All six fields currently carry `migrationVersion: PENDING_EVIDENCE`.
3. The Payload collection implementation is `src/collections/Users.ts`.
4. The Payload D1 adapter is configured with `push: false` and `migrationDir: ./migrations` in `src/payload.config.ts`.
5. The current `src` directory does not expose a `migrations` directory through the repository contents listing.
6. Repository search did not produce authoritative current-main evidence of a concrete `CREATE TABLE users` migration or field-by-field D1 column mapping.

## Mandatory evidence required to close B12

For every ENT-USER canonical field:

- migration file path
- migration identifier/version
- authoritative table name
- authoritative column name
- SQL/storage type
- NULL/NOT NULL
- DEFAULT, when applicable
- UNIQUE constraint, when applicable
- INDEX definition, when applicable
- Payload field mapping
- migration execution/status evidence
- validator evidence proving no missing canonical field
- validator evidence proving no unexpected authoritative field

## Special rule for Payload native auth fields

Payload-generated/native authentication persistence MUST be distinguished from extension fields. The mapping must identify which database columns are native Payload persistence and which are explicitly contract-owned extension fields. No duplicate authoritative field may be introduced merely to make the mapping appear complete.

## Fail-closed rules

- `Users.ts` alone is not D1 schema evidence.
- `migrationDir` configuration alone is not migration evidence.
- Package version alone is not migration evidence.
- Documentation describing a possible schema is not execution evidence.
- A generated migration that has not been verified against the actual repository state cannot be marked GREEN.
- Any unresolved table/column/type/nullability/constraint mapping blocks B12.

## Exit criteria

B12 becomes GREEN only when the repository contains authoritative migration evidence and the six ENT-USER fields reconcile exactly through:

`ENT-USER → Field → Payload field → Migration → D1 table/column → constraints → execution evidence → validator evidence`

Until then, Mapping 0 remains NOT GREEN and base implementation remains blocked.

## Next

B13 — expand persistence reconciliation across all admitted entities only after B12 has concrete evidence; do not fabricate proposed entities or schema.