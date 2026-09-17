# AUTH-002 — Payload/D1 Native Session Schema Evidence Capture Contract v1.1

**Status: `CONTRACTED_NOT_EXECUTED`**

## 1. Purpose

Define the exact, repeatable evidence procedure required before AUTH-002 may author or apply any session persistence migration.

This contract records procedure, not schema facts. It MUST NOT be treated as evidence that a schema exists or that a migration has executed.

## 2. Authoritative runtime baseline

The evidence run MUST use the W01 Cloudflare runtime authority:

- worker: `workers/W01-payload`
- source template: official Payload `templates/with-cloudflare-d1`
- `payload = 3.87.1` (current W01 lock)
- `@payloadcms/db-d1-sqlite = 3.87.1`
- Node 24
- migration directory: `workers/W01-payload/src/migrations`

The ordinary Payload release line MUST NOT be substituted for the Cloudflare template baseline. The 3.82.1 family is the historical upstream template observation only and MUST NOT be treated as the current W01 runtime evidence.

The run MUST use the dependency lockfile once the W01 lockfile admission gate is satisfied and MUST identify the exact tested commit SHA.

## 3. Preconditions

All of the following MUST be true before a schema evidence run:

1. W01 dependency reproducibility is established and the committed lockfile/reference is captured.
2. `workers/W01-payload/src/payload.config.ts` resolves `sqliteD1Adapter` and `migrationDir` without modifying production configuration.
3. A real controlled D1 binding/database is available to the evidence runner.
4. The target database is explicitly identified as an evidence environment.
5. No production migration is implicitly applied by the evidence probe.
6. The tested commit SHA, worker path, Payload version, D1 adapter version, and environment class are recorded.

If any precondition fails, the result is `BLOCKED`, not `GREEN`.

## 4. Required evidence sequence

### Step A — Dependency identity

Capture:

- `node --version`
- package-manager version
- resolved Payload package version
- resolved D1 adapter version
- lockfile integrity/reference
- W01 package manifest hash
- tested commit SHA

### Step B — Migration inventory

Run the W01 Payload migration status command and capture:

- migration directory path
- migration filenames
- migration execution status
- currently applied migration version(s)

The command MUST execute against `workers/W01-payload`, not the historical root Payload scaffold.

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

Create a disposable test user/session through the actual W01 Payload authentication runtime.

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

The manifest MUST include the tested commit SHA, worker path, environment class, dependency versions, execution timestamp, and hashes of the evidence files.

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

- the actual D1 catalog was queried;
- the query target is identified;
- the tested W01 dependency versions are pinned;
- the captured schema corresponds to the same code commit;
- the session representation is correlated to an actual W01 Payload login session;
- the evidence files are reproducibly generated;
- no redaction violation is detected;
- the evidence does not rely on a historical 3.82.1 upstream template runtime assumption.

A source-code assertion such as `auth: true`, generated types, documentation, or a remembered Payload schema is insufficient.

## 7. AUTH-002 migration consequence

Only after this evidence contract is executed may the project finalize the physical shape of:

`auth_session_state`

The extension migration MUST then be reconciled against the captured native schema. The extension MUST NOT duplicate native `id`, `createdAt`, or `expiresAt` storage.

No migration SQL, physical table name, or native session representation may be invented before evidence is captured.

## 8. Fail-closed rules

The evidence run MUST fail closed when:

- the target database cannot be identified;
- the target database is not reachable;
- migration state cannot be observed;
- native session representation cannot be correlated to a real session;
- evidence contains secret material;
- dependency versions differ from the W01 pinned baseline;
- schema output is synthesized rather than queried;
- the result cannot be tied to a commit SHA;
- the evidence runner accidentally uses the historical root Payload scaffold instead of W01.

## 9. Current state

```text
Contract procedure      = CLOSED
Execution               = NOT_EXECUTED
Actual D1 schema        = NOT_VERIFIED
Native session shape    = NOT_VERIFIED
Migration               = NOT_AUTHORED
W01 runtime evidence   = NOT_VERIFIED
AUTH-002                = BLOCKED_NOT_GREEN
```
