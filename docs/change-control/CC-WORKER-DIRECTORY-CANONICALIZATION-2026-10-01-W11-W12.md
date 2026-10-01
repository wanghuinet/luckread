# Change Control: W11/W12 Worker Directory Canonicalization — 2026-10-01

- Change Control ID: `CC-WORKER-DIRECTORY-CANONICALIZATION-2026-10-01-W11-W12`
- Status: `PATH-CANONICALIZATION`
- Scope: physical repository directory names only
- Topology: **12 Workers / 4 D1 / 25 Tasks unchanged**
- Runtime Worker identities: unchanged

## Objective

Remove the remaining physical-path semantic drift for W11 and W12 so repository navigation, code search, IDE tooling, and AI agents see the canonical responsibilities directly.

## Canonical path changes

| Worker | Former path | Canonical path | Responsibility |
|---|---|---|---|
| W11 | `workers/W11-analytics-ads` | `workers/W11-growth-campaign-analytics-operations` | Growth / Campaign / Analytics / Operations |
| W12 | `workers/W12-open-extension` | `workers/W12-external-developer-integration` | External Developer / Integration Execution |

## Controls

1. Worker IDs and Cloudflare Worker names remain unchanged.
2. These are directory-only relocations; no runtime source or business behavior changes.
3. Historical Mapping, provisioning evidence, Authority, and prior Change Control records are not rewritten.
4. The former paths are retained only as historical provenance in existing records.
5. No new Worker, D1, route, queue, service binding, or public API is created.

## Verification target

After this change, all 12 Worker root directories must use responsibility-aligned naming, with no remaining legacy W05/W07/W08/W09/W10/W11/W12 directory at the physical `workers/` root.
