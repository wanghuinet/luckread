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
