# Change Control — Mapping 0 Current Physical Worker Binding Gap — 2026-09-21

- ID: CC-MAPPING-0-WORKER-PHYSICAL-BINDING-2026-09-21
- Status: OPEN — CURRENT PHYSICAL BINDING REQUIRED
- Scope: evidence-bound physical deployment mapping for the already-frozen 12 canonical logical Workers.
- This is a binding/evidence control only. It does not change the 12-Worker architecture.

## Current authoritative facts

1. `docs/04-WORKER-MASTER-v1.0.md` is the ACTIVE/CANONICAL logical Worker authority.
2. `docs/03-WORKER-BINDING-MAPPING-v1.0.md` is the ACTIVE/CANONICAL Worker × D1 boundary.
3. `artifacts/cloudflare/current-resource-inventory-2026-09-20.json` records:
   - canonicalWorkers = 12;
   - physicalToLogicalMapping = NOT_ESTABLISHED;
   - workerProvisioningStatus = NO_UPLOADED_SCRIPTS_CONFIRMED;
   - worker creation/deployment remains blocked until canonical physical names and implementation admission exist.
4. `contracts/resource-budget/edge-first-worker-topology.json` is explicitly historical and does not match the current 12-Worker target. It must not be imported as the physical binding.

## Gap

The project has frozen logical Worker ownership, but it has not yet established a current evidence-bound mapping:

`Canonical logical Worker → current physical Worker resource/name → deployed source commit → binding/configuration → evidence`

This missing mapping prevents runtime code from being assigned to a physical Worker solely from directory names.

## AUTH-002 relevance

AUTH-002 is logically:

`T01/T03 → W02 → D1-01`

W01 remains T24/API boundary.

Until this Change Control is resolved, implementation must not infer that:

- `workers/W01-payload` is the physical W02 security/authorization implementation;
- `workers/W02-content` is the canonical W02 implementation;
- any historical P01-P08 resource grouping is current.

## Closure evidence required

For each logical Worker that is admitted to implementation, the project must have the existing authoritative physical resource name/ID, source commit binding, required deployment/configuration binding, and validation/evidence reference.

No resource creation is authorized by this record.

## Prohibited changes

- No new Worker solely to satisfy naming.
- No new D1 domain.
- No rename based on historical topology.
- No reassignment of D1 authority.
- No direct W01 D1-01 business authority.
- No runtime implementation admission without the applicable Contract and evidence gates.

## Current disposition

OPEN. This control becomes a prerequisite for physical runtime implementation admission where the current repository has no already-proven physical binding.
