# W01 Lockfile Reproducibility Runbook v1.0

Status: BLOCKED_UNTIL_LOCKFILE
Authority: `workers/W01-payload/`
Runtime baseline: official Payload `templates/with-cloudflare-d1`, package family `3.82.1`

## Purpose

Close the W01 dependency reproducibility prerequisite without fabricating or copying a lockfile from another project or historical Payload release.

The official Cloudflare D1 template is the runtime source baseline for W01. Cloudflare deployment support is documented as Workers + R2 + D1, and the template has its own build/runtime constraints.

## Preconditions

1. `workers/W01-payload/package.json` is the active dependency manifest.
2. Payload packages are exactly `3.82.1` for the W01 Cloudflare baseline.
3. Next is `16.3.3`; React and React DOM are `19.2.6`.
4. Node 24+ is used.
5. pnpm 9, 10, or 11 is used.
6. Installation is isolated from the repository root workspace.

## Controlled generation

From `workers/W01-payload/`:

```text
pnpm install --lockfile-only --ignore-workspace
```

This generates the lockfile from the actual W01 manifest and the selected pnpm resolver. Do not hand-author a lockfile and do not copy a lockfile from the upstream monorepo, another branch, another Payload version, or another project.

## Preflight

From repository root:

```text
node scripts/w01-lockfile-preflight.mjs
```

The preflight fails closed when Node, pnpm, package versions, or the W01 lockfile requirement is not satisfied.

## Admission evidence

After `pnpm-lock.yaml` exists:

1. Verify the lockfile is under `workers/W01-payload/`.
2. Verify the tested commit contains the lockfile.
3. Run the W01 schema evidence probe.
4. Capture the exact dependency resolution reference and lockfile hash.
5. Proceed to E1 dependency-resolution evidence.
6. Only after E1 passes may AUTH-002 migration generation admission proceed.

## Important runtime gate

A reproducible lockfile does not prove that Payload D1 runtime behavior is correct. The known `@payloadcms/db-d1-sqlite` 3.82.1 upsert defect must remain an explicit E4.5 runtime regression gate; the project must not silently introduce an unapproved Payload-core workaround.

## Current state

- Package manifest: READY
- Official Cloudflare D1 baseline: READY
- W01 lockfile: MISSING
- E1 exact dependency resolution: BLOCKED
- AUTH-002 migration generation: BLOCKED
- Mapping-0 final GREEN: NOT ADMITTED
