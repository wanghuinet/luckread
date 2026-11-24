# W01 Lockfile Reproducibility Runbook v1.1

Status: GENERATION_PENDING_CONTROLLED_CI
Authority: root `package.json` / `package-lock.json` and `workers/W01-payload/package.json` / `pnpm-lock.yaml`

## Current runtime baseline

- Payload package family: 3.94.1.
- Official `@payloadcms/db-postgres@3.94.1` is a runtime dependency.
- Next.js 16.4.6; React / React DOM 19.3.1.
- TypeScript 6.0.3.
- OpenNext Cloudflare 1.20.18; Wrangler 4.167.0.
- Node supported range: `^22.23.5 || ^24.22.3 || >=26.13.1`; CI uses 24.22.3.
- PostgreSQL driver remains pg 8.20.0 in this phase.
- Active database runtime is Neon PostgreSQL. The historical D1 template and SQLite migrations are provenance only.

## Purpose

Close dependency reproducibility for both the root Payload application and W01 Worker without fabricating or copying a lockfile from another project or historical Payload release.

## Controlled generation

Root npm lockfile:

```text
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

W01 pnpm lockfile, from `workers/W01-payload/`:

```text
pnpm install --lockfile-only --ignore-workspace
```

The controlled W01 schema workflow regenerates both lockfiles from the actual manifests and commits them to the same-repository upgrade branch. Do not hand-author either lockfile or copy one from the upstream Payload monorepo, another branch, or another Payload release.

## Preflight and evidence

From repository root:

```text
node scripts/w01-lockfile-preflight.mjs
```

The preflight fails closed when the Payload family, PostgreSQL adapter placement, Node range, pnpm version, or W01 lockfile requirement is not satisfied.

After generation:

1. Verify root `package-lock.json` and W01 `pnpm-lock.yaml` are committed on the tested branch.
2. Run W01 dependency audit, TypeScript 6.0.3 checks, unit tests, Next.js build and OpenNext Worker build.
3. Run the disposable PostgreSQL 18 schema-generation and runtime rehearsals.
4. Capture exact commit SHA and lockfile hashes.
5. Only after these checks pass may the W01 dependency upgrade be considered ready for review.

## Runtime-specific regression gates

- Payload 3.94.1's official PostgreSQL adapter must include the bootstrap pool-client `result.release()` fix; no local source patch is permitted.
- OpenNext 1.20.18 requires explicit `html_handling` and `not_found_handling` when `run_worker_first` is enabled; both W01 Wrangler configurations must preserve exact-path asset behavior.
- The historical `@payloadcms/db-d1-sqlite` upsert defect belongs to the old D1 template observation and is not a current runtime dependency or active W01 regression gate.

## Safety

Lockfile generation and schema verification use CI and disposable PostgreSQL 18 databases. They do not authorize remote Neon DDL, production data changes, Worker deployment, secret changes, or traffic routing.
