# Change Control: SOCIAL-001 W05 → D1-02 Physical Binding — 2026-09-30

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-W05-D1-02-PHYSICAL-BINDING-2026-09-30`
- Status: `BINDING-ADMITTED / DEPLOYMENT-PENDING`
- Repository authority: GitHub `main`
- Base main: `d047e774c99319d8ac6d58a6f2d5bef06c7f6ce3`
- Backup: `backup/social-follow-w05-binding-before-20260930`
- Feature: `SOCIAL-001`
- Canonical chain: `SOCIAL-001 → T11 → W05 → D1-02`

## Observed physical facts

The repository already contains a controlled physical-provisioning evidence record for Worker `luckread-w05`:

- `artifacts/mapping-0/w05-w12-physical-provisioning-authorized-2026-09-29.json`
- Worker `luckread-w05` was provisioned as a minimal bootstrap resource.
- That provisioning explicitly excluded D1 bindings, Service Bindings, routes, queue consumers, projection stores and public API behavior.

The canonical D1-02 allocation already admitted by the repository is:

- database UUID: `6c342634-97f6-4248-9f4a-85772af4f22c`
- display label: `luckreadpro`
- UUID is authoritative; display name is not an ownership key.

## Binding scope

This Change Control authorizes only the following physical binding work:

```text
Cloudflare Worker: luckread-w05
        ↓
D1 binding: D1_02
        ↓
database UUID: 6c342634-97f6-4248-9f4a-85772af4f22c
```

The binding is for W05's canonical Social/Community/Interaction authority boundary.

## Explicit non-actions

- No new Worker is created.
- No new D1 database is created.
- No D1 migration is executed.
- No Follow table is created by this Change Control.
- No W05 business handler is added.
- No public Follow API behavior is enabled by this Change Control.
- No Payload Collection is introduced.
- No Service Binding to another business Worker is introduced.
- No Mapping 0 GREEN or Evidence Registry VERIFIED claim is made.

## Required deployment evidence

A deployment is admitted only when a controlled workflow proves, against one exact source SHA:

1. Worker `luckread-w05` is the deployed physical target.
2. The deployment configuration contains exactly one D1 binding for the admitted D1-02 UUID.
3. The live Worker deployment succeeds.
4. Post-deployment inspection confirms the binding target UUID.
5. The workflow records the exact source SHA and deployment run ID in a durable artifact.
6. No unrelated Worker, D1 database or route is mutated.

The resulting evidence must be bound back to `SOCIAL-001` before runtime implementation admission.

## Next gate

```text
Binding-ADMITTED
→ controlled W05/D1-02 deployment
→ live binding inspection
→ exact-SHA evidence
→ Follow migration contract execution
→ W05 runtime implementation admission
→ positive/negative/concurrency/security tests
→ Evidence Registry
```

Until the deployment evidence exists, `SOCIAL-001` remains `UNRESOLVED / NOT_GREEN`.
