# AUTH-013 Runtime Source Implementation Admission — 2026-09-24

- Decision ID: CC-MAPPING-0-AUTH-013-RUNTIME-SOURCE-IMPLEMENTATION-ADMISSION-2026-09-24
- Feature: AUTH-013
- Scope: W02 authoritative account-state transition kernel only
- Repository authority: GitHub main
- Worker authority: W02
- Persistence authority: D1-01 / users

## Admission basis

The following prerequisites are now evidence-backed and inherited without re-execution:

1. Controlled remote D1-01 migration Run 35937873769 succeeded against commit b40ae46fe5862c77f935a54adf4bd7e91c69159a.
2. Preflight proved users_count=0 and no target lifecycle columns before mutation.
3. Post-schema verification proved users.account_state is TEXT NOT NULL DEFAULT PENDING_VERIFICATION and users.account_state_version is INTEGER NOT NULL DEFAULT 1.
4. d1_migrations records 0002_auth_013_account_state.sql as applied.
5. The canonical operation remains transitionAccountState, with the existing DTOs, If-Match optimistic-lock requirement, account state machine, W02 authority and D1-01 target already admitted by prior Change Control.

## Authorized source slice

Implementation is authorized for a non-transport W02 source kernel that:

- loads the authoritative User account state/version from D1-01;
- validates only transitions declared by contracts/state-machines/account.json;
- enforces actor and required permission semantics declared by that state machine;
- enforces required approval/precondition inputs fail-closed;
- performs an atomic state + version compare-and-update;
- increments account_state_version exactly once on success;
- rejects stale expected versions without mutation.

## Explicitly not admitted by this decision

- public W01 route wiring;
- direct W01 account-state writes;
- Payload Users collection mutation;
- invented audit/event/session/cache persistence tables;
- claims that the complete side-effect chain is GREEN;
- Evidence Registry promotion for AUTH-013 as a whole.

Audit/event, token/session, cache, projection/deindex and controlled runtime integration remain separate closure gates and must be wired only against their existing authoritative contracts.

## Status

SOURCE_IMPLEMENTATION_AUTHORIZED / AUTH-013_NOT_GREEN
CONTRACTS_UNCHANGED
MAPPING-0_REMAINING_GATES_OPEN