# CC-MAPPING-0-AUTH-013-PUBLIC-RESPONSE-BOUNDARY-2026-09-29

## Status

`APPROVED_FOR_RUNTIME_CONTRACT_ALIGNMENT`

## Evidence trigger

Run `36501207751` used exact source `1fd92907b6e888a423cb74ca87e79cc1f0c37af4` deployed by run `36500905624`. Deployment provenance, Payload baseline, fixture preflight/seed, generated user-ID resolution, and the preceding authentication/authorization assertions passed.

The run reached the authorized operator transition and failed at the public 200 response-shape assertion.

## Findings

The canonical public AUTH-013 response is the existing `from + to + auditEventId` body.

W02's internal transition result also contains internal coordination fields `accountStateVersion` and `journalId`. The W01 public route was directly serializing the internal result, causing those internal fields to cross the public API boundary.

This is an implementation-to-Contract response-boundary mismatch. The Contract is not changed.

## Authorized correction

W01 explicitly projects the W02 internal result to the already-contracted public response:

- `from`
- `to`
- `auditEventId`

The W02 internal business result remains unchanged.

## Non-changes

- No AUTH-013 Contract/OpenAPI change.
- No W02 account-state transition logic change.
- No D1 schema/migration change.
- No Payload version change.
- No Worker/Service Binding/Queue/D1 topology change.
- No authorization rule change.
- No Evidence Registry promotion from failed run `36501207751`.

## Backup

`backup/pre-auth013-public-response-boundary-current-main-20260929`

## Parallel-head reconciliation

PR `#175` was merged into `main` after the source used by the failed run and added evidence-tooling isolation for the success and stale `If-Match` assertions. The present correction is rebased from current `main` so those valid changes are retained.

## Required next gate

Deploy the exact corrected main source through the existing W01/W02 binding workflow and execute a fresh AUTH-013 public HTTP E2E with exact deployment provenance.

AUTH-013 and Mapping 0 remain `NOT_GREEN` until the full evidence chain succeeds.
