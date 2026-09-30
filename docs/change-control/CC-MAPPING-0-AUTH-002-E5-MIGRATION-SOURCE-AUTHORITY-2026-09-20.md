# Change Control — AUTH-002 E5 Migration Source Authority Gap

- ID: CC-MAPPING-0-AUTH-002-E5-MIGRATION-SOURCE-AUTHORITY-2026-09-20
- Date: 2026-09-20
- Status: OPEN — AUTHORITY DECISION REQUIRED
- Source audit: `artifacts/mapping-0/auth-002-e5-migration-source-authority-audit-2026-09-20.json`

## Finding

The AUTH-002 migration manifest contracts `MIG-AUTH-002-SESSION-V1` and the `auth_session_state` extension schema, but the current W01 source tree contains only the committed Payload baseline migration `20250929_111647.ts`.

The existing Payload-generated artifact reviewed under `CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20` is a full schema snapshot that recreates existing Payload tables. It is therefore not an admissible additive migration source.

Current migration controls explicitly reject hand-authored DDL and prohibit introducing a duplicate Session authority merely to obtain generated SQL.

## Acceptance boundary

This Change Control does not change the AUTH-002 contract, does not modify D1, and does not authorize remote migration execution.

E4.5 is already closed separately as `PASS`.

E5 remains blocked until an explicit, deterministic generation path is admitted that:

1. produces only the contracted `auth_session_state` extension;
2. preserves native Payload `users.sessions[]` as the sole native session identity authority;
3. does not recreate existing Payload tables;
4. does not introduce a second business/session authority;
5. does not rely on hand-authored DDL;
6. remains reviewable by the existing migration admission/static-audit controls.

## Current state

`E4.5 = PASS_VERIFIED`

`E5 = WAIT_AUTHORITY_DECISION`

`AUTH-002 = NOT_GREEN`

`Mapping-0 = NOT_GREEN`

## Anti-loop

Reuse this Change Control and its audit until one of the following changes:

- the W01 migration source;
- the AUTH-002 migration manifest/contracts;
- an explicitly admitted deterministic migration-generation mechanism.

Do not rediscover this gap as a new Mapping-0 blocker and do not bypass it by adding duplicate persistence.
