# Change Control — Mapping 0 W01 Runtime Authority Path Drift

- ID: CC-MAPPING-0-W01-RUNTIME-AUTHORITY-PATH-DRIFT-2026-09-18
- Date: 2026-09-18
- Scope: Mapping/Entity/Payload/Code evidence source alignment
- Decision: CLOSED_FALSE_POSITIVE for the specific auth-session-state import allegation; the broader W01-vs-root evidence-source drift remains valid and was corrected.

## Verified facts

1. The repository explicitly declares `workers/W01-payload/` as the active runtime authority for the Payload Cloudflare D1 application.
2. The active W01 collection source is `workers/W01-payload/src/collections/Users.ts`.
3. The current W01 Users collection has `auth: true` and `fields: []`.
4. The repository also contains a separate root `src/collections/Users.ts` implementation with six profile/preference fields. That root source is not the declared W01 runtime authority.
5. At the time this GAP was opened, the Payload native inventory generator read the legacy root `src/` scaffold; this has now been corrected to W01.
6. The derived Payload/Code inventories have now been regenerated from W01 and no longer use the root scaffold as current Payload discovery evidence.
7. Historical Entity catalog/source references still require separate reconciliation where they describe the legacy root implementation.
8. A committed local-miniflare evidence artifact exists for the W01 migration, but it is explicitly LOCAL_ONLY, has an older tested commit SHA, and is not remote D1 evidence. It cannot satisfy the current runtime/remote admission gates.

## Correction

A subsequent direct read of the current `main` W01 `workers/W01-payload/src/payload.config.ts` shows that it imports only `./collections/Users` and `./collections/Media`. It does **not** import `./db/auth-session-state`. The earlier missing-file observation came from stale search/index context and is not a current W01 source defect.

The separate `auth_session_state` references in AUTH-002 schema evidence tooling are conditional evidence checks. The validator explicitly accepts absence of that table when the catalog and corresponding PRAGMA result are both empty. No implementation is required solely to satisfy those checks.

## Impact

This is a source-of-evidence drift, not a feature gap by itself.

If left unresolved, future automated reconciliation could mix:
- root scaffold evidence,
- current W01 runtime evidence,
- and historical local execution evidence

under one Mapping graph.

That would weaken Contract → Mapping → Evidence traceability and could create false technical closure.

## Required resolution

The canonical discovery/evidence chain for current Payload runtime verification must use `workers/W01-payload/` as the runtime source.

Before promotion, the following must be reconciled through normal Change Control:

1. Payload native discovery script source path.
2. Generated Payload alignment inventories.
3. Entity implementation evidence source references.
4. Code evidence inventory semantics for current-runtime versus legacy/reference implementation.
5. W01 migration/schema evidence bound to the exact tested commit.
6. Mapping-0 revalidation after the above changes.

## Explicit non-goals

- No W01 business handlers are added.
- No User fields are copied from the root scaffold into W01.
- No D1 physical schema is inferred from the root scaffold.
- No Mapping record is promoted to GREEN.
- No local-miniflare evidence is upgraded to remote/runtime evidence.

## Acceptance condition

The specific `auth-session-state.ts` missing-source allegation is closed as a false positive. The remaining W01 source-of-evidence alignment work is tracked separately by the current Payload/Code inventory corrections.



This GAP may be CLOSED only when the current W01 source tree is the sole admitted runtime discovery source for Payload evidence and all regenerated inventories are deterministic against that source. Until then, Payload/Code technical closure remains fail-closed.

