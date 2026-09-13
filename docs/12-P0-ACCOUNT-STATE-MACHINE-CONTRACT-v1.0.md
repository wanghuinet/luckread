# LuckRead P0 Account State Machine Contract v1.0

**Status:** READY FOR IMPLEMENTATION
**Scope:** Account lifecycle and security state. Business-domain lifecycle states are defined by their own contracts.

## 1. Purpose

Account state is authoritative security state. Every protected API operation must evaluate the current account state before authorization.

## 2. States

Initial state vocabulary:

- `PENDING`
- `ACTIVE`
- `VERIFICATION_REQUIRED`
- `RESTRICTED`
- `SUSPENDED`
- `BANNED`
- `DELETION_PENDING`
- `DELETED`
- `RECOVERY`

A state is not merely descriptive. It determines which authentication, authorization and recovery operations are permitted.

## 3. Core transitions

```text
PENDING → ACTIVE
PENDING → VERIFICATION_REQUIRED
ACTIVE → RESTRICTED
ACTIVE → SUSPENDED
ACTIVE → BANNED
ACTIVE → DELETION_PENDING
RESTRICTED → ACTIVE
RESTRICTED → SUSPENDED
SUSPENDED → ACTIVE
SUSPENDED → BANNED
DELETION_PENDING → RECOVERY
DELETION_PENDING → DELETED
RECOVERY → ACTIVE
```

Forbidden transitions must fail closed. Domains may add states only through an explicit contract revision.

## 4. Transition authority

Each transition must define:

- source state;
- target state;
- actor/authority;
- reason or policy condition;
- audit requirement;
- whether reauthentication/MFA is required;
- whether the transition is reversible.

Client requests cannot directly set account state.

## 5. Security behavior

At minimum:

| State | Authentication | Protected read | Protected mutation | Recovery |
|---|---|---|---|---|
| PENDING | limited | limited | limited | yes |
| ACTIVE | yes | yes | yes | yes |
| VERIFICATION_REQUIRED | limited | limited | restricted | yes |
| RESTRICTED | yes | policy-limited | restricted | yes |
| SUSPENDED | limited | policy-limited | no | yes |
| BANNED | no/limited | no except policy/legal paths | no | policy-defined |
| DELETION_PENDING | yes | policy-limited | restricted | yes |
| DELETED | no | no except legally required paths | no | policy-defined |
| RECOVERY | recovery-only | limited | restricted | yes |

Exact endpoint behavior belongs to the API/auth contracts but must not contradict this table.

## 6. Versioning and concurrency

Account state changes must advance `account_state_version`.

Authorization decisions that depend on account state must verify the expected version where optimistic concurrency is used.

A stale state version must never silently grant protected access.

## 7. Suspension and ban invariants

- Suspension is not equivalent to deletion.
- Ban is not equivalent to ordinary suspension.
- Suspension/ban must invalidate or bypass stale authorization/session state according to the authentication contract.
- Cached authorization cannot override an authoritative restrictive state.
- Administrative state changes are auditable.

## 8. Deletion and recovery boundary

`DELETION_PENDING` begins the account deletion workflow but does not imply immediate physical deletion of every related record.

Retention, legal hold, audit, financial and security records follow the Data Lifecycle Contract.

Recovery must be explicit and must not resurrect an account after irreversible deletion without an approved policy path.

## 9. API boundary

The public API exposes stable account-state semantics but must not expose internal enforcement mechanisms.

Examples of protected operations that must evaluate account state:

- profile mutation;
- content creation/update/publish;
- social interactions;
- organization administration;
- IP control;
- financial operations;
- developer/app ownership operations.

## 10. Audit

State transitions that affect security, access or deletion must record:

- actor;
- previous state;
- new state;
- reason/policy reference;
- timestamp;
- request/correlation ID;
- resulting state version.

## 11. Acceptance criteria

1. States are explicit and machine-readable.
2. Forbidden transitions fail closed.
3. Clients cannot directly set account state.
4. Every state transition has an authority and audit requirement.
5. State changes advance `account_state_version`.
6. Stale state cannot grant protected access.
7. Suspension, ban and deletion have distinct semantics.
8. Deletion does not bypass retention/legal-hold requirements.
9. Recovery cannot silently resurrect an irreversibly deleted account.
10. Domain contracts cannot redefine account security state independently.
