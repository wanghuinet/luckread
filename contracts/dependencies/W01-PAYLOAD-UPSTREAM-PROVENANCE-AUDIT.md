# Upstream source provenance audit — W01 Payload

**Status: REVIEW_REQUIRED**  
**Audit date:** 2026-11-23  
**Repository baseline:** `wanghuinet/luckread` `main` at `c479ea86c96ceef83a4882c91cda2f335bfbd1e3`

## Scope and method

Compared every tracked blob under `workers/W01-payload/` with the corresponding relative path in the Payload upstream template `templates/with-cloudflare-d1` at the exact historical upstream commit recorded by W01's existing manifest:

- Upstream repository: `payloadcms/payload`
- Commit: `9a2cdcb87aacae41b66ab558a056d974c8f38f4e`
- Template tree: `369bfb899fa6951c05b7469cf8da80a5e6acb145`

The comparison uses Git blob SHA equality for same-path files. It does not infer ownership from filenames and does not treat all local-only files as custom or all modified files as violations.

## Results

| Measure | Count |
|---|---:|
| W01 tracked blobs | 550 |
| Upstream template blobs | 45 |
| Byte-identical same-path files | 7 |
| Same-path files with different content | 24 |
| W01-only files | 519 |
| Upstream-only files | 14 |

The seven byte-identical files are:

- `.prettierrc.json`
- `.yarnrc`
- `src/app/(payload)/admin/[[...segments]]/not-found.tsx`
- `src/app/(payload)/admin/[[...segments]]/page.tsx`
- `src/app/(payload)/api/[...slug]/route.ts`
- `src/app/(payload)/custom.css`
- `vitest.setup.ts`

The 24 same-path modified files are:

`.env.example`, `.gitignore`, `.npmrc`, `README.md`, `cloudflare-env.d.ts`, `eslint.config.mjs`, `next.config.ts`, `open-next.config.ts`, `package.json`, `playwright.config.ts`, `src/app/(frontend)/layout.tsx`, `src/app/(frontend)/styles.css`, `src/app/(payload)/admin/importMap.js`, `src/app/(payload)/layout.tsx`, `src/collections/Media.ts`, `src/collections/Users.ts`, `src/migrations/20250929_111647.json`, `src/migrations/20250929_111647.ts`, `src/migrations/index.ts`, `src/payload-types.ts`, `src/payload.config.ts`, `tsconfig.json`, `vitest.config.mts`, `wrangler.jsonc`.

## Interpretation and required action

- Identical blobs are confirmed identical at the compared paths and commit.
- Modified files need classification. Configuration, LuckRead collections, and supported extension points can be legitimate; a diff alone cannot prove whether an upstream implementation was changed.
- W01-only files are not automatically violations. They include LuckRead product code, migrations, tests, local scripts, assets, and potentially copied/adapted code from other projects. Each reused source needs a traceable source URL/ref, license, copyright notice, and adaptation boundary.
- Upstream-only files are omissions at the compared paths, not proof of a problem.
- The current W01 tree is substantially evolved from the historical template. The result is therefore **not a clean bill of health** and must remain `REVIEW_REQUIRED` until the modified and copied-source classifications are completed.

The existing third-party notices already document the MIT-licensed `ccrsxx/twitter-clone` adaptations in two W01 frontend areas. Those notices should be retained and expanded if additional files from that project are identified.

This audit does not modify Payload source, remove D1 adapters, alter database configuration, or make a production migration decision. Reconcile the historical D1 template baseline with the current Neon target separately; do not restore obsolete upstream D1 runtime code.

Machine-readable counts and evidence are in `upstream-source-provenance.v1.json`.
