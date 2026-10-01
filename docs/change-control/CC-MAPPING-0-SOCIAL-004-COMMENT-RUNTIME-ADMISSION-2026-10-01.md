# Change Control: SOCIAL-004 Comment Runtime Admission Inputs — 2026-10-01

**Status:** BOUNDED_ADMISSION_NOT_GREEN / IMPLEMENTATION_NOT_AUTHORIZED

## Decision

The existing authoritative dependencies are now explicitly bound as Comment runtime inputs:
- W02 / D1-01 remains the AccountState authority.
- W03 / D1-02 remains the Content lifecycle authority.
- Social Block/Mute policy remains governed by `contracts/api/block-mute.v1.json`.
- W06 / D1-03 remains the ModerationDecision authority.

This is an input contract only. It does not add a Worker, D1, transport, route, migration execution or runtime GREEN.

## Fail-closed rules

Comment runtime must reject or withhold the operation when required policy input is missing, stale, contradictory or unavailable. The client cannot provide authoritative author identity, account state, visibility decision, moderation decision or anti-abuse outcome.

## Remaining boundary

The repository has generic Block/Mute and Moderation contracts, but Comment-specific executable decision coverage is not yet verified. Therefore SOCIAL-004 runtime remains blocked pending those concrete policy inputs plus W05 runtime, negative/security/concurrency tests and remote evidence.
