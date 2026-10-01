# Change Control: SOCIAL-003 Like Runtime — 2026-10-01

- Status: BOUNDED_IMPLEMENTATION / NOT_GREEN
- Owner: W05 / T11 / D1-02
- Scope: authoritative Like/Unlike relation only

## Controls

The runtime is internal-only and accepts only W01 trusted transport. Actor identity comes from the trusted principal header. Resource-policy, account-state, block/mute and anti-abuse decisions are trusted inputs and missing/denied values fail closed.

The relation uses one D1-02 table with a unique actor/resource constraint. Like uses atomic insert-or-ignore; Unlike uses atomic delete; counters remain derived projections.

## Explicitly excluded

No new Worker, D1, synchronous fan-out, counter authority, moderation authority or Evidence Registry promotion is introduced.

## Gate

Like/Unlike unit/runtime implementation may be exercised through trusted fixtures, but public success and feature GREEN require remote security/concurrency E2E plus Evidence Registry provenance.
