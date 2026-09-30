# CC-1.0-W03-D1-02-PHYSICAL-BINDING-2026-09-29

- Status: **PHYSICAL BINDING ADMITTED / DEPLOYMENT PENDING**
- Repository authority: GitHub `main`
- Decision scope: W03 physical Worker identity and D1-02 physical UUID only.
- No runtime deployment or migration is executed by this decision.

## Controlled inventory input

- Main inventory workflow: `.github/workflows/cloudflare-resource-inventory.yml`
- Inventory run: **36577107292 = SUCCESS**
- Inventory head: `2bab91c72e15305387fa7f4dd9db1114d2c4ff62`
- Cloudflare inventory: exactly **4 D1** resources and **11 Worker** resources.
- Existing W03 Worker resource: **NOT_FOUND**.
- D1-02 physical UUID present: `6c342634-97f6-4248-9f4a-85772af4f22c`.

## Explicit decision

| Logical authority | Physical identity | Status |
|---|---|---|
| W03 | `luckread-w03` | **ADMITTED_FOR_CONTROLLED_CREATION** |
| D1-02 | `6c342634-97f6-4248-9f4a-85772af4f22c` | **ADMITTED** |

The current display name `luckreadpro` is retained as a non-authoritative label. The UUID is the physical database identity.

The W03 physical resource does not exist yet. The next controlled deployment may create `luckread-w03`; until then it must not be described as deployed or remotely verified.

## Existing architecture preserved

- W03 remains Content / Article / Media / Translation.
- D1-02 remains the authoritative content domain.
- W01 remains the public API / Gateway boundary.
- W04 remains the Feed / Recommendation / Search projection boundary.
- No new Worker, D1, Task, queue, or database domain is introduced.
- No reassignment of D1-01, D1-03, or D1-04.

## Deployment guard

Before remote migration or production runtime evidence:

1. W03 source configuration must bind `D1_02` to the exact UUID above.
2. Controlled deployment must pin an exact source commit.
3. Deployment evidence must establish source commit → Worker version/resource.
4. W01 `W03_CONTENT` Service Binding must target `luckread-w03`.
5. Migration execution must be separately authorized and evidenced.

## Status

- Physical binding decision: **ADMITTED**
- W03 physical Worker existence: **PENDING CONTROLLED CREATION**
- W03 deployment: **PENDING**
- D1-02 migration execution: **NOT_AUTHORIZED BY THIS DOCUMENT**
- Content runtime GREEN: **NO**
