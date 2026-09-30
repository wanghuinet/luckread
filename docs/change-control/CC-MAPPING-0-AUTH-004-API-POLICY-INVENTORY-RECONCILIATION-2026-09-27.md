# Change Control: AUTH-004 API Policy / Inventory Reconciliation — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-API-POLICY-INVENTORY-RECONCILIATION-2026-09-27`
- Status: `RECONCILED / NOT_GREEN`
- Feature: `AUTH-004`
- Base commit: `1c050aea12789135f3f43fe4ac8df29d2d1b1cff`
- Backup: `backup/pre-auth004-openapi-dto-admission-20260927`

## Reconciliation

The AUTH-004 canonical routes admitted in OpenAPI are now registered in the canonical OpenAPI operation-policy registry and the public API inventory:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

The existing Auth Operation Policy entries are completed with the required retry and queue declarations demanded by API Inventory Reconciliation. Reset-request delivery remains asynchronous; password change/reset confirm do not enqueue a recovery delivery task.

## Explicit boundary

This is contract/inventory reconciliation only.

It does not:
- add runtime endpoints;
- add W02 recovery logic;
- add migrations or tables;
- assert persistence/runtime/security evidence;
- change Evidence Registry status;
- promote AUTH-004 or Mapping 0 to GREEN.

## Result

The AUTH-004 OpenAPI → operation-policy → API Inventory membership gap is reconciled. The next verification is the existing Contract CI / API Inventory Reconciliation run at the resulting commit.
