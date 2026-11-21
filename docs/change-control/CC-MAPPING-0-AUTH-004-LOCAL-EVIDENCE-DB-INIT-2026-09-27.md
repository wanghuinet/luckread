# Change Control: AUTH-004 Local Evidence D1 Initialization — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-LOCAL-EVIDENCE-DB-INIT-2026-09-27`
- Status: `EVIDENCE-HARNESS-CORRECTION / NOT_GREEN`
- Base: `70c9a4cf62d129ab51d00c2d35d5fe788b5c4541`
- Backup: `backup/pre-auth004-local-evidence-db-init-20260927`

The first AUTH-004 Local Evidence run failed before exercising AUTH-004 because the Local API was pointed at an uninitialized local D1 database and failed with `no such table: users`.

This correction initializes the local Payload schema with the repository's existing Payload migration set before running the probe.

No runtime, remote D1, migration content, Payload Core, W02, or Evidence Registry admission is changed.
