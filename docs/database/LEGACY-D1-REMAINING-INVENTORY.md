# Legacy D1 Remaining Dependency Inventory

- Repository: `wanghuinet/luckread`
- Base branch: `main`
- Audited base HEAD: `d3478519513b97bbdf58e59aab845428cc5d9011` (2026-11-18)
- Related execution brief: PR [#1909](https://github.com/wanghuinet/luckread/pull/1909)
- Open PRs at this audit base HEAD: none. PR #1909 is merged as the execution brief; PRs #1908, #1910, #1912, #1938, #1939, #1940, #1941 and #1942 are closed (merged where noted below).
- Status: **initial repository-wide inventory; not the final audit**. Continue updating this file per merged cleanup slice.

## Scope and method

The audit started from the complete Git tree at the recorded `main` HEAD (3,757 tree entries; GitHub reported `truncated=false`) and combined:
- repository code searches for `D1Database`, `createD1`, `env.DB`, `d1_databases` and Payload's `sqliteD1Adapter`;
- direct inspection of the Legacy D1 Cleanup Register, W01/W02/W05/W06/W07/W10/W11 runtime/configuration samples, and the latest merged PRs;
- review of existing worker ownership boundaries and Neon replacement Stores where visible.

Search-index results can lag behind `main`; file-level decisions are based on re-fetching the relevant files from the recorded current branch. A lack of search hits is **not** proof that a Worker has no D1 references. W03/W04/W09/W12 and several deployment/script paths still require full route/config/build-command reconciliation before a final Neon-only claim.

## Classification

- **A — removable now:** the production path already has a complete Neon Store and D1 is only a test/compatibility adapter; this inventory includes only slices whose callsites and test usage have been confirmed.
- **B — replace before removal:** a D1-shaped runtime, partial Neon path, or provider-dependent consumer remains; implement/finish the PostgreSQL-native contract before deleting the compatibility layer.
- **C — retain pending ownership/runtime confirmation:** the reference may still be operational, is tied to a live Worker binding, or the migration/cutover evidence is incomplete. Do not delete on a name-only match.
- **D — historical/lineage/infrastructure evidence:** migration sources, manifests, schema provenance, audit/rollback evidence, and logical database-domain labels. Keep unless separately replaced and independently reviewed.

## Worker inventory

| Worker | Classification | Remaining D1 references / confirmed state | Neon replacement and next action |
|---|---|---|---|
| W01 Payload | B / D | `workers/W01-payload/src/payload.config.ts` still contains `sqliteD1Adapter` selection alongside the Neon adapter. W01 Wrangler/evidence workflows and AUTH-002 schema-generation admission still expect controlled D1/SQLite tooling. Historical Payload migrations and the upstream D1 adapter manifest are separate lineage evidence. | Complete Payload CLI/schema-generation and controlled local-evidence workflows on PostgreSQL before removing the selector/dependency. Preserve upstream Payload behavior; do not patch vendor code. Keep migration lineage and evidence as D. |
| W02 Identity | A / B / D | PR #1939 removed the PrincipalAuthority D1 adapter; PR #1940 removed the RoleLayer D1 adapter; PR #1944/#1948 removed the registration-rollback D1 adapter/test fixture; PR #1950 removed the AUTH-010 session-list D1 adapter and handler fallback; PR #1951 removed the CreatorRoleGrant D1 adapter and D1-only fake DB fixture; this slice removes the AUTH-010 session-revocation D1 adapter and handler fallback. Production creator grants and session revocation already use Neon Stores composed by `getW02PostgresRuntime`. Remaining D1-shaped test/schema adapters include Better Auth schema/test support, account-state transition, MFA, session logout, username-change and publisher/L8 fixtures. `wrangler.jsonc` and `migrations/**` remain historical/source evidence; production uses `wrangler.neon.jsonc`. | Continue one isolated adapter family at a time, preserving PostgreSQL transaction, role authority and keyset pagination semantics. Do not delete W02 source migrations, Wrangler history or schema evidence as part of runtime cleanup. |
| W03 Content | B / D (provisional) | Initial targeted search did not establish a complete runtime call graph. D1-named migration generators, source SQL templates, PostgreSQL migration artifacts and traffic-guard tests are present. | Inspect all W03 entrypoints, runtime dependencies, deploy configs and scripts; distinguish current Neon PostgreSQL readers/writers from D1 schema source and contract fixtures before assigning any runtime deletion. |
| W04 Feed/Search | C (audit pending) | No direct `D1Database` / `createD1` adapter was identified in the initial targeted search. This is not a proof of absence; configuration and imported shared stores have not been exhaustively traced. | Verify worker entry/config, shared query clients, scheduled jobs and deployment workflow before marking Neon-only. No deletion authorized by this preliminary scan. |
| W05 Social | A / B / D | Since the initial inventory, PR #1912 closed the follower/following list reader, #1938 closed the Content Liker reader, #1941 removed orphaned D1-only helper/tests, and #1942 removed the push-endpoint D1 fallback while retaining W09 ownership of the D1-03 logical domain. Current `src/index.ts` still carries a D1 test/local `DB` contract and comments identifying several route families as D1-default (including comment mutations, profile pin, Repost, Share and Like mutation); those paths require a route-by-route callsite audit before deletion. | Continue with isolated route/store slices and verify the actual production composition; do not delete the D1 test/local contract or comments based on text alone. Preserve W05/W09 ownership and the existing Neon-backed Hyperdrive bindings. |
| W06 Governance | B / D | `src/neon-postgres-d1-database.ts` translates a D1-shaped query/batch contract to PostgreSQL; `src/neon/moderation-database-runtime.ts` still accepts a `d1` provider and defaults to it when unspecified. Audit/queue consumers also expose D1-shaped interfaces. | Replace the facade with native PostgreSQL stores and transaction boundaries consumer-by-consumer, preserving W09 audit ownership, queue replay/idempotency and moderation semantics. Keep migration and audit provenance as D. |
| W07 Subscription/Commerce | B / C / D | Payment, renewal, billing, order, refund, webhook and membership paths still expose D1-compatible interfaces; legacy driver selection is explicit and no longer inferred from a missing value, but the register does not establish full PostgreSQL-native coverage across every route. Wrangler/source migration artifacts are still present. | Complete route-level PostgreSQL Store coverage before removing D1 SQL facade or compatibility types. Preserve payment idempotency, signed webhook state, refunds and transaction boundaries. Validate the effective production binding before any config deletion. |
| W08 Creator | A / D | Previous cleanup removed production D1 driver/fallback, the D1 test adapter and D1-only test types. Initial targeted search found no remaining `D1Database` / `createD1` path under W08. | Keep existing Neon PostgreSQL creator Store and W02 Service Binding. Retain migration lineage/provenance only where still required. Recheck configuration and generated artifacts in final audit. |
| W09 Platform | D / C (audit pending) | Initial direct adapter search did not reveal `D1Database` / `createD1` use, but W09 owns the D1-03 logical domain and has migration-only Wrangler/configuration and schema evidence paths. W05 delegates push endpoint registry access to W09. | Trace push-endpoint production Store and every deploy/migration config. Preserve W09 data ownership and distinguish migration-only D1 configs from runtime bindings. |
| W10 Async | B / D | `src/execution-job-read-store.ts` contains a D1 adapter documented as the current production default, while `src/execution-job-read-store-postgres.ts` provides a PostgreSQL alternative for the admitted W07 T16 slice. | Confirm W10 runtime composition and the actual D1-03 vs Neon binding before changing the default. Then require the explicit PostgreSQL Store and remove D1 adapter/tests without changing job-owner scope, cursor order or retry semantics. |
| W11 Analytics | B / C / D | `src/entry.ts` requires Neon and obtains the PostgreSQL database, but injects it as `D1_05` into a D1-shaped worker contract. `src/worker.ts` still uses `sqlite_master` schema probing and D1 prepare/batch APIs. Current `wrangler.jsonc` still declares `d1_databases`. | Convert analytics health/schema probes, ingest, dedupe and rollup to PostgreSQL-native SQL/transactions first; prove the existing Neon binding/production config before removing the D1-shaped interface or Wrangler binding. |
| W12 External Developer Integration | C (audit pending) | No direct `D1Database` / `createD1` adapter was identified in the initial targeted search. Imported shared persistence and config dependencies have not yet been exhaustively traced. | Verify imports, entry/config, OAuth/app-install persistence and webhook/event consumers before claiming Neon-only. No deletion authorized by this preliminary scan. |

## Confirmed completed slices

| PR | Slice | State |
|---|---|---|
| #1904 | W05 Social Token Sync D1 adapter/fallback removal | Merged |
| #1906 | W05 Social Closure / Social Targets Read D1 adapter/fallback removal | Merged |
| #1907 | W05 Comment Notification Context D1 adapter/fallback removal | Merged |
| #1908 | W05 Comment List Read D1 dialect/adapter/resolver removal | Merged |
| #1910 | W05 Following-feed author candidate D1 adapter/fallback removal | Merged |
| #1912 | W05 Follower/following list reader D1 adapter/fallback removal | Merged |
| #1938 | W05 Content Liker read D1 adapter/fallback removal | Merged |
| #1939 | W02 PrincipalAuthorityStore D1 adapter removal | Merged |
| #1940 | W02 RoleLayerStore D1 adapter removal | Merged |
| #1941 | W05 orphaned D1-only helper/test cleanup | Merged |
| #1942 | W05 push endpoint D1 fallback removal (W09-owned Neon D1-03 executor) | Merged |
| #1944 | W02 RegistrationRollbackStore D1 adapter/test fixture removal (parallel cleanup) | Merged |
| #1948 | W02 RegistrationRollbackStore D1 adapter/test fixture removal | Merged |
| #1950 | W02 AUTH-010 session-list D1 adapter and handler fallback removal | Merged |
| #1951 | W02 CreatorRoleGrant D1 adapter and D1-only test fixture removal | Merged |
| #1952 | W02 AUTH-010 session-revocation D1 adapter and handler fallback removal | Pending CI/review |

## Cross-cutting D-class references to retain

- Historical D1/SQLite migrations that remain the source lineage for PostgreSQL migration generation.
- `contracts/database/neon-d1-01-*` through `neon-d1-05-*`, schema-source manifests, migration ledgers, runner reviews and owner-reconciliation artifacts.
- Read-only evidence, audit history, rollback records and change-control documents.
- `HYPERDRIVE_D1_01` through `HYPERDRIVE_D1_05` names when the actual resource connection is Neon PostgreSQL.
- D1 compatibility upstream manifests, pinned Payload schema-generation tooling and isolated evidence harnesses until their supported replacement is delivered.

## Immediate queue

1. W02 remaining test-only D1 adapters (Better Auth schema profile, account-state, MFA, session logout, username-change, publisher and L8/bootstrap fixtures). Principal Authority (#1939), RoleLayer (#1940), registration rollback (#1944/#1948), session-list (#1950) and CreatorRoleGrant (#1951) are merged; session-revocation (#1952) is in closeout; continue with non-overlapping adapter families and keep historical migration/config work separate.
2. W05: follower/following reads (#1912), Content Liker read (#1938), orphaned D1 residue (#1941) and push endpoint fallback (#1942) are closed. Reconcile the remaining Social routes and D1-compatible test/local contract against current runtime composition before selecting another slice; do not change W09 push-endpoint ownership.
3. W06 PostgreSQL-native moderation store migration: replace translator/facade only after consumer ports and transactions are migrated.
4. W07 membership/order/payment/refund/webhook runtime paths: finish PostgreSQL-native store composition before deleting compatibility SQL.
5. W10 T16 execution-job read: verify actual runtime database binding, then remove D1 default only when the PostgreSQL Store is composed.
6. W11 analytics: migrate SQLite catalog probes and D1-shaped batch APIs to PostgreSQL-native interfaces; reconcile the current Wrangler production config.
7. W01 Payload CLI/evidence: separately port schema generation and controlled evidence workflows; do not delete upstream adapter sources prematurely.
8. W03/W04/W09/W12: finish entry/config/deployment/shared-import audit before making any no-D1 claim.

## Guardrails

This inventory authorizes code/test/documentation cleanup only. It does not authorize deleting Cloudflare D1 databases or bindings, Neon databases or schemas, production data, migrations, secrets, queues, service bindings or any Cloudflare resource. No production deployment, traffic switch, remote schema operation or data migration is part of these slices. Each slice must have its own PR and passing CI before merge.
