# Change Control — AUTH-002 E4.5 D1 Adapter Regression

- ID: CC-MAPPING-0-AUTH-002-E4-5-D1-ADAPTER-REGRESSION-2026-09-20
- Date: 2026-09-20
- Status: BLOCKED — VERIFIED REGRESSION
- Scope: AUTH-002 / W01 / Payload 3.87.1 / @payloadcms/db-d1-sqlite 3.87.1
- Evidence Run: 35509055040
- Evidence Job: 106073661985
- Tested Commit: 3c1ed995477be05340f3941be9eaf14c10681948

## Observed Result

The controlled remote D1 E4.5 probe executed the Payload database adapter operation:

`payload.db.upsert("payload-preferences")`

against `CONTROLLED_REMOTE_D1`.

Observed:

- `upsertReturnedDocument = false`
- `upsertError = null`
- `storedRowPresent = false`
- `storedValueMatches = false`
- `persistedAfterUpsert = false`
- `cleanedUp = true`
- `adapterUpsertAliasesUpdateOne = true`

The probe used a synthetic test key/user and recorded no credential material.

## Determination

E4.5 is **not passed**.

The evidence establishes an installed-runtime persistence regression for the tested `upsert` path. The failure is not classified as a Cloudflare access failure, remote-binding failure, migration failure, or evidence-capture failure.

The installed W01 adapter package is therefore not yet admitted as satisfying the required upsert persistence semantics.

## Governance Constraints

No workaround is admitted by this change control.

Do not:

- modify Payload core;
- add a parallel persistence authority;
- create a second preferences/session table;
- hand-author DDL to bypass the adapter;
- silently replace `upsert` semantics in W01;
- promote E4.5, AUTH-002, ENT-SESSION, or Mapping-0 based on this failed run.

Any remediation must proceed through:

`GAP -> Change Control -> approved implementation/reconciliation -> regression re-test -> Evidence Registry -> promotion`

## Next Required Work

1. Identify the authoritative remediation boundary for the W01 D1 adapter defect.
2. Prefer an upstream/package-level correction or formally approved adapter-layer correction; Payload core changes require separate approval.
3. Re-run the exact controlled E4.5 probe after remediation.
4. Only a new PASS evidence package may release the E4.5 gate.

## Current State

`E4.5 = BLOCKED`

`AUTH-002 = NOT_GREEN`

`Mapping-0 = NOT_GREEN`
