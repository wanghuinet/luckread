# CC-MAPPING-0-AUTH-003-FOREIGN-KEY-EVIDENCE-GATE-2026-09-27

Status: **GATE CORRECTION ADMITTED / NOT GREEN**

## Problem

The controlled AUTH-003 migration run `36296831559` completed the admitted remote DDL and captured post-migration evidence, but its final validation failed on the global `PRAGMA foreign_key_check;` assertion.

The AUTH-003 migration adds the child table `auth_credentials`, whose declared foreign key is `auth_credentials.identity_id -> auth_identities.id`. A global SQLite `PRAGMA foreign_key_check;` evaluates foreign-key violations across the database, not only the newly admitted AUTH-003 relationship. Therefore a pre-existing violation elsewhere in D1-01 can make this migration evidence gate fail without demonstrating an AUTH-003 regression.

## Admitted gate correction

For AUTH-003 evidence, retain the global foreign-key snapshot as contextual evidence, but gate AUTH-003 integrity on:

```sql
PRAGMA foreign_key_check(auth_credentials);
```

SQLite defines the table-argument form to check only the foreign-key constraints created by REFERENCES clauses in that table. Cloudflare D1 documents the same pragma and table-scoped behavior.

## Scope

- Change only evidence-validation workflow logic.
- No remote DDL/DML.
- Do not re-execute `MIG-AUTH-003-CREDENTIAL-V1`.
- Do not alter the admitted AUTH-003 schema design.
- Do not promote ENT-IDENTITY or ENT-CREDENTIAL.
- Do not mark AUTH-003 or Mapping 0 GREEN.

## Required follow-up

1. Update `.github/workflows/w02-auth-003-migration-evidence.yml` to capture and validate the AUTH-003 child-table-scoped foreign-key check.
2. Update `.github/workflows/w02-remote-d1-readonly-evidence.yml` with the same evidence rule.
3. Run the read-only post-migration workflow against source SHA `52c6868f99ae2ec9aeb8bdceb4a18396cde20435`.
4. Admit the resulting physical schema evidence only after the scoped check is clean and the migration ledger/provenance remain consistent.

Source execution evidence: workflow run `36296831559`, job `108557122475`.
