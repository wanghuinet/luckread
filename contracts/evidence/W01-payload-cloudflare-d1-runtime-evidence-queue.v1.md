# W01 Payload Cloudflare D1 Runtime Evidence Queue v1

Status: `OPEN / FAIL-CLOSED`

Purpose: close the remaining runtime/evidence gap for Mapping-0 without promoting inferred Payload session semantics or inventing D1 schema bindings.

## Authority

- Runtime: `workers/W01-payload/`
- Package contract: `workers/W01-payload/package.json`
- Official Cloudflare template baseline: Payload `3.82.1` package family as recorded in `PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md`
- D1 adapter: `@payloadcms/db-d1-sqlite@3.82.1`
- Database binding: `D1`
- Migration directory: `workers/W01-payload/src/migrations/`
- Mapping gate: `contracts/alignment/mapping-batches/`
- Canonical evidence registry: `contracts/evidence/mapping-0-evidence-registry.v1.json`

## Current verified facts

1. The W01 source tree now contains the physical Cloudflare D1 Payload baseline.
2. `Users.ts` uses Payload authentication (`auth: true`).
3. `payload.config.ts` uses the D1 SQLite adapter with migration directory configured and `push: false`.
4. W01 is pinned to the official Cloudflare D1 template dependency baseline recorded by the upstream manifest; the current Payload package family is `3.82.1`.
5. No `pnpm-lock.yaml` is currently present in W01; dependency resolution therefore remains an evidence gate.
6. Physical source materialization is not runtime verification and does not make Mapping-0 GREEN.
7. Payload issue evidence reports an `upsert` behavior defect for `@payloadcms/db-d1-sqlite@3.82.1`; W01 must explicitly test the affected persistence path before the D1 runtime gate can pass. This is a test requirement, not an assumption that the defect remains present after installation.

## Required evidence batch

### E1 — Dependency resolution

Capture, from the actual W01 working tree:

- package-manager version;
- Node version;
- exact installed Payload package versions;
- resolved package locations;
- package integrity metadata where available;
- lockfile status.

Pass condition: every Payload runtime package resolves to the official Cloudflare-template contract-pinned version and the evidence is reproducible.

### E2 — Build

Run the W01 build using the official Cloudflare template's current build command after the package set is installed.

Pass condition: build completes without changing package versions, configuration contracts, or source authority.

### E3 — Generated artifacts

Capture the relevant generated OpenNext/Next/Payload artifacts needed to prove the build output is actually compatible with the W01 Worker entrypoint.

Pass condition: generated Worker entrypoint and assets exist and are internally consistent with `wrangler.jsonc`.

### E4 — D1 schema

Against the controlled D1 database, capture read-only metadata for:

- tables;
- columns;
- indexes;
- foreign keys;
- Payload migration bookkeeping;
- migration status.

Pass condition: schema evidence comes from the actual controlled D1 database, not from Payload source assumptions.

### E4.5 — D1 adapter regression probe

Explicitly exercise D1 persistence operations affected by adapter query semantics, including the Payload preferences/upsert path where applicable to the installed runtime.

Pass condition: the installed `@payloadcms/db-d1-sqlite` runtime demonstrates correct persistence semantics on the controlled D1 database, or a documented upstream/runtime workaround is proven without modifying Payload core outside an approved change-control path.

Fail condition: silent no-op persistence, schema/runtime mismatch, or an unverified workaround.

### E5 — Migration

Capture the migration artifact(s), execution result, and resulting D1 schema delta.

Pass condition: migration execution is explicitly evidenced before any canonical persistence field is promoted.

### E6 — Session runtime

Probe and record:

- login;
- session validation;
- logout;
- refresh;
- concurrent refresh/replay behavior;
- account-state invalidation;
- device boundary behavior;
- absence of plaintext refresh credentials in persistence.

Pass condition: each probe has an observable result tied to the actual installed Payload runtime.

## AUTH-002 fail-closed rule

The canonical Session fields remain unpromoted until E1–E6 and E4.5 are satisfied:

`id`, `userId`, `deviceId`, `tokenVersion`, `refreshCredentialHash`, `expiresAt`, `revokedAt`, `createdAt`, `lastSeenAt`.

For each field, the final classification must be one of:

- `NATIVE_EQUIVALENT`
- `ADAPTER_MAPPING_REQUIRED`
- `CUSTOM_CONTRACT_REQUIRED`
- `NOT_SUPPORTED`

No field equivalence may be inferred from naming similarity alone.

## Mapping-0 promotion rule

This queue may contribute evidence to Mapping-0, but it cannot by itself mark Mapping-0 GREEN. Promotion requires the canonical Mapping-0 verification scripts and evidence registry to pass with the resulting evidence references recorded.

## Execution order

`E1 dependency → E2 build → E3 generated artifacts → E4 D1 schema → E4.5 adapter regression → E5 migration → E6 session probes → Evidence Registry → Mapping-0 verification → GREEN`

## Non-goals

- No custom Session table is to be created merely to satisfy the contract.
- No Payload core modification is authorized by this queue.
- No D1-Fabric dependency or architecture is introduced.
- No public API/DTO is invented from runtime observations.
