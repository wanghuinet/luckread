# Mapping 0 — Physical Worker Layout Reconciliation — 2026-09-21

- Audit ID: M0-WORKER-PHYSICAL-LAYOUT-RECONCILIATION-001
- Scope: compare the physical `workers/*` directories on current `main` with the ACTIVE/CANONICAL Worker Master.
- Status: PASS_VERIFIED_AUDIT — PHYSICAL DIRECTORY TOPOLOGY IS NOT THE CURRENT WORKER AUTHORITY

## Authority rule

The ACTIVE/CANONICAL Worker Master states that Worker authority must not be inferred from directory names, routes, Payload Collections or existing code. The Worker Master and Worker × D1 Binding Mapping are the current authority.

Therefore physical directory names are evidence of repository layout only, not automatic Worker identity/ownership.

## Current physical layout observed on main

| Physical directory | README-declared role | Canonical Worker Master role | Result |
|---|---|---|---|
| workers/W01-payload | Payload platform base | W01 Public API / Gateway / Developer & Admin API Boundary | ROLE MISMATCH / runtime platform boundary exists |
| workers/W02-content | Article / dynamic content | W02 Identity / Account / Authorization | MISMATCH |
| workers/W03-feed | Feed | W03 Content / Article / Media / Translation | MISMATCH |
| workers/W04-social | Social | W04 Feed / Recommendation / Search | MISMATCH |
| workers/W05-transaction | Transaction | W05 Social / Community / Messaging / Notification | MISMATCH |
| workers/W06-media | Media | W06 Rights / Trust & Safety / Governance | MISMATCH |
| workers/W07-async | Async | W07 Subscription / Commerce / Payment / Advertising | MISMATCH |
| workers/W08-search | Search | W08 Creator / Organization | MISMATCH |
| workers/W09-index-recommendation | Index / Recommendation | W09 Platform / Storage / Reliability | MISMATCH |
| workers/W10-market-ip | Market / IP | W10 Async / Queue / Job Execution | MISMATCH |
| workers/W11-analytics-ads | Analytics / Ads | W11 Growth / Campaign / Analytics / Operations | MISMATCH / partial semantic overlap |
| workers/W12-open-extension | Open / Extension | W12 External Developer / Integration Execution | MISMATCH / partial semantic overlap |

The physical worker directory tree therefore reflects an earlier or alternative implementation naming scheme rather than the current canonical Worker Master.

## Implementation observation

- `workers/W01-payload` contains the only observed substantive runtime implementation among the twelve physical worker directories inspected here.
- `workers/W02-content` through `workers/W12-open-extension` currently contain README skeletons in the inspected directory roots; no canonical W02 Identity/Account/Authorization runtime implementation was found.
- This audit does not claim that deeper repository code can be assigned to a canonical Worker merely by path or naming.
- No directory was renamed, deleted, merged or created by this audit.

## AUTH-002 / E6 consequence

The canonical AUTH-002 business implementation boundary remains:

`T01/T03 → W02 → D1-01`

W01 remains the API/Gateway boundary.

Because no canonical physical W02 implementation has been evidenced, E6 cannot be implemented by placing Identity/Authorization business logic into `workers/W01-payload` or `workers/W02-content`.

A future implementation must first establish an approved physical binding for canonical W02 and an explicit W01↔W02 transport contract. The transport mechanism is not inferred here.

## Anti-drift decision

Do not:

- rename the existing physical directories as a Mapping shortcut;
- treat `workers/W02-content` as canonical W02 identity code;
- place RoleAssignment authority or AUTH-002 business authorization directly into W01;
- promote physical directory names over the ACTIVE/CANONICAL Worker Master;
- introduce a new Worker/D1 domain to reconcile the mismatch.

## Current conclusion

The Worker topology is **logically frozen but not physically materialized to the same IDs/names**.

This is an implementation-boundary gap, not a reason to change the canonical architecture.

For Mapping 0, the finding is recorded as evidence and must not be repeatedly rediscovered.


## Supersession correction — 2026-09-21

A further authority cross-check found that `contracts/resource-budget/edge-first-worker-topology.json` defines a historical W01-W13 logical / P01-P08 physical grouping and is explicitly classified by `docs/04-WORKER-TOPOLOGY-CHANGE-CONTROL-v1.0.md` as historical and not matching the current 12-worker target.

Accordingly, this audit does **not** assert that the physical P01-P08 topology is current, nor does it require a physical directory rename based on that historical model.

The safe current conclusion is narrower:

- Canonical logical Worker authority remains the ACTIVE/CANONICAL Worker Master.
- The repository's physical `workers/*` directories do not independently establish canonical Worker identity.
- The canonical **physical-to-logical Worker binding is not yet established by current evidence**.
- This is distinct from the historical P01-P08 topology and must not be resolved by importing that historical topology.
- No directory rename/delete/creation is authorized by this audit.
