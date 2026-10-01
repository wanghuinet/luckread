# CC-MAPPING-0-WORKER-PHYSICAL-DIRECTORY-CANONICALIZATION-2026-10-01

Status: READY FOR CI / MERGE — NOT A MAPPING GREEN DECISION

## Scope

Align the two remaining physical Worker directory names with the canonical Worker Master:

- `workers/W02-content` → `workers/W02-identity`
- `workers/W03-feed` → `workers/W03-content`

No Worker ID, Cloudflare Worker name, D1 resource, Task ownership, API operation, or business rule changes.

## Authority

- Canonical Worker identity: `docs/04-WORKER-MASTER-v1.0.md`
- Canonical Worker × D1 binding: `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- Frozen topology: 12 Workers / 4 D1 domains / 25 Contract Tasks

## Execution

All W02/W03 source, tests, migrations, package metadata, and Wrangler configuration are preserved under the canonical physical paths. Current runtime/CI/Contract inventory references were reconciled to the new paths.

Historical change-control, evidence, and audit snapshots are intentionally not rewritten; their old paths remain historical references to the source layout that existed when those records were produced.

## Safety controls

- Backup branch: `backup/pre-worker-directory-final-alignment-20261001`
- Working branch: `chore/canonicalize-w02-w03-directories-20261001`
- No new Worker
- No new D1
- No schema migration
- No Payload Core change
- No deployment/resource mutation
- No Mapping 0 GREEN promotion

## Acceptance

CI must verify:

1. exact canonical Worker directory set;
2. W02/W03 source typecheck/tests through the renamed paths;
3. active Workflow path integrity;
4. no missing current Contract/Code evidence references caused by the rename.

This change is structural only. It does not promote any previously blocked Mapping/Contract/Evidence gate.
