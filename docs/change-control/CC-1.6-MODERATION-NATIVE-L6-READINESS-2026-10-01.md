# Change Control — Moderation Native L6 Readiness — 2026-10-01

## Purpose
Establish a bounded, non-GREEN readiness gate for the admitted Moderation runtime by proving that the existing native authentication chain can obtain an L6 moderator principal and authorize the existing W06 moderation queue endpoint.

## Scope
- Existing production URLs only: `api.luckread.cn` for authentication and `luckread.cn` for Moderation HTTP.
- Existing D1-01 `luckread` only for synthetic reviewer lifecycle.
- Existing `role_assignments` with canonical `moderator` role.
- Existing W01/W02 authentication and W06 moderation queue route.
- No new Worker, D1, Queue, binding, public domain, Contract entity, or moderation operation.

## Tooling
- Probe: `scripts/moderation-native-l6-readiness.mjs`
- Workflow: `.github/workflows/moderation-native-l6-readiness.yml`
- Workflow defaults:
  - `base_url=https://luckread.cn`
  - `confirm=RUN_MODERATION_L6_READY`

## Assertions
1. Payload-native `/auth/register` succeeds for a synthetic reviewer.
2. Existing D1 account state is activated through controlled evidence setup.
3. Canonical `moderator` role is assigned globally.
4. Payload-native `/auth/login` returns layer `L6`.
5. Real L6 access JWT authorizes `/api/v1/admin/moderation/queue`.
6. Synthetic reviewer records are cleaned after the probe, including user, role, session state, native session, registration envelope and consents.
7. No secret material is emitted into an artifact.

## Promotion boundary
A successful readiness run proves only the authentication/authorization prerequisite. It does not prove moderation Case/Decision/Audit/Outbox/W03 convergence and does not promote Moderation Runtime GREEN.

## Backup
`backup/pre-moderation-native-e2e-workflow-20261001`


## 2026-10-01 — Run 36800162350 diagnostic correction

- Readiness Run `36800162350` reached the real `POST https://api.luckread.cn/auth/register` call.
- The response was HTTP 400 with canonical error `IDEMPOTENCY_KEY_REQUIRED` / `Idempotency-Key is required`.
- Root cause was in the readiness probe itself: its `post()` helper sent only `content-type` and the register invocation did not pass the already-generated `registerKey` as the `Idempotency-Key` request header.
- This is confirmed by the existing W01 registration route, which returns this exact 400 only when that header is absent, and by the already-verified AUTH-010 remote E2E helper, which sends the same header.
- Corrective commit: `e02eaf21ecbc0f6a093af78d2a514bf5f61dcb53`.
- The correction is limited to evidence tooling; no production Worker, D1 schema, Contract, route semantics, or topology was changed.
- Backup before correction: `backup/pre-moderation-l6-header-fix-20261001`.
- Status remains `NOT_GREEN` until the corrected workflow is actually executed and produces runtime evidence.


## 2026-10-01 — Run 36800515287 fixture SQL root cause and correction

- Run `36800515287` tested main head `5f4d2488b95f2d2f7512489399885703e82be710`.
- Payload-native registration succeeded, and the response supplied synthetic user id `55`; failure occurred while the fixture assigned the canonical `moderator` role in D1-01.
- The emitted INSERT incorrectly serialized JavaScript `null` through the generic SQL quoting helper, producing `scope_id='null'` and `valid_until='null'`.
- Remote D1 rejected the row with its existing contract check: global scope requires `scope_id IS NULL` (Cloudflare D1 SQLITE constraint code 7500).
- Cross-check against the generated role-assignment migration and existing AUTH-010 fixture confirms the canonical form is SQL `NULL`, not the string `'null'`.
- Corrective commit: `a36774fe416327b21b16aaa48e9098c32533f2c8`; only `scripts/moderation-native-l6-readiness.mjs` changed.
- Backup before correction: `backup/pre-moderation-l6-null-scope-fix-20261001`.
- No production Worker, D1 schema, Contract, route behavior, or topology was changed.
- The run did not reach login or W06 queue authorization, so L6 readiness remains `NOT_GREEN` pending execution of the corrected probe.
