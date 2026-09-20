# Change Control — AUTH-002 E4.5 W01 Adapter Boundary Correction

- ID: CC-MAPPING-0-AUTH-002-E4-5-D1-ADAPTER-CORRECTION-2026-09-20
- Date: 2026-09-20
- Status: EXECUTION ADMITTED — MINIMAL W01 ADAPTER BOUNDARY
- Preceding defect evidence: EVD-AUTH002-B11-D1-ADAPTER-E45-REMOTE-001
- Defect run: 35509055040
- Defect tested commit: 3c1ed995477be05340f3941be9eaf14c10681948

## Problem

The controlled E4.5 probe against Payload 3.87.1 + `@payloadcms/db-d1-sqlite` 3.87.1 demonstrated that:

`payload.db.upsert === payload.db.updateOne`

and an upsert for a missing `payload-preferences` row returned no document without error and persisted no row.

The defect is independently consistent with the observed adapter implementation and the publicly documented Payload issue #17202.

## Admitted remediation boundary

A minimal W01 configuration-level adapter boundary correction is admitted.

The correction MUST:

1. leave Payload core packages unchanged;
2. leave `@payloadcms/db-d1-sqlite` package source unchanged;
3. leave D1 schema and migration files unchanged;
4. preserve native Payload session identity and all existing contracts;
5. change only W01 runtime initialization behavior for the D1 adapter's `upsert` dispatch;
6. forward Payload `upsert` to the native `updateOne` implementation with `options.upsert = true`;
7. preserve fail-closed behavior and avoid any second persistence authority.

## Non-admitted changes

The following remain prohibited by this Change Control:

- modifying Payload core;
- forking/replacing the D1 adapter package;
- changing the canonical Contract;
- adding a duplicate preferences/session table;
- hand-authoring DDL;
- changing dependency pins solely to bypass the failed probe;
- declaring E4.5 or AUTH-002 verified before a new controlled remote regression PASS.

## Acceptance

A remediation commit is accepted only when the exact controlled E4.5 workflow:

- resolves W01 Payload 3.87.1 and D1 adapter 3.87.1;
- establishes a remote connection to the controlled D1;
- performs the same missing-row upsert;
- reads the inserted row back with matching value;
- removes the synthetic probe row;
- produces traceable evidence tied to the tested commit.

Then and only then may E4.5 advance from BLOCKED to PASS.

## Current state

`E4.5 = BLOCKED / REMEDIATION ADMITTED`

`AUTH-002 = NOT_GREEN`

`Mapping-0 = NOT_GREEN`
