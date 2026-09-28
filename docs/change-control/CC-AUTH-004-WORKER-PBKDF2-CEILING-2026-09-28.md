# Change Control — AUTH-004 Worker PBKDF2 Platform Ceiling

- ID: CC-AUTH-004-WORKER-PBKDF2-CEILING-2026-09-28
- Status: IMPLEMENTATION_ADMITTED / EVIDENCE_PENDING
- Scope: W01 Payload native authentication compatibility only

## GAP

The deployed W01 Worker runtime returned HTTP 503 for `POST /auth/register`. Controlled runtime-tail evidence recorded:

- `AUTH001_NATIVE_VALIDATION_FAILURE`
- `errorName: NotSupportedError`

The underlying Payload 3.90.2 native local-auth path calls Node `crypto.pbkdf2` with its current 600000-iteration password-hash setting. Cloudflare Workers production rejects a single PBKDF2 call above 100000 iterations. The failure therefore occurs before Payload reaches the normal database persistence seam.

## Decision

Use a W01-only runtime compatibility shim at the Payload configuration boundary:

- keep Payload 3.90.2;
- keep Payload's native local strategy, native sessions, native password-change/reset lifecycle, and native token handling;
- clamp only Worker-runtime `crypto.pbkdf2` calls above 100000 iterations to 100000;
- keep Payload's existing hash prefix/verification pipeline so registration and subsequent native login/change/reset use the same effective derivation;
- do not add a custom auth service, session table, token store, Worker, D1, queue, or Payload source fork.

## Security / portability note

This is a platform-constrained password-KDF parameter. It reduces the effective PBKDF2 work factor from Payload's upstream 600000 to the Workers production ceiling of 100000 for W01. The change is deliberately isolated to the Worker runtime and must remain explicit in governance evidence. When the platform ceiling changes or Payload provides a first-class Worker-compatible setting, this shim should be removed through normal Change Control.

## Non-goals

- no Payload package downgrade;
- no custom password format;
- no custom authentication/session lifecycle;
- no database migration;
- no topology change.

## Admission gate

Do not mark AUTH-004 GREEN until a fresh deployed W01 Remote E2E proves registration, login, password change/session invalidation, reset-token lifecycle, replay rejection, expired-token rejection, and controlled cleanup.
