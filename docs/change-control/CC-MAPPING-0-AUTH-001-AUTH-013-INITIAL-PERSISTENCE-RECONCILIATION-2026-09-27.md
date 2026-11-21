# CC-MAPPING-0-AUTH-001-AUTH-013-INITIAL-PERSISTENCE-RECONCILIATION-2026-09-27

## Status

`AUTH-013_INITIAL_PERSISTENCE_RECONCILED / AUTH-013_OVERALL_NOT_GREEN`

## Scope

Reconcile the AUTH-001 registration prerequisite for the first persisted account lifecycle state. This control does not close AUTH-013 as a whole and does not authorize new runtime code.

## Authoritative inputs

- AUTH-013 field admission: `docs/change-control/CC-MAPPING-0-AUTH-013-FIELD-ADMISSION-2026-09-23.md`
- AUTH-013 runtime source/persistence admission: `docs/change-control/CC-MAPPING-0-AUTH-013-RUNTIME-SOURCE-IMPLEMENTATION-ADMISSION-2026-09-24.md`
- AUTH-013 persistence/runtime evidence: `artifacts/mapping-0/auth-013-runtime-source-implementation-evidence-2026-09-24.md`
- D1-01 target: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`
- Migration: `workers/W02-content/migrations/0002_auth_013_account_state.sql`

## Evidence already present

The repository contains controlled evidence proving that the admitted AUTH-013 persistence migration was executed on D1-01 and that the resulting schema contains:

- `users.account_state` as `TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'`;
- `users.account_state_version` as `INTEGER NOT NULL DEFAULT 1`;
- the migration is recorded in `d1_migrations`;
- post-migration `users_count = 0` at the captured execution checkpoint.

The same evidence record links the W02 transition-kernel verification and the D1-01 persistence artifact:

- remote migration Run `35937873769`;
- source implementation verification Run `35943346415`;
- migration artifact `10784305258`.

These are existing verified inputs. This control does not request or authorize a rerun.

## Reconciliation

The AUTH-001 writer-boundary requirement for the **initial** persisted lifecycle state is now satisfied by the existing D1 schema authority:

1. W01 creates the Payload-native User through the already admitted Payload transaction boundary.
2. The existing D1-01 `users.account_state` column supplies the admitted default `PENDING_VERIFICATION` when a new User row is inserted without an explicit lifecycle value.
3. The existing D1-01 `users.account_state_version` column supplies the admitted default version `1`.
4. Therefore AUTH-001 does not require W01 to add a second lifecycle implementation or a new Payload collection field solely to persist the initial state.
5. Subsequent lifecycle transitions remain owned by W02 / D1-01 under AUTH-013 and retain their separate side-effect/security/E2E closure gates.

This is a persistence-boundary reconciliation, not a claim that AUTH-013 is GREEN.

## Non-authorizations

This control does not:

- add `account_state` fields to `workers/W01-payload/src/collections/Users.ts`;
- modify the AUTH-013 migration;
- introduce a W01 lifecycle writer;
- change AUTH-013 state-machine semantics;
- promote AUTH-013 Evidence Registry status;
- promote Mapping 0 GREEN;
- authorize AUTH-001 runtime implementation.

## Result

The AUTH-013 **initial persistence dependency for AUTH-001 registration is reconciled from existing evidence**. The remaining AUTH-001 implementation blockers are now PRIV-002 consent persistence authority and the concrete registration-envelope schema/evidence, together with the normal runtime/security/evidence gates.

The existing AUTH-013 downstream lifecycle/runtime closure remains a separate feature cursor and must not be reopened or rerun merely because AUTH-001 consumes its already-proven initial persistence semantics.
