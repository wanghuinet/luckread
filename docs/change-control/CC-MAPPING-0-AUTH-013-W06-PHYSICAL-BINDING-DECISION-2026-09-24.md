# AUTH-013 W06 Physical Binding Decision — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-W06-PHYSICAL-BINDING-DECISION-2026-09-24`
- Feature: `AUTH-013`
- Scope: physical Worker identity and D1-03 binding only
- Repository authority: GitHub `main`

## 1. Inputs

Controlled Cloudflare inventory:

- Source head: `014a65e78a9ae52a08a5cdd992a6a98a3f816eab`
- Inventory Run: `35954361667` = SUCCESS
- Follow-up inventory Run: `35956155450` = SUCCESS at the latest repository head
- D1 resources:
  - D1-01: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`
  - D1-02: `luckreadpro` / `6c342634-97f6-4248-9f4a-85772af4f22c`
  - remaining resource A: `secondary` / `bda1d247-a371-4244-91ae-aef96034db7f`
  - remaining resource B: `unimportant` / `9bfb89a5-fbb5-45b1-a2ee-eab674b0d736`
- Workers observed:
  - `luckread-w01-payload`
  - `luckread-w02`
- No physical W06 Worker existed in either controlled inventory.

## 2. Explicit decision

This Change Control now establishes the physical allocation for the frozen four-domain topology:

| Logical authority | Physical resource | Basis |
|---|---|---|
| D1-01 | `2f80471e-3756-49f9-8db1-7707a433ad64` | Existing admitted binding |
| D1-02 | `6c342634-97f6-4248-9f4a-85772af4f22c` | Existing admitted binding |
| D1-03 | `bda1d247-a371-4244-91ae-aef96034db7f` | **Explicit allocation decision**: first-created of the two remaining unassigned D1 resources |
| D1-04 | `9bfb89a5-fbb5-45b1-a2ee-eab674b0d736` | **Explicit allocation decision**: second-created of the two remaining unassigned D1 resources |

The database display names are non-authoritative. UUIDs are the physical binding identities.

The canonical W06 Worker physical resource name is:

`luckread-w06`

Because it does not currently exist, it is admitted as a **resource-to-be-created by controlled deployment**, not as an already-existing resource.

## 3. Rationale and boundaries

The D1-03/D1-04 selection is an explicit Change Control allocation decision over the two unassigned physical resources; it is not inferred from their display names.

The allocation preserves:

- exactly 4 physical D1 resources for the frozen 4-domain topology;
- stable UUID identity;
- no new fifth D1;
- D1-03 = Platform Operations / Governance / Runtime;
- D1-04 = Commerce / Financial Authority;
- W06 = Rights / Trust & Safety / Governance;
- no reassignment of D1-01 or D1-02;
- no unrestricted cross-domain writer.

No D1-03 mutation, migration, table creation, or Worker deployment is authorized by this document alone.

## 4. Admission result

- Physical W06 identity decision: **ADMITTED_FOR_CONTROLLED_CREATION**
- D1-03 physical UUID: **ADMITTED**
- D1-04 physical UUID: **ADMITTED**
- W06 Wrangler D1-03 binding: **NEXT IMPLEMENTATION GATE**
- W06 deployment: **NEXT CONTROLLED EXECUTION GATE**
- D1-03 AuditEvent migration: **NOT_AUTHORIZED YET**
- AUTH-013 overall: **BLOCKED_NOT_GREEN** until deployment, AuditEvent persistence/publication, side-effect and E2E evidence are completed.
