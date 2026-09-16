# AUTH-002 — Native Session Runtime Evidence Execution Runbook v1

## Status

`CONTRACTED_NOT_EXECUTED`

## Authority

This runbook operationalizes `contracts/persistence/AUTH-002-runtime-session-evidence-gate.v1.json`.
It does not authorize production migration application or promote `AUTH-002` by itself.

## Preconditions

All preconditions below are mandatory and fail closed:

1. Gate-1 controlled remote D1 schema evidence is accepted for the same commit under test.
2. `payload` resolves to exactly `3.87.1`.
3. `@payloadcms/db-d1-sqlite` resolves to exactly `3.87.1`.
4. Node 24 is used, matching CI.
5. The runtime target is an explicitly named controlled evidence environment.
6. A disposable isolated test identity is used; no production account is permitted.
7. The evidence runner can invoke the real Payload authentication runtime against the controlled target.
8. No evidence command prints authorization headers, cookies, passwords, raw access tokens, raw refresh credentials, or credential hashes.

## Execution sequence

### Gate A — Identity and dependency lock

Capture the repository SHA, workflow/run identity, Node version, Payload version, D1 adapter version, and lockfile reference.

Reject the run if any value does not match the pinned baseline or the checked-out commit.

### Gate B — Login/session creation

Create one disposable user and perform one real Payload login.

Record only:

- deterministic `testId`;
- operation result;
- whether native `sid` was observed;
- whether the same user binding was observed;
- whether native `createdAt` and `expiresAt` were observed;
- explicit statement that credential material was redacted.

Never store the credential, cookie, JWT, refresh token, or hash in the evidence package.

### Gate C — Native validation

Using the same runtime-established session, prove:

- the native `sid` validates;
- the native sid resolves to the same user;
- a valid session can authorize;
- an expired native session is denied.

The evidence must identify expected and actual outcomes without recording the secret bearer material.

### Gate D — Logout lifecycle

Perform real native logout for the same sid.

Prove:

- logout invocation succeeds;
- the native session is removed or otherwise revoked according to the observed runtime behavior;
- a subsequent validation is denied;
- a second logout is idempotent.

A successful logout result is not sufficient if required durable canonical revocation state failed to persist.

### Gate E — Extension correlation

Where `auth_session_state` is present, prove that:

`auth_session_state.session_id == native Payload sid`

and that the extension table does not mint a second session identity.

Record unsupported canonical dimensions as presence/state assertions only. Never place `refreshCredentialHash` values into the evidence artifact.

### Gate F — Negative security suite

At minimum execute and record deterministic pass/fail results for:

- expired native session;
- post-logout native session;
- canonical revocation overriding stale native authorization state;
- wrong user binding;
- wrong device binding when configured;
- stale token version;
- missing required extension state;
- secret non-persistence/redaction.

### Gate G — Concurrency suite

Execute concurrent tests against the actual runtime boundary.

At minimum prove:

- concurrent refresh using one predecessor yields at most one successful successor;
- concurrent logout remains idempotent;
- concurrent validation never authorizes after revocation.

Record concurrency level and invariant result, not tokens or credential material.

### Gate H — Evidence package and validator

Write the eight required JSON artifacts to:

`artifacts/evidence/auth-002/runtime/`

Then execute:

`node scripts/auth-session-runtime-evidence-validate.mjs`

The validator MUST be run against the exact checked-out commit used for the runtime test.

## Required promotion conditions

Gate 2 is `ACCEPTED` only when:

- every required artifact exists;
- every artifact is bound to the exact tested commit;
- artifact hashes verify;
- native sid lifecycle is correlated across login, validation and logout;
- extension correlation uses the native sid as its only session identity;
- expiration and post-logout denial are proven;
- negative security evidence passes;
- concurrency evidence passes;
- no secret material is present;
- Gate-1 evidence is accepted for the same commit;
- Mapping-0 validation is subsequently executed and passes.

## Explicit non-actions

This runbook MUST NOT:

- create a second full `sessions` table;
- replace Payload native session identity;
- apply an unverified production migration;
- infer schema/runtime behavior from documentation alone;
- mark `AUTH-002` GREEN solely because the validator script exists;
- treat an empty evidence registry as a pass.

## Current closure state

```text
Gate-1 contract       = CLOSED
Gate-1 execution      = NOT VERIFIED
Gate-2 contract       = CLOSED
Gate-2 validator      = IMPLEMENTED
Gate-2 execution      = NOT EXECUTED
Migration             = NOT PROMOTED
Mapping-0             = NOT VERIFIED
AUTH-002              = BLOCKED_NOT_GREEN
```
