# AUTH-002 — Payload/D1 Native Session Schema Evidence Capture Contract v1.0

**Status: `CONTRACTED_NOT_EXECUTED`**

## 1. Purpose

Define the exact, repeatable evidence procedure required before AUTH-002 may author or apply any session persistence migration.

This contract records procedure, not schema facts. It MUST NOT be treated as evidence that a schema exists or that a migration has executed.

## 2. Pinned implementation baseline

The evidence run MUST use the repository lockfile and the pinned Payload versions:

- `payload = 3.87.1`
- `@payloadcms/db-d1-sqlite = 3.87.1`
- Node 24

The run MUST execute against the same dependency resolution used by CI.

## 3. Preconditions

All of the following MUST be true before a schema evidence run:

1. `package-lock.json` is committed and `npm ci` succeeds.
2. `src/payload.config.ts` resolves `sqliteD1Adapter` and `migrationDir` without modifying production configuration.
3. A real D1 binding or a controlled D1-compatible test database is available to the evidence runner.
4. The target database is explicitly identified as an evidence environment.
5. No production migration is implicitly applied by the evidence probe.

If any precondition fails, the result is `BLOCKED`, not `GREEN`.

## 4. Required evidence sequence

### Step A — Dependency identity

Capture:

- `node --version`
- `npm --version`
- resolved Payload package version
- resolved D1 adapter version
- lockfile integrity reference

### Step B — Migration inventory

Run the repository's Payload migration status command and capture:

- migration directory path
- migration filenames
- migration execution status
- currently applied migration version(s)

### Step C — Native Users schema

Against the controlled target database, inspect SQLite/D1 catalog metadata and capture:

- `users` table definition
- every `users` column
- SQL type
- nullability
- default
- primary-key status
- indexes
- unique constraints
- foreign keys
- migration metadata table(s)

No secrets or user credential values may be captured.

### Step D — Native session representation

Create a disposable test user/session through Payload's actual authentication runtime.

Capture only structural evidence sufficient to prove how `users.sessions[]` is physically represented, including:

- whether sessions are embedded JSON/text, normalized child rows, relation rows, or another representation;
- physical table/column(s) carrying session data;
- serialized shape if applicable, with IDs and credential material redacted;
- actual `sid`, `createdAt`, and `expiresAt` field locations.

The disposable account and session MUST be removed or isolated from production data after the run.

### Step E — Runtime lifecycle correlation

For the same disposable session, correlate:

`login -> native sid creation -> validation -> logout -> native session removal/revocation`

Capture deterministic assertions, not raw credentials/tokens.

### Step F — Exported evidence artifact

Produce a machine-readable artifact under:

`artifacts/evidence/auth-002/`

Required files:

- `dependency.json`
- `migration-status.json`
- `users-schema.json`
- `session-representation.json`
- `runtime-lifecycle.json`
- `manifest.json`

The manifest MUST include the tested commit SHA, environment class, dependency versions, execution timestamp, and hashes of the evidence files.

## 5. Redaction rules

The evidence package MUST NOT contain:

- passwords
- raw access tokens
- raw refresh tokens
- refresh credential hashes
- session cookies
- authentication headers
- API secrets
- Cloudflare account credentials
- production user records

Where an example value is required, use deterministic placeholders.

## 6. Evidence acceptance

Schema evidence is accepted only when all of the following are independently present:

- the actual database catalog was queried;
- the query target is identified;
- the tested dependency versions are pinned;
- the captured schema corresponds to the same code commit;
- the session representation is correlated to an actual Payload login session;
- the evidence files are reproducibly generated;
- no redaction violation is detected.

A source-code assertion such as `auth: true`, generated types, documentation, or a remembered Payload schema is insufficient.

## 7. AUTH-002 migration consequence

Only after this evidence contract is executed may the project finalize the physical shape of:

`auth_session_state`

The extension migration MUST then be reconciled against the captured native schema. The extension MUST NOT duplicate native `id`, `createdAt`, or `expiresAt` storage.

## 8. Fail-closed rules

The evidence run MUST fail closed when:

- the target database cannot be identified;
- the target database is not reachable;
- migration state cannot be observed;
- native session representation cannot be correlated to a real session;
- evidence contains secret material;
- dependency versions differ from the pinned baseline;
- schema output is synthesized rather than queried;
- the result cannot be tied to a commit SHA.

## 9. Current state

```text
Contract procedure      = CLOSED
Execution               = NOT_EXECUTED
Actual D1 schema        = NOT_VERIFIED
Native session shape    = NOT_VERIFIED
Migration               = NOT_AUTHORED
AUTH-002                = BLOCKED_NOT_GREEN
```
