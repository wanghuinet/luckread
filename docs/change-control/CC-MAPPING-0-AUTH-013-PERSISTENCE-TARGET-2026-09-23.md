# AUTH-013 Persistence Target Decision — 2026-09-23

- Feature: `AUTH-013`
- Status: `CONTRACTED_TARGET / VERIFICATION_PENDING`
- Worker authority: W02
- Persistence domain: D1-01
- Entity: ENT-USER
- Migration Contract: `MIG-AUTH-013-ACCOUNT-STATE-V1`

## Target admitted

The actual controlled D1-01 schema evidence from workflow run `35657959095` observed the existing physical table `users`. Its captured columns were the Payload-native user columns and did not include `account_state` or `account_state_version`.

The persistence contract therefore admits the **existing physical table `users` as the target User persistence artifact** and defines these target columns:

| Canonical Field | Target physical column | Final type | Final nullability |
|---|---|---|---|
| `ENT-USER-F-ACCOUNT-STATE` | `users.account_state` | TEXT | NOT NULL |
| `ENT-USER-F-ACCOUNT-STATE-VERSION` | `users.account_state_version` | INTEGER | NOT NULL |

These are target migration columns, not claims that they already exist remotely.

## Explicit unresolved decision

The existing D1-01 `users` table already contains rows. The canonical Account State Machine does not specify a backfill rule for converting those pre-existing rows into an initial `account_state` and `account_state_version`.

Therefore this record does **not** auto-select:
- an initial `account_state` for existing users;
- an initial `account_state_version`.

No migration execution is authorized until those two backfill semantics are explicitly admitted.

## Non-decisions

This record does not:
- mutate the remote D1 database;
- modify W01 Payload `Users.ts`;
- implement W02 runtime;
- promote AUTH-013 to GREEN;
- promote E6 Runtime-003;
- create a new D1 or Worker.

## Evidence boundary

The remote evidence proves the pre-migration physical state only. A later post-migration schema capture on the exact tested source commit is required before the target columns can be marked physically verified.
