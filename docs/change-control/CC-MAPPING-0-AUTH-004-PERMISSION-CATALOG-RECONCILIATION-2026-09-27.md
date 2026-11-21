# Change Control: AUTH-004 Permission Catalog Reconciliation — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-PERMISSION-CATALOG-RECONCILIATION-2026-09-27`
- Status: `RECONCILED / NOT_GREEN`
- Feature: `AUTH-004`
- Base commit: `143514b1d20394fc949db3a482015f2655ba8b84`
- Backup: `backup/pre-auth004-permission-catalog-reconcile-20260927`

## Finding

Contract CI identified one AUTH-004 semantic blocker: `authPasswordChange` referenced `user.credential.manage`, while the canonical permission catalog did not yet contain that permission.

## Controlled change

Add the already-contracted permission to `contracts/authz/permissions.json`:

- resource: `credential`
- action: `manage`
- minimum layer: `L1`
- scope: `own`
- audit required: `true`

No AUTH-004 operation ID, route, wire field, status code, or authorization boundary is changed.

## Non-actions

No runtime code, Payload configuration, D1 schema, migration, recovery subsystem, or evidence status is changed by this control.
