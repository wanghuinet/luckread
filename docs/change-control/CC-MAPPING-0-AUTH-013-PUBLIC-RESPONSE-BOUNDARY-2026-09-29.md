# CC-MAPPING-0-AUTH-013-PUBLIC-RESPONSE-BOUNDARY-2026-09-29

## Status

`APPROVED_FOR_RUNTIME_CONTRACT_ALIGNMENT`

## Evidence trigger

Run `36501207751` used the exact main source deployed by run `36500905624` and passed deployment provenance, Payload baseline, isolated fixture preflight/seed, generated user-ID resolution, and the prior authentication/authorization assertions.

The run reached the authorized operator transition and failed at the public 200 response-shape assertion.

## Findings

The canonical public AUTH-013 response is the existing `from + to + auditEventId` body.

W02's internal transition result also contains internal coordination fields `accountStateVersion` and `journalId`. The W01 public route was directly serializing the internal result, causing those internal fields to cross the public API boundary.

This is an implementation-to-Contract response-boundary mismatch. The Contract is not changed.

## Authorized correction

W01 now explicitly maps the W02 internal result to the already-contracted public response:

- `from`
- `to`
- `auditEventId`

No internal W02 business result semantics are changed.

## Non-changes

- No AUTH-013 Contract/OpenAPI change.
- No W02 account-state transition logic change.
- No D1 schema/migration change.
- No Payload version change.
- No Worker/Service Binding/Queue/D1 topology change.
- No authorization rule change.
- No Evidence Registry promotion from failed run `36501207751`.

## Backup

`backup/pre-auth013-public-response-boundary-20260929`

## Required next gate

Deploy the exact corrected main source through the existing W01/W02 binding workflow and execute a fresh AUTH-013 public HTTP E2E with exact deployment provenance.

AUTH-013 and Mapping 0 remain `NOT_GREEN` until the full evidence chain succeeds.
