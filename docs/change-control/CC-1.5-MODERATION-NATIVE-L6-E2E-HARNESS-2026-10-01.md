# Change Control — Moderation Native L6 E2E Harness — 2026-10-01

## Purpose
Record the reusable native-auth fixture harness prepared for the admitted Moderation Security E2E path.

## Current state
- Main head: `16d25ce6653b074f7d08bf5aa1e474f664fc51e5`
- Runtime source under test remains `81986b7510efb20a5dd44f9971ca40794989ddff`
- New harness: `scripts/moderation-native-reviewer-fixture.mjs`
- Harness flow: Payload-native `/auth/register` → controlled D1 account activation → canonical `moderator` global role assignment → Payload-native `/auth/login` → real L6 access JWT.
- Secret material is not written to the evidence artifact; the temporary access token is masked before being exported to the workflow environment.
- Harness uses the existing W01 D1-01 and existing role-assignment table; no Worker/D1/binding/topology expansion.

## Important boundary
The existing `.github/workflows/moderation-runtime-e2e.yml` is **not yet wired to this harness**. It still requires repository secret `MODERATION_E2E_BEARER_TOKEN` and its current runs fail at `Verify E2E secret`.

The connected GitHub write path rejected the workflow wiring change during this continuation. No claim is made that the harness has executed remotely.

## Evidence status
- Security E2E remains `BLOCKED_EXTERNAL`.
- No Security E2E PASS is promoted.
- No decision/audit/outbox/W03 convergence evidence is promoted from the harness file alone.
- Moderation Runtime remains NOT GREEN.

## Backup
`backup/pre-moderation-native-auth-e2e-20261001`

## Next admissible change
Wire the existing workflow to use the harness as current evidence tooling, with controlled fixture cleanup and immutable AuditEvent retention. Then run the unchanged admitted runtime source and reconcile only actual remote evidence.
