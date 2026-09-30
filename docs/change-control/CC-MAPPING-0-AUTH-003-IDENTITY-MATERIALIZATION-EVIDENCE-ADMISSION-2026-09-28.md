# CC-MAPPING-0-AUTH-003-IDENTITY-MATERIALIZATION-EVIDENCE-ADMISSION-2026-09-28

## Status

`PASS_VERIFIED_IDENTITY_MATERIALIZATION / BLOCKED_ENTITY_CATALOG_PROMOTION`

## Scope

Admit the already-executed controlled W02/D1-01 runtime evidence as evidence of `ENT-IDENTITY` materialization ownership for the AUTH-003 shared identity boundary.

This control changes no runtime code, schema, migration, Worker topology, D1 topology, API/DTO authority, or production deployment state. No remote runtime rerun is required.

## Authoritative evidence

- Workflow: `.github/workflows/auth-001-registration-materializer-remote-evidence.yml`
- Run: `36377880967`
- Runtime job: `108799593871`
- Tested source SHA: `bd2791a4ca799126fac16afbc0506070e9074a77`
- Target: `luckread` / D1-01 UUID `2f80471e-3756-49f9-8db1-7707a433ad64`
- Artifact: `10953241430`
- Artifact SHA256: `9b65754f98d44453d7df598d1bdda40374f3aa5eb033239d6001e1d227f59062`
- Canonical evidence record: `EVD-AUTH001-W02-MATERIALIZER-RUNTIME-REMOTE-001`

## Evidence finding

The controlled runtime evidence established all of the following:

1. The W02 scheduled registration materializer is the executable owner that creates the identity row from the authoritative Payload User / registration envelope boundary.
2. The first valid materialization pass created exactly one identity and two initial credentials.
3. The identity converged to the same authoritative user after materialization.
4. A second materialization pass created nothing, demonstrating convergence/idempotency for the materialization boundary.
5. The fail-closed missing-key path produced no mutation.
6. Credential material remained hashed and no raw secret appeared in the result.
7. No production Worker deployment occurred.

The evidence therefore closes the prior statement that no independently evidenced identity materialization implementation existed.

## Current-source inheritance

The tested W02 materializer source was compared with current `main` at `5e571a79c11bd03123d0672ccdaaadb836dc40af`.

From the tested source SHA through current `main`, the compared file set contains no changes to:

- `workers/W02-content/src/account/registration-materializer.ts`
- `workers/W02-content/src/credentials/credential-add.ts`
- `workers/W02-content/src/credentials/credential-hash-key.ts`
- `workers/W02-content/migrations/0004_auth_003_credentials.sql`

The intervening changes are governance/evidence/control-plane changes. The exact tested runtime evidence therefore remains admissible for the unchanged materialization scope.

## Entity disposition

### ENT-IDENTITY

- `implementationStatus`: `IMPLEMENTED`
- implementation owner: `W02 scheduled registration materializer`
- persistence boundary: `auth_identities` in D1-01
- catalog status: remains `PROPOSED`
- entity evidence status: remains `BLOCKED`

This admission does **not** promote `ENT-IDENTITY` in the canonical entity catalog. It establishes executable implementation evidence only.

### ENT-CREDENTIAL

No promotion or status change is performed. Existing admitted AUTH-003 List/Add/Replace/Remove evidence remains unchanged.

## AUTH-003 boundary

The shared AUTH-003 identity dependency now has explicit materialization ownership evidence, but the feature remains `PARTIAL` because:

- canonical entity catalog promotion is still fail-closed;
- global Mapping 0 / Five-Way remains `NOT_GREEN`;
- no independent identity CRUD API claim is inferred from materialization evidence.

No AUTH-003 wire/API/DTO authority is reopened.

## Result

`ENT-IDENTITY` implementation evidence is reconciled and its materialization ownership is admitted. The remaining blocker is governance-level entity catalog / Mapping 0 promotion, not absence of executable identity materialization evidence.

No production deployment is authorized by this control.
