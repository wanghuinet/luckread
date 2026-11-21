# W01 PostgreSQL migrations

This directory is deliberately separate from `src/migrations`.

- `src/migrations` is the existing Payload D1/SQLite migration history and must never be run by a PostgreSQL adapter.
- This directory contains migrations generated with Payload 3.90.2's official `@payloadcms/db-postgres` adapter from `src/neon-postgres-schema.config.ts`.
- The generation workflow applies the files only to a disposable PostgreSQL 18 CI service, then verifies the resulting catalog.
- Review generated `up` and `down` code before admitting it. Do not use this config with a remote database.
