# CC-MAPPING-0-AUTH-013-W04-SIDE-EFFECT-UNIT-COVERAGE-2026-09-29

## Status

`IMPLEMENTATION_ALLOWED / REMOTE_EVIDENCE_PENDING`

## Scope

Add focused unit coverage for the already-admitted W04 AUTH-013 derived projection reducer. This is a test-only slice supporting the active `AUTH-013-LIFECYCLE-SIDE-EFFECT-COVERAGE-001` gate.

The tests will cover:

- all contracted deindex states;
- visible/reactivation states;
- duplicate same-version delivery;
- older-version non-regression;
- projection version tracking;
- bounded stale metadata;
- projection records containing no authorization-decision fields.

## Non-changes

- No Worker, D1, Queue, KV, Service Binding, route, Contract, DTO, or Payload change.
- No production deployment.
- No remote evidence is claimed or promoted.
- Existing admitted W04 runtime source and live binding remain unchanged.

## Evidence boundary

Unit-test PASS is implementation/test evidence only. The controlled remote side-effect matrix workflow remains the required runtime gate and must be manually dispatched before Evidence Registry admission.

## Controls

Backup: `backup/pre-auth013-w04-side-effect-tests-20260929`
Working branch: `work/auth013-w04-side-effect-tests-20260929`
