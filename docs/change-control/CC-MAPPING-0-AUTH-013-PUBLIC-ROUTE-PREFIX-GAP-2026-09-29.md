# CC-MAPPING-0-AUTH-013-PUBLIC-ROUTE-PREFIX-GAP-2026-09-29

## Status

`APPROVED_FOR_FOCUSED_RUNTIME_CORRECTION`

## Evidence trigger

Run `36498199164` reached the real public HTTP probe after successful fixture
preflight, seed, and generated user-ID resolution, then failed when
`POST /v1/users/20/account-state` returned non-JSON.

## Root cause

The exact deployment source built by run `36455540585` exposes the existing
handler as `/users/[userId]/account-state`. The canonical AUTH-013 Contract
requires `/v1/users/{userId}/account-state`. No `/v1` route prefix is present
in the deployed Next App Route inventory.

## Authorized correction

Expose the already-existing AUTH-013 POST handler at the contracted `/v1` path
by adding a thin route re-export under `src/app/v1/users/[userId]/account-state/route.ts`.
The original `/users/[userId]/account-state` handler remains the single business
implementation; no duplicate authorization or state-transition logic is added.

## Non-changes

- No Contract/OpenAPI path change.
- No D1 schema or migration change.
- No Payload version change.
- No Worker, Service Binding, Queue, or D1 topology change.
- No new authorization engine or alternate session authority.
- No Evidence Registry promotion.

## Backup

`backup/pre-auth013-v1-route-alias-20260929`

## Evidence boundary

Run `36498199164` is historical failed runtime evidence. It proves only that
fixture setup and the public transport invocation were reached; it does not
prove AUTH-013 business behavior.

## Next gate

Deploy current `main` with the focused route correction through the existing
W01/W02 binding deployment workflow, then rerun the existing AUTH-013 public
HTTP E2E workflow against that newly deployed exact source.
