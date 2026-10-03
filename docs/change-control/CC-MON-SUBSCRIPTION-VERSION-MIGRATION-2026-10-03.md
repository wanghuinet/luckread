# Change Control: Subscription Version D1-01 Migration — 2026-10-03

- Change Control ID: `CC-MON-SUBSCRIPTION-VERSION-MIGRATION-2026-10-03`
- Status: `MIGRATION-ADMITTED / REMOTE-EXECUTION-PENDING`
- Baseline: `main` @ `32bbde19db6ec071efd780b915255a1d7f59549d`
- Migration Contract: `contracts/migration/SUBSCRIPTION-version-migration.v1.json`
- Migration: `workers/W07-subscription-commerce/migrations/0002_subscription_version.sql`
- SHA-256: `ce1673415eec33c110e01bff201394ae0ed7ac73970ec840379fdaf24590ad8a`

## Scope

Add the authoritative `ENT-SUBSCRIPTION-F-VERSION` column to D1-01 `membership_subscriptions` without rewriting the existing `0001_membership_subscriptions.sql` migration.

## Guard

Remote execution is fail-closed for non-empty Subscription data.

The migration will only proceed when controlled preflight proves:

- the D1-01 UUID is `2f80471e-3756-49f9-8db1-7707a433ad64`;
- `membership_subscriptions` is absent or has zero rows;
- `version` is not already present.

A non-empty target requires a separate authoritative version-history/backfill decision and must not be assigned version `1` automatically.

## Resulting schema

The logical Subscription persistence contract requires 14 columns, with:

- `version INTEGER NOT NULL DEFAULT 1`;
- `version >= 1`;
- no new unique constraint;
- no physical cross-D1 foreign key.

## Execution

The repository provides a manual workflow:

`.github/workflows/w07-subscription-version-migration.yml`

It requires an exact source SHA and explicit `APPLY_W07_SUBSCRIPTION_MIGRATION` confirmation before remote D1 mutation.

## Non-actions

- no Payload Core changes;
- no Worker/D1 topology expansion;
- no active-subscription uniqueness decision;
- no claim of remote execution or GREEN before post-migration evidence.
