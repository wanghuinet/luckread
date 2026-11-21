# CC-MAPPING-0-AUTH-013-D1-JSON-PARSER-CORRECTION-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_TOOLING_CORRECTION`

## Trigger

AUTH-013 public HTTP E2E run `36497771528` failed before public HTTP assertion.
The generated fixture identities were distinct, but the workflow reported
`fixture collision: email_collision`.

## Finding

The current Wrangler D1 remote `--json` query result is an array whose first
element contains a `results` array. The workflow parser only handled a legacy
nested shape. When the parser found no row, it defaulted to an empty object and
reported the first check as a collision.

## Authorized change

Change only the AUTH-013 evidence workflow parsing so it accepts the current
array-shaped result and remains compatible with the prior nested shape.

Files:
- `.github/workflows/auth-013-public-http-e2e.yml`
- `docs/MAPPING-0-CLOSURE-LEDGER.md`
- this Change Control record

## Non-changes

No AUTH-013 runtime implementation, public API contract, D1 schema, Payload
version, Worker/D1 topology, session authority, or Evidence Registry state is changed.

## Evidence boundary

Runs `36497771528` attempts 1 and 2 remain historical failed attempts. No
behavior evidence is admitted from either attempt.

## Backup

`backup/pre-auth013-d1-json-shape-20260929`

## Next gate

Run the existing AUTH-013 public HTTP E2E workflow again with:
- tested commit: `7104cc3d4e29ef62f1ae59d9ed5fcca770a12f0e`
- deployment run: `36455540585`
- database: `luckread`
- public W01 URL: `https://luckread-w01-payload.wanghui-79b.workers.dev`
- confirmation: `RUN_AUTH013_E2E`
