# Change Control — Mapping 0 Evidence Status Drift / B07 Historical Evidence

- ID: CC-MAPPING-0-EVIDENCE-STATUS-DRIFT-2026-09-19
- Date: 2026-09-19
- Scope: Mapping 0 Evidence Registry status correction only; no runtime/schema/migration/business implementation
- Decision: Correct B05/B06/B07 historical local evidence status from VERIFIED to EXPIRED; preserve historical PASS results and provenance.

## B07 authority check

`artifacts/evidence/auth-002-local/runtime-manifest.json` is `LOCAL_MINIFLARE_D1`, captured 2026-09-17, and declares `EVIDENCE_CAPTURED_NOT_GREEN`.

Gap definitions:

- `GAP-07-01`: second logout is not idempotent; observed HTTP 400 instead of expected 200.
- `GAP-07-02`: two concurrent logins create two valid sessions; single-winner invariant is false.
- `GAP-07-03`: `auth_session_state` is absent by design, while the runtime gate requires extension correlation when extension state is required; this remains unresolved validator/contract alignment.

These gaps are not closed by this Change Control.

## Freshness / provenance

- Underlying runtime artifact worktree commit: `75fe380951ffbd7e5e045e7157df5cf6b58ef669`.
- Existing registry binding commit: `caaa95584f0cdc441a25d28da6d458b98a2c4fec`.
- Current GitHub main before this change: `4ed45b82257632544ca0f7c7abe9d17fd56c1dda`.
- Existing `validUntil`: `2026-09-17T00:00:00.000Z`; therefore stale on 2026-09-19.

The registry keeps the original commitSha/timestamp/validUntil and historical result. No new run is claimed and no validity date is extended.

## Entity/Persistence bounded mapping

Only explicit mappings already supported by existing contracts are registered:

- `AUTH-001 → ENT-USER → PAYLOAD_NATIVE → workers/W01-payload`, status `BLOCKED`; persistence execution/schema evidence remains unverified.
- `AUTH-002 → ENT-IDENTITY/ENT-CREDENTIAL/ENT-SESSION → LUCKREAD_EXTENSION → D1-01`, status `BLOCKED`; promotion gates remain unmet.

No new entity, field, table, runtime implementation, or migration is introduced.

## Guards

- Canonical Feature Inventory remains 449.
- Canonical Mapping remains unchanged and fail-closed.
- Batch G orphan files are retained; no deletion or auto-wiring.
- AI/ANALYTICS/GROWTH extra claims remain outside canonical Mapping 0.
- No remote D1 access or migration execution.
- No Payload core modification.

## Reconciliation

Before: B05/B06/B07 were `status=VERIFIED` while their validity boundary was expired and B07 underlying status was `EVIDENCE_CAPTURED_NOT_GREEN`.

After: B05/B06/B07 are `status=EXPIRED`; historical `result=PASS`, timestamps, source refs and commit binding remain unchanged. Mapping 0 remains NOT_GREEN.

## Acceptance

Closed scope: evidence-label drift only. AUTH-002, ENT-SESSION, persistence, remote D1, runtime and full Mapping 0 technical GREEN remain unpromoted.
