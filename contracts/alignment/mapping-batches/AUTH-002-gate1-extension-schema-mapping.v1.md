# AUTH-002 Gate-1 Extension Schema Mapping v1.0

Status: MAPPING_CLOSED / EXECUTION_PENDING

## Source of truth

- `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
- `contracts/persistence/AUTH-002-gate1-extension-schema-evidence-contract.v1.json`

## Mapping

| Contract fact | Evidence artifact | Validation |
|---|---|---|
| `auth_session_state` physical table exists | `catalog.json` | table row exists |
| `session_id TEXT NOT NULL PRIMARY KEY` | `auth-session-state-schema.json` | exact column/type/nullability/PK |
| `user_id TEXT NOT NULL` | schema artifact | exact column/type/nullability |
| `device_id TEXT NOT NULL` | schema artifact | exact column/type/nullability |
| `token_version INTEGER NOT NULL` | schema artifact | exact column/type/nullability |
| `refresh_credential_hash TEXT NOT NULL` | schema artifact | exact column/type/nullability |
| `revoked_at TEXT NULL` | schema artifact | exact column/type/nullability |
| `last_seen_at TEXT NULL` | schema artifact | exact column/type/nullability |
| required indexes | `auth-session-state-indexes.json` | all named indexes present |
| `session_id` uniqueness | schema/catalog/index evidence | primary-key uniqueness present |
| forbidden secret columns absent | schema/catalog artifacts | zero matches |
| native session relationship remains logical | foreign-key artifact + contract | no FK to embedded session element |

## Closure rules

1. Missing evidence artifact blocks mapping closure.
2. Any schema mismatch blocks mapping closure.
3. Any forbidden secret column blocks mapping closure.
4. A second Session identity blocks mapping closure.
5. Passing Gate-1 extension schema evidence does not promote `AUTH-002`.
6. Runtime correlation, migration execution, security/E2E, concurrency/E2E, and Evidence Registry binding remain separate gates.

## Current result

`MAPPING_CLOSED / EXECUTION_PENDING`
