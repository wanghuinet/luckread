# Change Control — AUTH-010 Current Better Auth Session Mapping — 2026-11-06

- ID: `CC-MAPPING-0-AUTH-010-CURRENT-BETTER-AUTH-SESSION-MAPPING-2026-11-06`
- Date: 2026-11-06
- Status: `PARTIAL MAPPING ADMITTED / GLOBAL MAPPING NOT GREEN`
- Feature: `AUTH-010`
- Scope: Synchronize only the evidence-supported AUTH-010 mapping into the canonical `cross-system-mapping.v1.json` record.
- Base: PR #1570 current source `eb20f1044be0547f62da9c79f91b499e54da732e`.

## 1. Decision

The current 1.1 Account Center authority decision remains controlling:

- W02 / Better Auth owns canonical platform identity, session, credential and account-state authority.
- W01 remains the public API boundary and H5/Web delivery surface.
- No Payload-native session authority is introduced.
- No new Worker, D1, Queue, Service Binding, session store or identity authority is introduced.

This change binds the already implemented AUTH-010 list/revoke slice to canonical evidence references. It does not create a new feature or promote AUTH-010, ENT-SESSION, ENT-DEVICE-RECORD, Mapping 0, Five-Way Alignment or the Evidence Registry to GREEN.

## 2. Admitted partial mapping

The following exact repository sources are bound to AUTH-010:

- Feature: `AUTH-010` — session/device management.
- API operations: `authSessionList`, `authSessionRevoke`.
- Entity: `ENT-SESSION` (entity remains PROPOSED).
- Permissions: `user.session.read`, `user.session.revoke`.
- DTOs: `DTO-AUTH-SESSION-LIST-RESPONSE`, `DTO-AUTH-SESSION-REVOKE-PATH`, `DTO-AUTH-SESSION-REVOKE-RESPONSE`.
- H5 page: `workers/W01-payload/src/app/(twitter-clone)/me/sessions/page.tsx`.
- W01 routes: `workers/W01-payload/src/app/auth/sessions/[[...segments]]/route.ts` and the versioned API re-export at `workers/W01-payload/src/app/api/v1/auth/sessions/[[...segments]]/route.ts`.
- W02 execution: `workers/W02-identity/src/auth/session-list.ts`, `workers/W02-identity/src/auth/session-revoke.ts`, their tests, `workers/W02-identity/src/index.ts`, and migration `workers/W02-identity/migrations/0005_better_auth_identity_core.sql`.
- Local evidence: GitHub Actions run `42070183019`, artifact `13436460882`, tested source `7777da399e4224c1a4d095ba508e2d33d9fba80c`, environment `CONTROLLED_LOCAL_D1`. The relevant W01/W02 source blobs are unchanged at the PR source reviewed for this mapping. The matching Evidence Registry record remains `CREATED`; only the local test scope is inherited.

## 3. Explicit non-claims and blockers

The mapping must remain `PARTIAL` with explicit blockers:

1. No exact-current-deployed-SHA remote E2E has been admitted for the current W02 Better Auth session list/revoke handlers.
2. Existing AUTH-002 persistence contracts describe Payload `users.sessions[]` plus `auth_session_state`, while current W02 handlers use Better Auth D1-01 `"session"` rows. The physical Session field/persistence/secret contract is not reconciled to the current schema.
3. Current list output returns `lastSeenAt: null`; no device identifier is available. IP address or user agent must not be inferred as a stable device identity.
4. `ENT-DEVICE-RECORD` remains PROPOSED with no admitted field/persistence contract.
5. The mapped session page is H5/Web. No corresponding authenticated native RN APP screen or APP E2E acceptance is admitted.

No device entity, physical Session schema, device field, event, persistence status, API status or runtime status is invented by this change.

## 4. Canonical update boundary

The canonical `contracts/alignment/cross-system-mapping.v1.json` is the source consumed by Five-Way reconciliation and `scripts/build-code-evidence-inventory.mjs`. The latter derives API implementation evidence from each canonical record's `codeEvidenceRefs`; it does not read mapping-batch files directly.

This change therefore synchronizes the admitted AUTH-010 partial record into the canonical graph so that the existing derived evidence builder can discover the two W02 API handlers and their tests. The B01-B03 batch remains a supporting reconciliation source; it does not become a competing runtime/persistence authority.

## 5. Verification and promotion rule

After the canonical update:

- regenerate Code Evidence and Five-Way through the existing CI;
- verify the two API_OPERATION records discover the exact W01/W02 implementation and test references;
- keep AUTH-010 `PARTIAL`;
- keep ENT-SESSION persistence `CONTRACTED_NOT_VERIFIED`;
- keep the global Evidence Registry `NOT_GREEN` and do not change `testedCommitSha`;
- keep Five-Way and R4/R5 gates fail-closed until all independent feature, entity, persistence, security, lifecycle, test and evidence requirements are satisfied.

## 6. Non-actions

- No production deployment or remote D1 mutation.
- No change to Better Auth core, Payload Core or migration history.
- No new Worker, D1, Queue or Service Binding.
- No registry status-only edit.
- No historical Evidence Registry record or tested-commit anchor rewrite.
- No APP parity claim based only on the H5 page.

**Result:** AUTH-010 gains an explicit, source-backed partial Feature → API → DTO → Entity → Code → Permission/Test/Evidence mapping. It remains `PARTIAL / BLOCKED_NOT_GREEN`.
