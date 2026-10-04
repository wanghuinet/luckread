# Change Control — W01 /users/me Anonymous Fast Path — 2026-10-04

Status: IMPLEMENTATION_SLICE / AWAITING CI EVIDENCE

## Baseline
- authoritative main: `3e112938fa03184255bcf3f7e12bacfdd03eaff4`
- backup: `backup/2026-10-04-pre-auth-me-anon-fastpath`
- working branch: `superpowers/auth-me-anon-fastpath`

## Gap
Public pages may probe `GET /api/v1/users/me` without credentials. The existing route performs Payload initialization and authentication before returning the expected 401, creating avoidable origin work.

## Decision
- Keep the existing public-read rate limit as the first gate.
- Before Payload initialization, inspect the canonical Payload credential parser.
- If neither a Bearer credential nor `payload-token` cookie exists, return the existing 401 response immediately.
- Requests with credentials continue through the existing Payload `auth()` + session validation path unchanged.

## Non-goals
- No authentication semantic change for credentialed requests.
- No cookie format change.
- No new Worker/D1/queue/binding.
- No cache of authenticated self-profile data.
- No Mapping 0 promotion.

## Acceptance
- Credential-free GET/PATCH returns 401 without calling Payload.
- Credentialed requests still invoke the existing authentication path.
- Existing auth-me import/build checks remain compatible.
