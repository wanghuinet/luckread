# Change Control: Worker Directory Canonicalization — 2026-10-01

- Change Control ID: `CC-WORKER-DIRECTORY-CANONICALIZATION-2026-10-01`
- Status: `PATH-CANONICALIZATION`
- Scope: physical repository directory names only
- Topology: **12 Workers / 4 D1 / 25 Tasks unchanged**
- Runtime Worker identities: unchanged

## Objective

Align physical Worker directory names with the canonical Worker responsibilities so that repository navigation, IDE tooling, code search and AI agents receive the same signal as the Worker Master.

## Canonical path changes

| Worker | Former path | Canonical path | Responsibility |
|---|---|---|---|
| W05 | `workers/W05-transaction` | `workers/W05-social` | Social / Community / Messaging / Notification |
| W07 | `workers/W07-async` | `workers/W07-subscription-commerce` | Subscription / Commerce / Payment / Advertising |
| W08 | `workers/W08-search` | `workers/W08-creator` | Creator / Organization |
| W09 | `workers/W09-index-recommendation` | `workers/W09-platform` | Platform / Storage / Reliability |
| W10 | `workers/W10-market-ip` | `workers/W10-async` | Async / Queue / Job Execution |

## Controls

1. Worker IDs and Cloudflare Worker names remain unchanged.
2. W05 runtime source, migration artifact and deployment workflows move atomically to the canonical W05 path.
3. The W05 Follow migration SQL blob is moved without content change; no D1 migration is re-executed.
4. Historical Mapping, Evidence, Authority and prior Change Control records are not rewritten.
5. The active Follow migration path is amended by the v1.1 path-amendment contract.
6. W07-W10 are path-only relocations; no business implementation is introduced.
7. No new Worker, D1, route, queue, service binding or public API is created.

## Verification target

After this change the repository must contain exactly one physical directory for each W01-W12 Worker, with no legacy W04/W05/W07/W08/W09/W10 directory remaining under `workers/`.

The remaining occurrences of former paths may exist only in immutable historical evidence/provenance or superseded contract records and must not be used as current execution paths.
